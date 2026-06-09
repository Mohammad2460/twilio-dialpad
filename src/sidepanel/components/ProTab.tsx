import { useEffect, useState } from 'react';
import {
  ensureCloudAccount,
  getSubscription,
  getCheckoutUrl,
  cancelSubscription,
} from '@shared/cloud';
import type { Subscription } from '@shared/cloud';
import { UpgradeSheet } from './UpgradeSheet';

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
  const [cancelledAt, setCancelledAt] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

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
      if (result.ok) {
        setCancelledAt(result.cancelsAt ?? null);
        // Refresh subscription state
        const updated = await getSubscription(userId);
        setSub(updated);
      } else {
        setCancelError(result.error ?? 'Cancellation failed.');
      }
    } finally {
      setCancelLoading(false);
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
        <h1 className="text-lg font-semibold text-gray-900">Pro</h1>
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
        <h1 className="text-lg font-semibold text-gray-900">Pro</h1>

        <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-1">
          <p className="text-sm font-semibold text-green-800">Pro — active</p>
          <p className="text-xs text-green-700">Renews {renewsOn}</p>
        </div>

        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Manage subscription</h2>

          {cancelledAt ? (
            <p className="text-xs text-gray-600">
              Subscription cancelled. Access continues until{' '}
              <span className="font-medium">{fmtDate(cancelledAt)}</span>.
            </p>
          ) : (
            <>
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
            </>
          )}
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
        <h1 className="text-lg font-semibold text-gray-900">Pro</h1>

        <div className="rounded-lg border border-brand-200 bg-brand-50 p-3">
          <p className="text-sm font-semibold text-brand-800">
            Pro trial — {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left
          </p>
          <p className="text-xs text-brand-700 mt-0.5">Trial ends {trialEnds}</p>
        </div>

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
        <h1 className="text-lg font-semibold text-gray-900">Pro</h1>

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
        <h1 className="text-lg font-semibold text-gray-900">Pro</h1>

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
      <h1 className="text-lg font-semibold text-gray-900">Pro</h1>
      <UpgradeSheet
        onUpgrade={handleUpgrade}
        loading={upgradeLoading}
        error={upgradeError}
        ctaLabel="Start free trial"
      />
    </div>
  );
}
