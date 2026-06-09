import { useEffect, useState } from 'react';
import { useCallStore } from '../stores/call-store';
import { storage } from '@shared/storage';
import type { Settings } from '@shared/types';
import { maskSid } from '@shared/twilio-rest';
import { pushConfig } from '@shared/twilio-env';
import { ensureCloudAccount } from '@shared/cloud';

const DEEPGRAM_MODELS = [
  ['nova-3', 'Nova-3 — most accurate'],
  ['nova-2', 'Nova-2 — default, fast'],
  ['nova-3-medical', 'Nova-3 Medical'],
  ['enhanced', 'Enhanced'],
  ['base', 'Base — cheapest'],
] as const;

/** Settings home inside the side panel. Self-contained; reads/writes via storage. */
export function SettingsTab() {
  const settings = useCallStore((s) => s.settings);
  const setSettings = useCallStore((s) => s.setSettings);

  if (!settings) return null;

  const update = async (patch: Partial<Settings>) => {
    const next = await storage.updateSettings(patch);
    if (next) setSettings(next);
  };

  return (
    <div className="space-y-5 p-4">
      <h1 className="text-lg font-semibold text-gray-900">Settings</h1>

      <CallSettingsSection settings={settings} onUpdate={setSettings} />
      <AISection settings={settings} onUpdate={update} />
      <ExtensionPrefsSection settings={settings} onUpdate={update} />
      <AccountSection settings={settings} />
      <HelpSection />
    </div>
  );
}

// ── reusable bits ─────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Toggle({
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
    <label className="flex cursor-pointer items-start justify-between gap-3">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-gray-900">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-gray-500">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
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

// ── sections ──────────────────────────────────────────────────────

function CallSettingsSection({
  settings,
  onUpdate,
}: {
  settings: Settings;
  onUpdate: (s: Settings) => void;
}) {
  const [incoming, setIncoming] = useState(settings.incomingEnabled ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const canConfig = !!(settings.serviceSid && settings.environmentSid && settings.configSecret);

  async function toggleIncoming(v: boolean) {
    setIncoming(v);
    setBusy(true);
    setErr(null);
    try {
      await pushConfig(settings, { incomingEnabled: v });
      const next = await storage.updateSettings({ incomingEnabled: v });
      if (next) onUpdate(next);
    } catch (e) {
      setIncoming(!v); // revert
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Calls">
      {canConfig ? (
        <Toggle
          label="Receive incoming calls"
          description="Ring this browser when someone calls your Twilio number."
          checked={incoming}
          onChange={toggleIncoming}
        />
      ) : (
        <p className="text-xs text-gray-500">
          Re-run setup to manage incoming-call routing here.
        </p>
      )}
      {busy && <p className="text-xs text-gray-400">Saving…</p>}
      {err && <p className="text-xs text-red-600 break-all">{err}</p>}
      <button
        type="button"
        onClick={() => chrome.runtime.openOptionsPage()}
        className="text-xs font-medium text-brand-600 hover:underline"
      >
        Advanced call settings (forwarding, voicemail) →
      </button>
    </Section>
  );
}

function AISection({
  settings,
  onUpdate,
}: {
  settings: Settings;
  onUpdate: (p: Partial<Settings>) => Promise<void>;
}) {
  const [key, setKey] = useState(settings.deepgramApiKey ?? '');
  const [saved, setSaved] = useState(false);
  const connected = !!settings.deepgramApiKey;
  const [mcpUrl, setMcpUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    ensureCloudAccount()
      .then((a) => setMcpUrl(a.mcpUrl))
      .catch(() => setMcpUrl(null));
  }, []);

  async function saveKey() {
    await onUpdate({ deepgramApiKey: key.trim() || undefined });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <Section title="AI & Transcription">
      <div>
        <label className="block text-xs font-medium text-gray-700">
          Deepgram API key {connected && <span className="text-green-600">· connected</span>}
        </label>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Bring your own Deepgram key"
          autoComplete="off"
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        />
        <p className="mt-1 text-xs text-gray-400">Stored only in this browser. Powers live call transcripts.</p>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700">Transcription model</label>
        <select
          value={settings.deepgramModel ?? 'nova-2'}
          onChange={(e) => onUpdate({ deepgramModel: e.target.value })}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
        >
          {DEEPGRAM_MODELS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={saveKey}
        className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
      >
        {saved ? '✓ Saved' : 'Save'}
      </button>

      {mcpUrl && (
        <div className="border-t border-gray-100 pt-3">
          <p className="text-xs font-medium text-gray-700">Claude AI connector (MCP)</p>
          <p className="mt-0.5 text-xs text-gray-500">
            Connect this URL in Claude to analyze your calls. Keep it private.
          </p>
          <div className="mt-1 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-gray-50 px-2 py-1 text-xs">{mcpUrl}</code>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(mcpUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="shrink-0 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}

function ExtensionPrefsSection({
  settings,
  onUpdate,
}: {
  settings: Settings;
  onUpdate: (p: Partial<Settings>) => Promise<void>;
}) {
  return (
    <Section title="Extension">
      <Toggle
        label="Click-to-call on web pages"
        description="Make phone numbers on any page callable."
        checked={settings.clickToCallEnabled ?? false}
        onChange={(v) => onUpdate({ clickToCallEnabled: v })}
      />
      <Toggle
        label="Floating call button"
        description="Show a quick-dial bubble on pages."
        checked={settings.floatingIconEnabled ?? false}
        onChange={(v) => onUpdate({ floatingIconEnabled: v })}
      />
      <Toggle
        label="Smart paste"
        description="Clean pasted numbers into E.164 automatically."
        checked={settings.smartCopyEnabled ?? false}
        onChange={(v) => onUpdate({ smartCopyEnabled: v })}
      />
    </Section>
  );
}

function AccountSection({ settings }: { settings: Settings }) {
  async function signOut() {
    const ok = confirm(
      'Sign out of this device?\n\nTwilio credentials, call history, caller IDs and cloud binding are cleared from this browser. Locally saved transcripts remain. Your subscription is NOT cancelled.',
    );
    if (!ok) return;
    await storage.signOut();
    // Settings listener in the app will flip to the NotConfigured screen.
    location.reload();
  }

  return (
    <Section title="Account">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-gray-500">Account SID</dt>
        <dd className="font-mono">{maskSid(settings.accountSid)}</dd>
        <dt className="text-gray-500">Caller ID</dt>
        <dd className="font-mono">{settings.defaultCallerId}</dd>
      </dl>
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => chrome.runtime.openOptionsPage()}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Full settings
        </button>
        <button
          type="button"
          onClick={signOut}
          className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
        >
          Sign out
        </button>
      </div>
    </Section>
  );
}

function HelpSection() {
  return (
    <Section title="Help">
      <details className="text-xs">
        <summary className="cursor-pointer font-medium text-gray-900">Call not connecting?</summary>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-gray-600">
          <li>Grant microphone access (open the extension once in a normal tab).</li>
          <li>Check your Twilio account has voice enabled + funds.</li>
          <li>Confirm your caller ID is a verified / purchased Twilio number.</li>
          <li>US/Canada numbers may need a registered caller ID.</li>
        </ul>
      </details>
      <a
        href="mailto:support@dialler.app"
        className="block text-xs font-medium text-brand-600 hover:underline"
      >
        Contact support →
      </a>
    </Section>
  );
}
