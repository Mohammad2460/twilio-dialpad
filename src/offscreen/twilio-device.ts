import { Device, type Call } from '@twilio/voice-sdk';
import { sendMsg } from '@shared/messaging';
import type { Settings, TranscriptSegment } from '@shared/types';
import { mixToStereo, type MixedStream } from '@shared/audio-mixer';
import { DeepgramSession } from '@shared/deepgram';
import { ManagedTranscription } from '@shared/managed-transcription';

const TOKEN_REFRESH_MS = 50 * 60 * 1000;
const REGISTER_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];

/** Resolve after `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface FetchTokenResult { token: string; identity: string; }

async function fetchToken(functionUrl: string, identity: string): Promise<string> {
  const url = new URL('/token', functionUrl);
  url.searchParams.set('identity', identity);
  const res = await fetch(url.toString(), { method: 'GET' });
  if (!res.ok) throw new Error(`Token mint failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as FetchTokenResult;
  if (!json.token) throw new Error('Token response missing token field');
  return json.token;
}

// Module-level state mirror — readable via getState() even if storage writes fail.
let _devState = 'uninitialized';
let _devError: string | undefined;

// Direct callbacks — wired by the side panel (or any context that owns the DeviceManager).
// Called immediately on state change, bypassing storage/messaging entirely.
let _deviceStateCb: ((state: string, error?: string) => void) | undefined;
let _callStateCb: ((payload: Record<string, unknown>) => void) | undefined;
let _transcriptSegmentCb: ((callSid: string, seg: TranscriptSegment) => void) | undefined;
let _transcriptFinalizedCb: ((info: {
  callSid: string;
  segments: TranscriptSegment[];
  startedAt: number;
  endedAt: number;
  direction: 'in' | 'out';
  remoteNumber: string;
}) => void | Promise<void>) | undefined;
let _transcriptErrorCb: ((err: Error) => void) | undefined;

/** Register direct state-change callbacks. Call from side panel hook to skip storage round-trip. */
export function registerCallbacks(
  onDeviceState: (state: string, error?: string) => void,
  onCallState: (payload: Record<string, unknown>) => void,
): void {
  _deviceStateCb = onDeviceState;
  _callStateCb = onCallState;
}

/** Register transcription callbacks. Live segments + final transcript + errors. */
export function registerTranscriptionCallbacks(
  onSegment: (callSid: string, seg: TranscriptSegment) => void,
  onFinalized: (info: {
    callSid: string;
    segments: TranscriptSegment[];
    startedAt: number;
    endedAt: number;
    direction: 'in' | 'out';
    remoteNumber: string;
  }) => void | Promise<void>,
  onError: (err: Error) => void,
): void {
  _transcriptSegmentCb = onSegment;
  _transcriptFinalizedCb = onFinalized;
  _transcriptErrorCb = onError;
}

/** Write state to storage. Uses local (reliable cross-context) + session (fast, in-memory). */
function storeSet(data: Record<string, unknown>) {
  // local storage: works reliably from all extension contexts including offscreen.
  chrome.storage.local.set(data).catch((e) => console.error('[device] local.set failed', e));
  // session storage: faster; might not propagate from offscreen in some Chromium forks.
  chrome.storage.session.set(data).catch(() => {});
}

/** Broadcast device state. */
function emitDeviceState(state: string, error?: string) {
  _devState = state;
  _devError = error;
  // Direct callback first — zero latency, no storage dependency.
  _deviceStateCb?.(state, error);
  storeSet({ deviceState: state, deviceError: error ?? null, deviceStateTs: Date.now() });
  sendMsg({ type: 'device.state', state: state as never, error }).catch(() => {});
}

/** Broadcast call state. */
function emitCallState(payload: Record<string, unknown>) {
  // Direct callback first — zero latency, no storage dependency.
  _callStateCb?.(payload);
  storeSet({ callState: payload });
  sendMsg(({ type: 'call.state', ...payload }) as never).catch(() => {});
}

/**
 * Per-call transcription lifecycle. Stays alive only between accept and disconnect.
 * Skipped entirely when settings.deepgramApiKey is absent — calls work as before.
 */
class TranscriptionController {
  private session: DeepgramSession | null = null;
  private managed: ManagedTranscription | null = null;
  private mixed: MixedStream | null = null;
  private segments: TranscriptSegment[] = [];
  private startedAt = 0;
  /** Set when the call ends before streams were ready — cancels an in-flight waitForStreams. */
  private cancelled = false;

