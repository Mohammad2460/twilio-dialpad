import { z } from 'zod';

export const MsgSchema = z.discriminatedUnion('type', [
  // Side panel / options → offscreen (via SW)
  z.object({ type: z.literal('device.init') }),
  z.object({ type: z.literal('device.teardown') }),
  z.object({ type: z.literal('device.status') }),
  z.object({ type: z.literal('call.start'), to: z.string().min(1) }),
  z.object({ type: z.literal('call.hangup') }),
  z.object({ type: z.literal('call.mute'), mute: z.boolean() }),
  z.object({ type: z.literal('call.dtmf'), digit: z.string().length(1) }),
  z.object({ type: z.literal('call.accept') }),
  z.object({ type: z.literal('call.reject') }),

  // Offscreen → side panel (broadcast)
  z.object({
    type: z.literal('device.state'),
    state: z.enum(['uninitialized', 'initializing', 'registered', 'offline', 'error']),
    error: z.string().optional(),
  }),
  z.object({
    type: z.literal('call.state'),
    state: z.enum(['idle', 'ringing', 'connecting', 'open', 'closed']),
    direction: z.enum(['in', 'out']),
    sid: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    durationSec: z.number().optional(),
    error: z.string().optional(),
  }),
  z.object({
    type: z.literal('call.incoming'),
    from: z.string(),
    callSid: z.string(),
  }),

  // Heartbeat
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('pong') }),
]);

export type Msg = z.infer<typeof MsgSchema>;

export async function sendMsg(msg: Msg): Promise<unknown> {
  return chrome.runtime.sendMessage(msg);
}

export function onMsg(handler: (msg: Msg, sender: chrome.runtime.MessageSender) => void | Promise<unknown>): void {
  chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    const parsed = MsgSchema.safeParse(raw);
    if (!parsed.success) return false;
    const result = handler(parsed.data, sender);
    if (result instanceof Promise) {
      result.then((v) => { if (v !== undefined) sendResponse(v); })
             .catch((e) => sendResponse({ error: String(e) }));
      return true; // keep channel open for async response
    }
    // Synchronous return — call sendResponse immediately, then close channel.
    if (result !== undefined) sendResponse(result);
    return false;
  });
}
