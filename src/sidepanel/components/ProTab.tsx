import { useEffect, useRef, useState } from 'react';
import {
  ensureCloudAccount,
  getSubscription,
  getCheckoutUrl,
  cancelSubscription,
} from '@shared/cloud';
import type { Subscription } from '@shared/cloud';
import { UpgradeSheet } from './UpgradeSheet';
import { CreditsSection } from './CreditsSection';
import { AI_CHAT_ENABLED, BYO_DEEPGRAM_ENABLED } from '@shared/flags';

type LoadState = 'loading' | 'ready' | 'error';

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

/** Pro subscription management tab inside the side panel. */
export function ProTab() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [userId, setUserId] = useState<string | null>(null);
  const [notRegistered, setNotRegistered] = useState(false);
  const [sub, setSub] = useState<Subscription | null>(null);

  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const account = await ensureCloudAccount();
        if (cancelled) return;
        setUserId(account.userId);
        const subscription = await getSubscription(account.userId);
        if (cancelled) return;
        setSub(subscription);
        setLoadState('ready');
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === 'device_not_registered') {
          setNotRegistered(true);
          setLoadState('ready');
        } else {
          setLoadState('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleUpgrade() {
    if (!userId) return;
    setUpgradeLoading(true);
    setUpgradeError(null);
    try {
      const url = await getCheckoutUrl(userId);
      chrome.tabs.create({ url });
    } catch (e) {
      setUpgradeError(e instanceof Error ? e.message : 'Could not open checkout. Try again.');
    } finally {
      setUpgradeLoading(false);
    }
  }

  async function handleCancel() {
    if (!userId) return;
    const ok = confirm(
      'Cancel your Pro subscription?\n\nYou keep access until the end of the current billing period.',
    );
    if (!ok) return;
    setCancelLoading(true);
    setCancelError(null);
    try {
      const result = await cancelSubscription(userId);
      if (!mountedRef.current) return;
      if (result.ok) {
        // Refresh subscription state
        const updated = await getSubscription(userId);
        if (!mountedRef.current) return;
        setSub(updated);
      } else {
        setCancelError(result.error ?? 'Cancellation failed.');
      }
    } finally {
      if (mountedRef.current) setCancelLoading(false);
    }
  }

  // ── loading / error states ───────────────────────────────────────

  if (loadState === 'loading') {
    return (
      <div className="flex h-32 items-center justify-center">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="p-4">
        <p className="text-sm text-red-600">
          Could not load subscription. Check your connection and try again.
        </p>
      </div>
    );
  }

  // ── device not registered ────────────────────────────────────────

  if (notRegistered) {
    return (
      <div className="space-y-4 p-4">
        <header>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-600">Plan &amp; billing</p>
          <h1 className="mt-0.5 text-lg font-semibold text-gray-900">Pro</h1>
        </header>

        <CreditsSection />
        <UpgradeSheet
          onUpgrade={handleUpgrade}
          loading={upgradeLoading}
          error={upgradeError}
          ctaLabel="Start free trial"
          disabled
          disabledNote="Finish device setup in Settings before upgrading."
        />
      </div>
    );
  }

  // ── active subscription ──────────────────────────────────────────

  if (sub?.status === 'active' && sub.hasAccess) {
    const renewsOn = fmtDate(sub.currentPeriodEnd);
    return (
      <div className="space-y-4 p-4">
        <header>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-600">Plan &amp; billing</p>
          <h1 className="mt-0.5 text-lg font-semibold text-gray-900">Pro</h1>
        </header>

        <CreditsSection />

        <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-1">
          <p className="text-sm font-semibold text-green-800">Pro — active</p>
          <p className="text-xs text-green-700">Renews {renewsOn}</p>
        </div>

        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Manage subscription</h2>

          <p className="text-xs text-gray-500">
            Cancelling ends your subscription at period end — you keep access until then.
          </p>
          {cancelError && (
            <p className="text-xs text-red-600">{cancelError}</p>
          )}
          <button
            type="button"
            onClick={handleCancel}
            disabled={cancelLoading}
            className="rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            {cancelLoading ? 'Cancelling…' : 'Cancel subscription'}
          </button>
        </section>
      </div>
    );
  }

  // ── trialing ─────────────────────────────────────────────────────

  if (sub?.status === 'trialing' && sub.hasAccess) {
    const daysLeft = sub.daysLeft ?? 0;
    const trialEnds = fmtDate(sub.trialEndsAt);
    return (
      <div className="space-y-4 p-4">
        <header>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-600">Plan &amp; billing</p>
          <h1 className="mt-0.5 text-lg font-semibold text-gray-900">Pro</h1>
        </header>

        <CreditsSection />

        <div className="rounded-lg border border-brand-200 bg-brand-50 p-3">
          <p className="text-sm font-semibold text-brand-800">
            Pro trial — {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left
          </p>
          <p className="text-xs text-brand-700 mt-0.5">Trial ends {trialEnds}</p>
        </div>

        <TierComparison />
        <UpgradeSheet
          onUpgrade={handleUpgrade}
          loading={upgradeLoading}
          error={upgradeError}
          ctaLabel="Upgrade now to keep Pro after your trial"
        />
      </div>
    );
  }

  // ── cancelled (still has access) ─────────────────────────────────

  if (sub?.status === 'cancelled' && sub.hasAccess) {
    const accessUntil = fmtDate(sub.currentPeriodEnd);
    return (
      <div className="space-y-4 p-4">
        <header>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-600">Plan &amp; billing</p>
          <h1 className="mt-0.5 text-lg font-semibold text-gray-900">Pro</h1>
        </header>

        <CreditsSection />

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-800">Cancelled</p>
          <p className="text-xs text-amber-700 mt-0.5">
            Access continues until {accessUntil}
          </p>
        </div>

        <UpgradeSheet
          onUpgrade={handleUpgrade}
          loading={upgradeLoading}
          error={upgradeError}
          ctaLabel="Resubscribe"
        />
      </div>
    );
  }

  // ── past_due ─────────────────────────────────────────────────────

  if (sub?.status === 'past_due') {
    return (
      <div className="space-y-4 p-4">
        <header>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-600">Plan &amp; billing</p>
          <h1 className="mt-0.5 text-lg font-semibold text-gray-900">Pro</h1>
        </header>

        <CreditsSection />

        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm font-semibold text-red-800">Payment issue</p>
          <p className="text-xs text-red-700 mt-0.5">
            Update your billing details to keep Pro access.
          </p>
        </div>

        <UpgradeSheet
          onUpgrade={handleUpgrade}
          loading={upgradeLoading}
          error={upgradeError}
          ctaLabel="Update billing"
        />
      </div>
    );
  }

  // ── expired / no access / null ────────────────────────────────────

  return (
    <div className="space-y-4 p-4">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-600">Plan &amp; billing</p>
        <h1 className="mt-0.5 text-lg font-semibold text-gray-900">Pro</h1>
      </header>
      <TierComparison />
      <UpgradeSheet
        onUpgrade={handleUpgrade}
        loading={upgradeLoading}
        error={upgradeError}
        ctaLabel="Start free trial"
      />
      <CreditsSection />
    </div>
  );
}

/** Free vs Pro tier comparison + credit-system explainer. Shown in upsell states. */
function TierComparison() {
  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-sm font-semibold text-gray-900">Free</p>
          <p className="mt-0.5 text-[11px] text-gray-500">$0</p>
          <ul className="mt-2 space-y-1 text-[11px] text-gray-600">
            <li>✓ Calling (your Twilio)</li>
            {AI_CHAT_ENABLED && <li>✓ GPT-5 mini AI</li>}
            {BYO_DEEPGRAM_ENABLED ? (
              <li>✓ Bring-your-own Deepgram</li>
            ) : (
              <li>✓ Call history on this device</li>
            )}
          </ul>
        </div>
        <div className="rounded-lg border-2 border-brand-300 bg-brand-50 p-3">
          <p className="text-sm font-semibold text-brand-900">Pro</p>
          <p className="mt-0.5 text-[11px] text-brand-700">$9/mo · 7-day trial</p>
          <ul className="mt-2 space-y-1 text-[11px] text-brand-800">
            {AI_CHAT_ENABLED && <li>✓ All Claude models (Haiku/Sonnet/Opus)</li>}
            <li>✓ Claude MCP — ask Claude about your calls</li>
            <li>✓ Call transcription (1000 credits / month)</li>
            <li>✓ SMS · recording · cloud sync</li>
          </ul>
        </div>
      </div>
      <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-600">
        <span className="font-medium text-gray-900">How credits work:</span> 1 credit = $0.01.
        Transcription is metered by real usage. Pro includes 1000 credits/month; top up any time below.
      </div>
    </section>
  );
}
