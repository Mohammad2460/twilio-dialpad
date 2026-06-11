import { useEffect, useState } from 'react';
import { ProvisioningWizard } from './ProvisioningWizard';
import { storage } from '@shared/storage';
import type { Settings } from '@shared/types';

/**
 * Options tab = SETUP SURFACE ONLY. It exists for the two things that genuinely
 * need a full browser tab: the Twilio provisioning wizard and the microphone
 * permission grant (getUserMedia cannot prompt from the side panel). Everything
 * else — transcription, Claude connector, SMS, recordings, subscription, credits —
 * lives in the side panel and is intentionally NOT duplicated here.
 */
export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [reconfigure, setReconfigure] = useState(false);

  useEffect(() => {
    storage.getSettings().then((s) => {
      setSettings(s);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="p-8">Loading…</div>;

  if (settings && !reconfigure) {
    return (
      <div className="mx-auto max-w-2xl p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Twilio Dialpad</h1>
          <p className="mt-1 text-sm text-green-700 font-medium">✓ Configured</p>
        </div>

        {/* Microphone permission — must be granted from a full tab, not the side panel. */}
        <MicPermissionCard />

        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          Everything else — Twilio details, transcription, Claude connector, SMS,
          recordings, subscription &amp; credits — now lives in the <strong>side panel</strong>.
          Open the extension from the toolbar.
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setReconfigure(true)}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Reconfigure Twilio
          </button>
        </div>
      </div>
    );
  }

  return (
    <ProvisioningWizard
      initial={settings ?? undefined}
      onDone={(s) => {
        setSettings(s);
        setReconfigure(false);
      }}
    />
  );
}

// ──────────────────────────────────────────────────────────────
// Microphone permission card — getUserMedia needs a full tab to prompt.
// ──────────────────────────────────────────────────────────────

function MicPermissionCard() {
  const [status, setStatus] = useState<'idle' | 'granted' | 'denied' | 'checking'>('idle');
  const extId = chrome.runtime.id;

  async function requestMic() {
    setStatus('checking');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setStatus('granted');
      // Kick off device init now that mic is available
      chrome.runtime.sendMessage({ type: 'device.init' }).catch(() => {});
    } catch {
      setStatus('denied');
    }
  }

  if (status === 'granted') {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
        ✓ Microphone access granted. Close this tab and open the side panel — it should show <strong>Ready</strong>.
      </div>
    );
  }

  return (
    <div className={[
      'rounded-lg border p-4 text-sm',
      status === 'denied' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50',
    ].join(' ')}>
      <p className="font-medium text-gray-900 mb-2">🎤 Microphone permission required</p>

      {status !== 'denied' && (
        <>
          <p className="text-gray-700 mb-3">
            Chrome needs to grant microphone access to this extension before calls work.
            Click the button below — a Chrome permission prompt will appear at the top of this tab.
          </p>
          <button
            type="button"
            onClick={requestMic}
            disabled={status === 'checking'}
            className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {status === 'checking' ? 'Requesting…' : 'Grant microphone access'}
          </button>
        </>
      )}

      {status === 'denied' && (
        <div className="space-y-3">
          <p className="text-red-800">
            Chrome blocked microphone access. Follow these steps to fix it:
          </p>
          <ol className="list-decimal pl-5 space-y-1 text-red-800">
            <li>
              Open{' '}
              <button
                type="button"
                onClick={() => chrome.tabs.create({ url: 'chrome://settings/content/microphone' })}
                className="underline font-medium"
              >
                chrome://settings/content/microphone
              </button>
            </li>
            <li>
              Under <strong>"Not allowed"</strong>, look for your extension ID:{' '}
              <code className="bg-red-100 px-1 rounded font-mono text-xs">{extId}</code>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(extId)}
                className="ml-2 text-xs underline"
              >
                copy
              </button>
            </li>
            <li>Click the trash icon next to it to remove the block.</li>
            <li>Come back here and click "Grant microphone access" again.</li>
          </ol>
          <button
            type="button"
            onClick={() => setStatus('idle')}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
