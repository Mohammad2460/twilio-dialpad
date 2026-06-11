/**
 * Managed transcription (P8.3) — our Deepgram key, metered by credits, for users
 * who don't BYO a key. Runs the live transcript over reconnect-per-window:
 *
 *   window N: backend settles window N-1 + reserves window N + mints a JWT →
 *   client connects DeepgramSession with that JWT → at window end, stop, rotate.
 *
 * A zero-balance user gets a 402 (no next token) → transcription stops gracefully
 * with `onStopped('insufficient_credits')`. The CALL IS NEVER AFFECTED — the
 * Deepgram connection is independent of the Twilio/WebRTC call.
 *
 * Our Deepgram key never reaches the client; only the ~60s JWT does.
 */
import { DeepgramSession } from './deepgram';
import { authHeader } from './cloud';
import type { TranscriptSegment } from './types';

const BASE_URL = 'https://dialler-mcp.vercel.app';

interface TokenResp {
  token: string;
  expiresIn: number;
  requestId: string;
  windowSeconds: number;
  model: string;
}

export interface ManagedTranscriptionOptions {
  userId: string;
  callSid: string;
  /** Stereo MediaStream (L=user, R=remote), same as the BYO path. */
  stream: MediaStream;
  /** ms epoch when the call started, for relative segment timestamps. */
  startedAt: number;
  model?: string;
  onSegment: (seg: TranscriptSegment) => void;
  /** Terminal stop. reason: 'insufficient_credits' | 'unavailable' | 'error'. */
  onStopped?: (reason: string) => void;
}

export class ManagedTranscription {
  private opts: ManagedTranscriptionOptions;
  private session: DeepgramSession | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private windowIdx = 0;
  private windowStart = 0;
  private prevRequestId: string | null = null;
  private prevModel = 'nova-3';

  constructor(opts: ManagedTranscriptionOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    await this.openWindow();
  }

  private elapsedSeconds(): number {
    return this.windowStart ? Math.max(0, Math.round((Date.now() - this.windowStart) / 1000)) : 0;
  }

  /** Settle the prior window (if any) + reserve the next + mint a token, then connect. */
  private async openWindow(): Promise<void> {
    if (this.stopped) return;
    const prevSeconds = this.prevRequestId ? this.elapsedSeconds() : undefined;

    let resp: Response;
    try {
      resp = await fetch(`${BASE_URL}/api/transcribe/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: await authHeader(this.opts.userId) },
        body: JSON.stringify({
          model: this.opts.model ?? 'nova-3',
          prevRequestId: this.prevRequestId ?? undefined,
          prevSeconds,
          windowKey: `${this.opts.callSid}:${this.windowIdx}`,
        }),
      });
    } catch {
      this.finish('error');
      return;
    }

    if (resp.status === 402) {
      this.finish('insufficient_credits');
      return;
    }
    if (resp.status === 503) {
      this.finish('unavailable');
      return;
    }
    if (!resp.ok) {
      this.finish('error');
      return;
    }

    const data = (await resp.json()) as TokenResp;
    this.prevRequestId = data.requestId;
    this.prevModel = data.model;
    this.windowIdx++;
    this.windowStart = Date.now();

    const session = new DeepgramSession({
      bearerToken: data.token,
      startedAt: this.opts.startedAt,
      onSegment: this.opts.onSegment,
      onError: (e) => console.warn('[managed-transcription] dg error', e),
      model: data.model,
    });
    this.session = session;
    try {
      await session.start(this.opts.stream);
    } catch (e) {
      console.warn('[managed-transcription] session start failed', e);
      this.finish('error');
      return;
    }

    // Rotate at window end: stop current (so its seconds settle on the next
    // /token call), then open the next window. Brief gap, no duplicate segments.
    this.timer = setTimeout(() => void this.rotate(), data.windowSeconds * 1000);
  }

  private async rotate(): Promise<void> {
    if (this.stopped) return;
    const old = this.session;
    this.session = null;
    try {
      await old?.stop();
    } catch {
      /* noop */
    }
    await this.openWindow();
  }

  /** Terminal stop from inside (402 / error). Settles the last window best-effort. */
  private finish(reason: string): void {
    if (this.stopped) return;
    void this.stop();
    this.opts.onStopped?.(reason);
  }

  /** External stop (call ended). Settles the final window. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    const seconds = this.elapsedSeconds();
    const reqId = this.prevRequestId;
    try {
      await this.session?.stop();
    } catch {
      /* noop */
    }
    this.session = null;
    if (reqId) {
      try {
        await fetch(`${BASE_URL}/api/transcribe/settle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: await authHeader(this.opts.userId) },
          body: JSON.stringify({ requestId: reqId, seconds, model: this.prevModel }),
        });
      } catch {
        /* reaper backstops a missed final settle */
      }
    }
  }
}