  async start(
    call: Call,
    callSid: string,
    direction: 'in' | 'out',
    remoteNumber: string,
    apiKey: string,
    model?: string,
    managed?: { userId: string },
  ): Promise<void> {
    // Twilio Voice SDK 2.x attaches the WebRTC audio tracks asynchronously —
    // they are frequently NOT ready in the same tick the 'accept' event fires.
    // Reading them once here (the old behaviour) threw → was swallowed → the
    // transcript silently never started. Poll briefly instead. Non-fatal.
    type CallWithStreams = Call & {
      getLocalStream?: () => MediaStream | undefined | null;
      getRemoteStream?: () => MediaStream | undefined | null;
    };
    const c = call as CallWithStreams;

    const streams = await this.waitForStreams(c);
    if (!streams) {
      // Timed out, or the call ended before audio was ready. Don't raise a hard
      // error for a cancelled call; surface a soft error only on real timeout.
      if (!this.cancelled) {
        console.warn('[transcription] audio streams not ready before timeout — skipping transcription');
        _transcriptErrorCb?.(
          new Error('Twilio audio streams not ready (timed out). Transcription skipped for this call.'),
        );
      }
      // Still record meta so finalize() is a clean no-op.
      this._meta = { callSid, direction, remoteNumber };
      return;
    }
    const { local, remote } = streams;
    console.log('[transcription] streams ready', {
      localTracks: local.getAudioTracks().length,
      remoteTracks: remote.getAudioTracks().length,
    });

    this.startedAt = Date.now();
    this.mixed = mixToStereo(local, remote);

    const onSegment = (seg: TranscriptSegment) => {
      if (seg.isFinal) this.segments.push(seg);
      _transcriptSegmentCb?.(callSid, seg);
    };

    try {
      if (managed) {
        // Managed path (P8.3): our Deepgram key via short-lived JWTs, metered by
        // credits. Stops gracefully at zero balance; never affects the call.
        this.managed = new ManagedTranscription({
          userId: managed.userId,
          callSid,
          stream: this.mixed.stream,
          startedAt: this.startedAt,
          model: model ?? 'nova-3',
          onSegment,
          onStopped: (reason) => {
            console.log('[transcription] managed stopped:', reason);
            if (reason === 'insufficient_credits') {
              _transcriptErrorCb?.(new Error('Transcription paused — out of credits.'));
            } else if (reason === 'unavailable') {
              _transcriptErrorCb?.(new Error('Managed transcription unavailable.'));
            }
          },
        });
        await this.managed.start();
        console.log('[transcription] managed session started');
      } else {
        this.session = new DeepgramSession({
          apiKey,
          model,
          startedAt: this.startedAt,
          onSegment,
          onError: (err) => {
            console.warn('[transcription] DeepgramSession error', err);
            _transcriptErrorCb?.(err);
          },
        });
        await this.session.start(this.mixed.stream);
        console.log('[transcription] Deepgram session started');
      }
    } catch (e) {
      // Hard failure — clean up streams, surface error, but don't break the call.
      console.error('[transcription] start failed', e);
      this.mixed?.dispose();
      this.mixed = null;
      this.session = null;
      this.managed = null;
      _transcriptErrorCb?.(e instanceof Error ? e : new Error(String(e)));
    }

    // Capture remoteNumber + direction for finalize.
    this._meta = { callSid, direction, remoteNumber };
  }

  /**
   * Poll for ready local + remote audio streams. Twilio attaches tracks a few
   * hundred ms after 'accept'. Returns the streams once both have audio tracks,
   * or null on timeout / cancellation (call ended early).
   */
  private async waitForStreams(
    c: {
      getLocalStream?: () => MediaStream | undefined | null;
      getRemoteStream?: () => MediaStream | undefined | null;
    },
    timeoutMs = 3000,
    intervalMs = 200,
  ): Promise<{ local: MediaStream; remote: MediaStream } | null> {
    const deadline = Date.now() + timeoutMs;
    let lastLogged = '';
    while (Date.now() < deadline) {
      if (this.cancelled) return null;
      const local = c.getLocalStream?.();
      const remote = c.getRemoteStream?.();
      const ready =
        !!local &&
        !!remote &&
        local.getAudioTracks().length > 0 &&
        remote.getAudioTracks().length > 0;
      const state = `local=${!!local} remote=${!!remote}`;
      if (state !== lastLogged) {
        console.log('[transcription] waiting for streams', state);
        lastLogged = state;
      }
      if (ready) return { local: local as MediaStream, remote: remote as MediaStream };
      await sleep(intervalMs);
    }
    return null;
  }

