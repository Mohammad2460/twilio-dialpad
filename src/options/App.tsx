import { useEffect, useState } from 'react';
import { ProvisioningWizard } from './ProvisioningWizard';
import { storage } from '@shared/storage';
import type { Settings } from '@shared/types';
import { maskSid } from '@shared/twilio-rest';
import { pushConfig } from '@shared/twilio-env';
import { normalizeE164 } from '@shared/phone';
import { testDeepgramKey } from '@shared/deepgram';
import { prefs } from '@shared/transcripts';
import { ensureCloudAccount } from '@shared/cloud';

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

        {/* Microphone permission — must be granted from a full tab, not side panel */}
        <MicPermissionCard />

        {/* Claude AI connector — zero-config for non-technical users */}
        <ClaudeConnectorCard />

        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <dt className="text-gray-500">Account SID</dt>
            <dd className="font-mono">{maskSid(settings.accountSid)}</dd>
            <dt className="text-gray-500">API Key</dt>
            <dd className="font-mono">{maskSid(settings.apiKeySid)}</dd>
            <dt className="text-gray-500">TwiML App</dt>
            <dd className="font-mono">{maskSid(settings.twimlAppSid)}</dd>
            <dt className="text-gray-500">Function URL</dt>
            <dd className="font-mono break-all">{settings.functionUrl}</dd>
            <dt className="text-gray-500">Client identity</dt>
            <dd className="font-mono">{settings.clientIdentity}</dd>
            <dt className="text-gray-500">Caller ID</dt>
            <dd className="font-mono">{settings.defaultCallerId}</dd>
          </dl>
        </div>

        <IncomingCallsCard settings={settings} onUpdate={setSettings} />
        <DeepgramCard settings={settings} onUpdate={setSettings} />
        <TranscriptStorageCard settings={settings} onUpdate={setSettings} />
        <HubSpotCard settings={settings} onUpdate={setSettings} />

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setReconfigure(true)}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Reconfigure
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!confirm('Clear all settings? You will need to run setup again.')) return;
              await storage.clearSettings();
              setSettings(null);
            }}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Reset
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
// Incoming Calls Card — accept toggle + forwarding setup
// ──────────────────────────────────────────────────────────────

