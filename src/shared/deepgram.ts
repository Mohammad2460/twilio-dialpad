/**
 * Deepgram live streaming client — WebSocket transport.
 *
 * Auth: passed via the WebSocket subprotocol `["token", apiKey]`.
 *
 * Listens on a stereo MediaStream (L = user, R = remote), uses MediaRecorder
 * to encode opus chunks at ~250 ms intervals, and pushes them to Deepgram.
 *
 * Emits transcript events. Caller subscribes via `onSegment` callback.
 *
 * No SDK dependency — keeps bundle small. ~3 KB gzipped.
 */

import type { TranscriptSegment } from './types';

export interface DeepgramSessionOptions {
  apiKey: string;
  /** ms since call start when this session began — used to compute relative ts. */
  startedAt: number;
  /** Called for every interim + final segment. */
  onSegment: (seg: TranscriptSegment) => void;
  /** Called on terminal errors (auth fail, network give-up). */
  onError?: (err: Error) => void;
  /** Optional language hint, default 'en-US'. */
  language?: string;
}

interface DeepgramAlternative {
  transcript: string;
}

interface DeepgramChannel {
  alternatives: DeepgramAlternative[];
}

interface DeepgramMessage {
  type?: string;
  channel_index?: [number, number]; // [channelIndex, totalChannels]
  channel?: DeepgramChannel;
  is_final?: boolean;
  speech_final?: boolean;
  start?: number;
  duration?: number;
}

const DEEPGRAM_WS = 'wss://api.deepgram.com/v1/listen';

export class DeepgramSession {
  private ws: WebSocket | null = null;
  private recorder: MediaRecorder | null = null;
  private opts: DeepgramSessionOptions;
  private stopped = false;
  private retryAttempted = false;

  constructor(opts: DeepgramSessionOptions) {
    this.opts = opts;
  }

  async start(stereoStream: MediaStream): Promise<void> {
    const language = this.opts.language ?? 'en-US';
    // NOTE: We send WebM-container-wrapped opus from MediaRecorder.
    // Deepgram auto-detects WebM containers when `encoding` is omitted.
    // Specifying `encoding=opus` makes DG expect raw opus — mismatch = silent decode failure.
    const params = new URLSearchParams({
      model: 'nova-2',
      language,
      channels: '2',
      multichannel: 'true',
      interim_results: 'true',
      smart_format: 'true',
      punctuate: 'true',
    });
    const url = `${DEEPGRAM_WS}?${params.toString()}`;
    console.log('[deepgram] connecting', url);

    // WebSocket subprotocol auth: ["token", "<api key>"]
    this.ws = new WebSocket(url, ['token', this.opts.apiKey]);
    this.ws.binaryType = 'arraybuffer';

    return new Promise<void>((resolve, reject) => {
      const ws = this.ws!;
      ws.onopen = () => {
        try {
          this.startRecorder(stereoStream);
          resolve();
        } catch (e) {
          reject(e);
        }
      };
      ws.onmessage = (ev) => this.handleMessage(ev);
      ws.onerror = (ev) => {
        console.warn('[deepgram] ws error', ev);
        if (!this.retryAttempted) {
          this.retryAttempted = true;
          setTimeout(() => {
            if (this.stopped) return;
            this.start(stereoStream).catch((e) => this.opts.onError?.(e));
          }, 500);
        } else {
          this.opts.onError?.(new Error('Deepgram WebSocket error (check API key + network)'));
        }
      };
      ws.onclose = (ev) => {
        console.log('[deepgram] ws closed', { code: ev.code, reason: ev.reason });
        if (this.stopped) return;
        if (ev.code === 1008 || ev.code === 4001 || ev.code === 4008) {
          this.opts.onError?.(new Error(`Deepgram auth failed (code ${ev.code}). Check API key.`));
        } else if (ev.code !== 1000 && ev.code !== 1005) {
          this.opts.onError?.(new Error(`Deepgram closed: code=${ev.code} reason=${ev.reason || 'unknown'}`));
        }
      };
    });
  }

  private startRecorder(stream: MediaStream): void {
    // Prefer opus in webm container — broadly supported by Chromium.
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    this.recorder = new MediaRecorder(stream, { mimeType });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
        e.data.arrayBuffer().then((buf) => {
          try { this.ws?.send(buf); } catch { /* noop */ }
        });
      }
    };
    this.recorder.start(250); // 250 ms timeslices
  }

  private handleMessage(ev: MessageEvent): void {
    let msg: DeepgramMessage;
    try {
      msg = JSON.parse(ev.data as string);
    } catch {
      return;
    }
    if (msg.type === 'Metadata' || msg.type === 'SpeechStarted') return;

    const alt = msg.channel?.alternatives?.[0];
    const text = (alt?.transcript ?? '').trim();
    if (!text) return;

    // channel_index = [channelIdx, totalChannels]
    const channelIdx = msg.channel_index?.[0] ?? 0;
    const speaker: 'user' | 'remote' = channelIdx === 0 ? 'user' : 'remote';
    const ts = Math.max(0, Date.now() - this.opts.startedAt);

    this.opts.onSegment({
      ts,
      speaker,
      text,
      isFinal: !!msg.is_final,
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    try {
      if (this.recorder && this.recorder.state !== 'inactive') {
        this.recorder.stop();
      }
    } catch { /* noop */ }
    this.recorder = null;
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Send the "CloseStream" finalize message Deepgram expects.
        this.ws.send(JSON.stringify({ type: 'CloseStream' }));
      }
    } catch { /* noop */ }
    try { this.ws?.close(); } catch { /* noop */ }
    this.ws = null;
  }
}

/** Lightweight test — hit Deepgram's /projects endpoint with the key. */
export async function testDeepgramKey(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.deepgram.com/v1/projects', {
      headers: { Authorization: `Token ${apiKey}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}