  private _meta: { callSid: string; direction: 'in' | 'out'; remoteNumber: string } | null = null;

  async finalize(): Promise<void> {
    // Cancel any in-flight waitForStreams (call ended before audio was ready).
    this.cancelled = true;
    const meta = this._meta;
    const endedAt = Date.now();
    try {
      await this.session?.stop();
    } catch { /* noop */ }
    try {
      await this.managed?.stop();
    } catch { /* noop */ }
    this.mixed?.dispose();
    this.session = null;
    this.managed = null;
    this.mixed = null;

    if (meta && this.segments.length > 0) {
      try {
        await _transcriptFinalizedCb?.({
          callSid: meta.callSid,
          segments: this.segments,
          startedAt: this.startedAt,
          endedAt,
          direction: meta.direction,
          remoteNumber: meta.remoteNumber,
        });
      } catch (e) {
        console.warn('[transcription] finalize cb failed', e);
      }
    }
    this.segments = [];
    this._meta = null;
  }
}

export class DeviceManager {
  private device: Device | null = null;
  private call: Call | null = null;
  private settings: Settings | null = null;
  private refreshTimer: number | null = null;
  private retryAttempt = 0;
  private startedAt = 0;
  private muted = false;
  private transcription: TranscriptionController | null = null;

  async init(settings: Settings): Promise<void> {
    if (this.device) await this.teardown();
    this.settings = settings;
    emitDeviceState('initializing');

    try {
      const token = await fetchToken(settings.functionUrl, settings.clientIdentity);
      this.device = new Device(token, {
        codecPreferences: ['opus' as never, 'pcmu' as never],
        logLevel: 'warn',
        edge: 'roaming',
      });
      this.wireDevice();
      await this.device.register();
      this.retryAttempt = 0;
      this.scheduleRefresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      emitDeviceState('error', msg);
      this.scheduleRetry();
    }
  }

  private wireDevice(): void {
    const d = this.device!;
    d.on('registered', () => emitDeviceState('registered'));
    d.on('unregistered', () => emitDeviceState('offline'));
    d.on('error', (err: { message?: string; code?: number }) => {
      emitDeviceState('error', `${err.code ?? ''} ${err.message ?? 'unknown'}`.trim());
    });
    d.on('tokenWillExpire', () => {
      this.refreshToken().catch((e) => console.error('Token refresh failed', e));
    });
    d.on('incoming', (call: Call) => {
      this.bindCall(call, 'in');
      const from = call.parameters.From ?? 'Unknown';
      const callSid = call.parameters.CallSid ?? '';
      // Emit incoming via both storage channels
      storeSet({ incomingCall: { from, callSid, ts: Date.now() } });
      sendMsg({ type: 'call.incoming', from, callSid }).catch(() => {});
      emitCallState({ state: 'ringing', direction: 'in', from, sid: callSid });
    });
  }