function IncomingCallsCard({ settings, onUpdate }: { settings: Settings; onUpdate: (s: Settings) => void }) {
  const [incomingEnabled, setIncomingEnabled] = useState<boolean>(settings.incomingEnabled ?? true);
  const [forwardEnabled, setForwardEnabled] = useState<boolean>(settings.forwardEnabled ?? false);
  const [forwardNumber, setForwardNumber] = useState<string>(settings.forwardNumber ?? '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');

  const hasConfigSupport = !!(settings.serviceSid && settings.environmentSid && settings.configSecret);

  async function save() {
    setStatus('saving');
    setError('');
    let normalized = '';
    if (forwardEnabled) {
      const norm = normalizeE164(forwardNumber);
      if (!norm.ok || !norm.e164) {
        setError(norm.reason ?? 'Invalid forward number');
        setStatus('error');
        return;
      }
      normalized = norm.e164;
    }
    try {
      // Push to Twilio Function first; only persist locally if remote update succeeds.
      await pushConfig(settings, {
        incomingEnabled,
        forwardEnabled,
        forwardNumber: normalized,
      });
      const updated = await storage.updateSettings({
        incomingEnabled,
        forwardEnabled,
        forwardNumber: normalized,
      });
      if (updated) onUpdate(updated);
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Incoming Calls</h2>
        <p className="mt-1 text-xs text-gray-500">Control whether incoming calls ring the extension or forward to your personal phone.</p>
      </div>

      {!hasConfigSupport && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          ⚠ Re-run setup to enable forwarding. Your installation predates this feature.
        </div>
      )}

      <ToggleRow
        label="Accept incoming calls on this extension"
        description="When off, calls go straight to your forward number (or are rejected if forwarding is off)."
        checked={incomingEnabled}
        onChange={setIncomingEnabled}
      />

      <ToggleRow
        label="Forward when I don't answer"
        description="If extension doesn't pick up within 20s, ring your personal phone."
        checked={forwardEnabled}
        onChange={setForwardEnabled}
      />

      {forwardEnabled && (
        <div>
          <label className="block text-xs font-medium text-gray-700">Forward to (E.164)</label>
          <input
            type="tel"
            value={forwardNumber}
            onChange={(e) => setForwardNumber(e.target.value)}
            placeholder="+14155551234"
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={save}
          disabled={!hasConfigSupport || status === 'saving'}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {status === 'saving' ? 'Saving…' : 'Save'}
        </button>
        {status === 'saved' && <span className="text-sm text-green-700">✓ Saved</span>}
        {status === 'error' && <span className="text-sm text-red-700 break-all">{error}</span>}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// HubSpot CRM Card — token + portalId
// ──────────────────────────────────────────────────────────────

function HubSpotCard({ settings, onUpdate }: { settings: Settings; onUpdate: (s: Settings) => void }) {
  const [token, setToken] = useState<string>(settings.hubspotToken ?? '');
  const [portalId, setPortalId] = useState<string>(settings.hubspotPortalId ?? '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');

  async function save() {
    setStatus('saving');
    setError('');
    try {
      const trimmedToken = token.trim();
      const trimmedPortal = portalId.trim();
      const updated = await storage.updateSettings({
        hubspotToken: trimmedToken || undefined,
        hubspotPortalId: trimmedPortal || undefined,
      });
      if (updated) onUpdate(updated);
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect HubSpot? Incoming calls will no longer show contact info.')) return;
    setToken('');
    setPortalId('');
    const updated = await storage.updateSettings({
      hubspotToken: undefined,
      hubspotPortalId: undefined,
    });
    if (updated) onUpdate(updated);
  }

  const connected = !!(settings.hubspotToken && settings.hubspotPortalId);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-gray-900">HubSpot Integration</h2>
          <p className="mt-1 text-xs text-gray-500">
            Reverse-look up contacts on incoming calls and auto-open the HubSpot record in a new tab.{' '}
            <a
              href="https://developers.hubspot.com/docs/api/private-apps"
              target="_blank"
              rel="noreferrer"
              className="text-brand-600 hover:underline"
            >
              How to create a Private App ↗
            </a>
          </p>
        </div>
        {connected && (
          <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
            Connected
          </span>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700">Private App access token</label>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="pat-na1-..."
          autoComplete="off"
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
        <p className="mt-1 text-xs text-gray-400">Required scopes: <code>crm.objects.contacts.read</code></p>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700">Portal ID (Account ID)</label>
        <input
          type="text"
          value={portalId}
          onChange={(e) => setPortalId(e.target.value)}
          placeholder="12345678"
          inputMode="numeric"
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
        <p className="mt-1 text-xs text-gray-400">Find in HubSpot URL after `/contacts/`</p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={status === 'saving' || (!token.trim() && !connected)}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {status === 'saving' ? 'Saving…' : 'Save'}
        </button>
        {connected && (
          <button
            type="button"
            onClick={disconnect}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Disconnect
          </button>
        )}
        {status === 'saved' && <span className="text-sm text-green-700">✓ Saved</span>}
        {status === 'error' && <span className="text-sm text-red-700 break-all">{error}</span>}
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-gray-900">{label}</div>
        {description && <div className="mt-0.5 text-xs text-gray-500">{description}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={[
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition',
          checked ? 'bg-green-500' : 'bg-gray-300',
        ].join(' ')}
      >
        <span
          className={[
            'inline-block h-4 w-4 transform rounded-full bg-white transition',
            checked ? 'translate-x-6' : 'translate-x-1',
          ].join(' ')}
        />
      </button>
    </label>
  );
}

// ──────────────────────────────────────────────────────────────
// Deepgram Card — live transcription API key
// ──────────────────────────────────────────────────────────────

function DeepgramCard({ settings, onUpdate }: { settings: Settings; onUpdate: (s: Settings) => void }) {
  const [key, setKey] = useState<string>(settings.deepgramApiKey ?? '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const connected = !!settings.deepgramApiKey;

  async function save() {
    setStatus('saving');
    setError('');
    try {
      const trimmed = key.trim();
      const updated = await storage.updateSettings({ deepgramApiKey: trimmed || undefined });
      if (updated) onUpdate(updated);
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  async function test() {
    if (!key.trim()) return;
    setTesting(true);
    setError('');
    try {
      const ok = await testDeepgramKey(key.trim());
      if (ok) {
        setStatus('saved');
        setTimeout(() => setStatus('idle'), 2500);
      } else {
        setError('Key rejected by Deepgram');
        setStatus('error');
      }
    } finally {
      setTesting(false);
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect Deepgram? Future calls will not be transcribed.')) return;
    setKey('');
    const updated = await storage.updateSettings({ deepgramApiKey: undefined });
    if (updated) onUpdate(updated);
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Call Transcription (Deepgram)</h2>
          <p className="mt-1 text-xs text-gray-500">
            Auto-transcribe every call with speaker labels. Always-on once a valid key is saved.{' '}
            <a
              href="https://console.deepgram.com/signup"
              target="_blank"
              rel="noreferrer"
              className="text-brand-600 hover:underline"
            >
              Get a Deepgram API key ↗
            </a>
          </p>
        </div>
        {connected && (
          <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
            Connected
          </span>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700">Deepgram API key</label>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="bbXXXX..."
          autoComplete="off"
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
        <p className="mt-1 text-xs text-gray-400">Used only in your browser. Never sent to any server we operate.</p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={status === 'saving' || (!key.trim() && !connected)}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {status === 'saving' ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={test}
          disabled={!key.trim() || testing}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {testing ? 'Testing…' : 'Test key'}
        </button>
        {connected && (
          <button
            type="button"
            onClick={disconnect}
            className="rounded-md px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            Disconnect
          </button>
        )}
        {status === 'saved' && <span className="text-sm text-green-700">✓ OK</span>}
        {status === 'error' && <span className="text-sm text-red-700 break-all">{error}</span>}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Transcript Storage Card — folder picker for MCP sync
// ──────────────────────────────────────────────────────────────

const TRANSCRIPT_FOLDER_KEY = 'transcriptFolderHandle';

function TranscriptStorageCard({ onUpdate }: { settings?: Settings; onUpdate: (s: Settings) => void }) {
  const [folderName, setFolderName] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'picking' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');
  const supportsAPI = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  useEffect(() => {
    // Load existing handle name on mount.
    prefs.get<FileSystemDirectoryHandle>(TRANSCRIPT_FOLDER_KEY).then((handle) => {
      if (handle) setFolderName(handle.name);
    });
  }, []);

  async function pickFolder() {
    if (!supportsAPI) {
      setError('File System Access API not supported in this browser.');
      setStatus('error');
      return;
    }
    setStatus('picking');
    setError('');
    try {
      // showDirectoryPicker requires a user gesture — must be called sync from click handler.
      const handle = await (window as unknown as {
        showDirectoryPicker: (opts: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
      }).showDirectoryPicker({ id: 'twilio-dialer', mode: 'readwrite' });
      await prefs.set(TRANSCRIPT_FOLDER_KEY, handle);
      const updated = await storage.updateSettings({ transcriptFolderConfigured: true });
      if (updated) onUpdate(updated);
      setFolderName(handle.name);
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2500);
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') {
        setStatus('idle');
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect sync folder? Existing files stay where they are.')) return;
    await prefs.remove(TRANSCRIPT_FOLDER_KEY);
    const updated = await storage.updateSettings({ transcriptFolderConfigured: false });
    if (updated) onUpdate(updated);
    setFolderName(null);
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Transcript Sync Folder</h2>
          <p className="mt-1 text-xs text-gray-500">
            Pick a folder where transcripts get saved as JSON files. The MCP server reads from this folder so Claude can access your call data.
          </p>
        </div>
        {folderName && (
          <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
            ✓ {folderName}
          </span>
        )}
      </div>

      {!supportsAPI && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          This browser doesn&apos;t support folder picking. Use Chrome 86+ or Edge.
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={pickFolder}
          disabled={!supportsAPI || status === 'picking'}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {status === 'picking' ? 'Picking…' : folderName ? 'Change folder' : 'Choose folder'}
        </button>
        {folderName && (
          <button
            type="button"
            onClick={disconnect}
            className="rounded-md px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            Disconnect
          </button>
        )}
        {status === 'saved' && <span className="text-sm text-green-700">✓ Saved</span>}
        {status === 'error' && <span className="text-sm text-red-700 break-all">{error}</span>}
      </div>

      <p className="text-xs text-gray-400">
        Files are written as <code className="rounded bg-gray-100 px-1">{'{folder}/calls/{callSid}.json'}</code> after each call ends.
      </p>
    </div>
  );
}

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

// ──────────────────────────────────────────────────────────────
// Claude Connector Card — zero-config MCP URL for Claude.ai
// ──────────────────────────────────────────────────────────────

function ClaudeConnectorCard() {
  const [mcpUrl, setMcpUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    ensureCloudAccount()
      .then(({ mcpUrl }) => setMcpUrl(mcpUrl))
      .catch(() => {/* server unreachable — show retry UI */})
      .finally(() => setLoading(false));
  }, []);

  async function handleCopy() {
    if (!mcpUrl) return;
    try {
      await navigator.clipboard.writeText(mcpUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select text
    }
  }

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="text-2xl">🔗</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-blue-900">Connect to Claude AI</h2>
          <p className="mt-1 text-sm text-blue-700">
            Paste your personal URL in{' '}
            <a
              href="https://claude.ai"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Claude.ai
            </a>{' '}
            → Settings → Integrations → Add MCP Server. Claude will be able to read
            your call transcripts and answer questions about them.
          </p>

          {loading && (
            <p className="mt-3 text-sm text-blue-600 animate-pulse">Setting up your connector…</p>
          )}

          {!loading && !mcpUrl && (
            <p className="mt-3 text-sm text-red-600">
              Could not reach cloud server. Check your connection and reload this page.
            </p>
          )}

          {mcpUrl && (
            <div className="mt-3 flex items-center gap-2">
              <code className="flex-1 rounded bg-blue-100 px-3 py-2 text-xs font-mono text-blue-900 break-all select-all">
                {mcpUrl}
              </code>
              <button
                type="button"
                onClick={handleCopy}
                className="shrink-0 rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          )}

          {mcpUrl && (
            <p className="mt-2 text-xs text-blue-600">
              This URL is your private key — keep it to yourself.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
