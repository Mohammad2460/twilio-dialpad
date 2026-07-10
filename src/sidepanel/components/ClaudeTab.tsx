import { useEffect, useState } from 'react';
import { ensureCloudAccount } from '@shared/cloud';

/**
 * Claude tab — promotes and sets up the Claude MCP connector.
 * Replaces the in-extension AI chat (hidden behind AI_CHAT_ENABLED) as the
 * primary AI story: your calls, analyzed inside claude.ai via MCP.
 */
export function ClaudeTab() {
  const [mcpUrl, setMcpUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    ensureCloudAccount()
      .then((a) => setMcpUrl(a.mcpUrl))
      .catch(() => setLoadError(true));
  }, []);

  async function copyUrl() {
    if (!mcpUrl) return;
    await navigator.clipboard.writeText(mcpUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Hero — the one warm moment in an otherwise clinical UI */}
      <div className="border-b border-orange-100 bg-gradient-to-b from-orange-50/70 to-white px-4 pb-5 pt-6">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-700">
          Claude connector
        </p>
        <h2 className="mt-1 text-lg font-semibold leading-snug text-gray-900">
          Your calls, analyzed by Claude
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-gray-600">
          Connect once, then ask Claude anything about your call history — right
          inside claude.ai. No copy-pasting transcripts.
        </p>
      </div>

      <div className="flex-1 px-4 py-4">
        {/* What you can ask — concrete, not marketing fluff */}
        <p className="text-xs font-medium text-gray-700">Things you can ask Claude</p>
        <ul className="mt-2 space-y-1.5">
          {[
            '“Summarize my calls from this week”',
            '“What objections came up with +1 214 …?”',
            '“Draft a follow-up email for my last call”',
            '“Which calls mentioned pricing?”',
          ].map((q) => (
            <li
              key={q}
              className="rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-700"
            >
              {q}
            </li>
          ))}
        </ul>

        {/* Connect steps */}
        <p className="mt-5 text-xs font-medium text-gray-700">Connect in under a minute</p>
        <ol className="mt-2 space-y-3">
          <Step n={1} title="Copy your personal connector URL">
            {loadError ? (
              <p className="text-xs text-red-600">
                Couldn’t load your URL — check your connection and reopen this tab.
              </p>
            ) : (
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-gray-50 px-2 py-1 text-[11px] text-gray-600">
                  {mcpUrl ?? 'Loading…'}
                </code>
                <button
                  type="button"
                  onClick={copyUrl}
                  disabled={!mcpUrl}
                  className="shrink-0 rounded-md bg-orange-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-50"
                >
                  {copied ? 'Copied ✓' : 'Copy'}
                </button>
              </div>
            )}
            <p className="mt-1 text-[11px] text-gray-400">
              This URL is your private key to your call data — never share it.
            </p>
          </Step>
          <Step n={2} title="Open claude.ai → Settings → Connectors">
            <a
              href="https://claude.ai/settings/connectors"
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-orange-700 underline decoration-orange-300 underline-offset-2 hover:text-orange-800"
            >
              Open Claude connector settings ↗
            </a>
          </Step>
          <Step n={3} title="Click “Add custom connector” and paste the URL">
            <p className="text-xs text-gray-500">
              That’s it — new calls and transcripts appear to Claude automatically.
            </p>
          </Step>
        </ol>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-orange-100 text-[11px] font-semibold text-orange-700">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-gray-900">{title}</p>
        <div className="mt-1">{children}</div>
      </div>
    </li>
  );
}