  private bindCall(call: Call, direction: 'in' | 'out'): void {
    this.call = call;
    this.muted = false;
    this.startedAt = Date.now();

    const finalizeTranscription = async () => {
      const ctrl = this.transcription;
      this.transcription = null;
      if (!ctrl) return;
      try { await ctrl.finalize(); } catch (e) { console.warn('[transcription] finalize failed', e); }
    };

    call.on('accept', () => {
      this.startedAt = Date.now();
      emitCallState({ state: 'open', direction, sid: call.parameters.CallSid });

      // Start transcription: managed (our key, credits) if enabled, else BYO key.
      // Failure is always non-fatal — the call continues regardless.
      const apiKey = this.settings?.deepgramApiKey;
      const model = this.settings?.deepgramModel;
      const managedOn = this.settings?.managedTranscription;
      const callSid = call.parameters.CallSid ?? '';
      const remoteNumber = (call.parameters.From ?? call.parameters.To ?? '') as string;
      if (callSid && (managedOn || apiKey)) {
        this.transcription = new TranscriptionController();
        void (async () => {
          let managed: { userId: string } | undefined;
          if (managedOn) {
            const { cloudUserId } = await chrome.storage.local.get('cloudUserId');
            if (typeof cloudUserId === 'string' && cloudUserId) managed = { userId: cloudUserId };
          }
          // Managed needs an account; without one, fall back to a BYO key if set.
          if (!managed && !apiKey) {
            this.transcription = null;
            return;
          }
          const startOnce = () =>
            this.transcription!.start(
              call,
              callSid,
              direction,
              remoteNumber,
              apiKey ?? '',
              managed ? (model ?? 'nova-3') : model,
              managed,
            );
          try {
            await startOnce();
          } catch (e1) {
            // Transient connect race (managed-token / Deepgram socket). Retry once.
            console.warn('[transcription] start failed, retrying once', e1);
            await sleep(600);
            try {
              if (!this.transcription) return; // call may have ended during the wait
              await startOnce();
            } catch (e2) {
              console.warn('[transcription] start failed after retry', e2);
              this.transcription = null;
              _transcriptErrorCb?.(
                e2 instanceof Error ? e2 : new Error('Transcription unavailable for this call'),
              );
            }
          }
        })();
      }
    });
    call.on('ringing', () => {
      // Twilio fires 'ringing' once the remote leg starts ringing.
      // Surface 'ringing' phase to the UI so the user can distinguish "still dialing"
      // from "phone is actually ringing on the other end".
      emitCallState({ state: 'ringing', direction, sid: call.parameters.CallSid });
    });
    call.on('disconnect', async () => {
      const durationSec = Math.round((Date.now() - this.startedAt) / 1000);
      await finalizeTranscription();
      emitCallState({ state: 'closed', direction, durationSec, sid: call.parameters.CallSid });
      storeSet({ callState: null });
      this.call = null;
    });
    call.on('cancel', async () => {
      await finalizeTranscription();
      emitCallState({ state: 'closed', direction, durationSec: 0, sid: call.parameters.CallSid });
      storeSet({ callState: null });
      this.call = null;
    });
    call.on('reject', async () => {
      await finalizeTranscription();
      emitCallState({ state: 'closed', direction, durationSec: 0, sid: call.parameters.CallSid });
      storeSet({ callState: null });
      this.call = null;
    });
    call.on('error', async (e: { message?: string }) => {
      await finalizeTranscription();
      emitCallState({ state: 'closed', direction, durationSec: 0, sid: call.parameters.CallSid, error: e.message ?? 'call error' });
      storeSet({ callState: null });
      this.call = null;
    });
  }

  private async refreshToken(): Promise<void> {
    if (!this.settings || !this.device) return;
    try {
      const token = await fetchToken(this.settings.functionUrl, this.settings.clientIdentity);
      this.device.updateToken(token);
      this.scheduleRefresh();
    } catch (e) {
      emitDeviceState('error', 'Token refresh failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = self.setTimeout(() => this.refreshToken(), TOKEN_REFRESH_MS);
  }

  private scheduleRetry(): void {
    const idx = Math.min(this.retryAttempt, REGISTER_BACKOFF_MS.length - 1);
    const delay = REGISTER_BACKOFF_MS[idx];
    this.retryAttempt++;
    setTimeout(() => {
      if (this.settings) this.init(this.settings);
    }, delay);
  }

  async startCall(to: string, callerId?: string): Promise<void> {
    if (!this.device) throw new Error('Device not initialized');
    if (this.call) throw new Error('Already on a call');
    const params: Record<string, string> = { To: to };
    if (callerId) params.CallerId = callerId;
    const call = await this.device.connect({ params });
    this.bindCall(call, 'out');
    emitCallState({ state: 'connecting', direction: 'out', to });
  }

  hangup(): void { this.call?.disconnect(); }
  setMute(mute: boolean): void { this.muted = mute; this.call?.mute(mute); }
  sendDtmf(digit: string): void { this.call?.sendDigits(digit); }
  accept(): void { this.call?.accept(); }
  reject(): void { this.call?.reject(); }

  getState(): { hasDevice: boolean; hasCall: boolean; muted: boolean; deviceState: string; deviceError: string | undefined } {
    return { hasDevice: !!this.device, hasCall: !!this.call, muted: this.muted, deviceState: _devState, deviceError: _devError };
  }

  async teardown(): Promise<void> {
    if (this.refreshTimer) { clearTimeout(this.refreshTimer); this.refreshTimer = null; }
    if (this.call) { try { this.call.disconnect(); } catch { /* noop */ } this.call = null; }
    if (this.device) {
      try { await this.device.unregister(); } catch { /* noop */ }
      try { this.device.destroy(); } catch { /* noop */ }
      this.device = null;
    }
    emitDeviceState('uninitialized');
  }
}
