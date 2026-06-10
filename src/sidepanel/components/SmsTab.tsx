import { useEffect, useState, useCallback } from 'react';
import { ensureCloudAccount } from '@shared/cloud';
import { listThreads, sendSms, type SmsThread } from '@shared/twilio-sms';
import { normalizeE164, formatForDisplay } from '@shared/phone';
import { PaywallGate } from './PaywallGate';

export function SmsTab() {
  return (
    <PaywallGate feature="sms">
      <SmsInner />
    </PaywallGate>
  );
}

function SmsInner() {
  const [userId, setUserId] = useState<string | null>(null);
  const [threads, setThreads] = useState<SmsThread[]>([]);
  const [active, setActive] = useState<string | null>(null); // peer number, or '__new__'
  const [loading, setLoading] = useState(true);
  const [to, setTo] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async (uid: string) => {
    setThreads(await listThreads(uid));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const acct = await ensureCloudAccount();
        if (cancelled) return;
        setUserId(acct.userId);
        await refresh(acct.userId);
      } catch {
        /* not registered — empty state */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  async function send() {
    if (!userId) return;
    const target = active && active !== '__new__' ? active : normalizeE164(to).e164 ?? to.trim();
    if (!target || !body.trim()) return;
    setSending(true);
    setErr(null);
    const res = await sendSms(userId, target, body.trim());
    setSending(false);
    if (!res.ok) {
      setErr(res.error === 'subscription_required' ? 'Pro required to send SMS.' : res.error ?? 'Send failed.');
      return;
    }
    setBody('');
    setActive(target);
    await refresh(userId);
  }

  if (loading) {
    return <div className="p-4 text-sm text-gray-400">Loading messages…</div>;
  }

  const activeThread = threads.find((t) => t.peer === active);

  // Thread view
  if (active) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
          <button type="button" onClick={() => setActive(null)} className="text-sm text-brand-600">←</button>
          <span className="text-sm font-medium text-gray-900">
            {active === '__new__' ? 'New message' : formatForDisplay(active)}
          </span>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
          {active === '__new__' && (
            <input
              type="tel"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="+1 234 567 8900"
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            />
          )}
          {activeThread?.messages.map((m) => (
            <div key={m.id} className={['flex', m.direction === 'out' ? 'justify-end' : 'justify-start'].join(' ')}>
              <span
                className={[
                  'max-w-[80%] rounded-2xl px-3 py-1.5 text-sm',
                  m.direction === 'out' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-900',
                ].join(' ')}
              >
                {m.body}
              </span>
            </div>
          ))}
        </div>
        {err && <p className="px-3 text-xs text-red-600">{err}</p>}
        <div className="flex items-center gap-2 border-t border-gray-100 p-2">
          <input
            type="text"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Type a message…"
            className="flex-1 rounded-full border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-brand-500"
            onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          />
          <button
            type="button"
            onClick={send}
            disabled={sending || !body.trim()}
            className="rounded-full bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {sending ? '…' : 'Send'}
          </button>
        </div>
      </div>
    );
  }

  // Thread list
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
        <h1 className="text-sm font-semibold text-gray-900">Messages</h1>
        <button
          type="button"
          onClick={() => { setActive('__new__'); setTo(''); setBody(''); }}
          className="rounded-full bg-brand-600 px-3 py-1 text-xs font-medium text-white"
        >
          New
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 && (
          <p className="p-4 text-sm text-gray-400">
            No messages yet. Tap “New” to text a prospect. (Requires “Enable SMS” in Settings.)
          </p>
        )}
        {threads.map((t) => {
          const last = t.messages[t.messages.length - 1];
          return (
            <button
              key={t.peer}
              type="button"
              onClick={() => setActive(t.peer)}
              className="flex w-full flex-col items-start border-b border-gray-100 px-4 py-2 text-left hover:bg-gray-50"
            >
              <span className="text-sm font-medium text-gray-900">{formatForDisplay(t.peer)}</span>
              <span className="line-clamp-1 text-xs text-gray-500">{last?.body}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
