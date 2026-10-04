import { useEffect, useRef, useState } from 'react';
import { ensureCloudAccount, getCheckoutUrl, cancelSubscription } from '@shared/cloud';
import { startTopUp, TOPUP_PACKS } from '@shared/credits';
import {
  FREE_AUTODIAL_MAX,
  FREE_CONNECTOR_CALLS,
  FREE_HISTORY_DAYS,
  PRO_AUTODIAL_MAX,
  fmtDate,
  fmtDuration,
  fmtMoney,
  fmtQuestionsUsage,
  fmtResetDate,
  fmtTranscriptionUsage,
  hasExtraBalance,
  isBlocked,
  isTrial,
  isTrialEnded,
  meterLevel,
  meterPct,
  yearlyMath,
  type BillingCycle,
  type Meter,
  type PlanState,
} from '@shared/plan';
import { reloadPlan, usePlan } from '../hooks/use-plan';

type Account = 'loading' | 'ready' | 'not_registered' | 'error';

/** Plan tab: this month's usage, the current plan, and the way to change it. */
export function PlanTab() {
  const plan = usePlan();
  const [account, setAccount] = useState<Account>('loading');
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    ensureCloudAccount()
      .then(async (acct) => {
        if (cancelled) return;
        setUserId(acct.userId);
        const fresh = await reloadPlan();
        if (!cancelled) setAccount(fresh || plan ? 'ready' : 'error');
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setAccount(msg === 'device_not_registered' ? 'not_registered' : 'error');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (account === 'not_registered') {
    return (
      <Page title="Free">
        <p className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs leading-relaxed text-gray-600">
          Finish account setup in Settings to see your plan and usage.
        </p>
      </Page>
    );
  }

  if (!plan) {
    return account === 'error' ? (
      <div className="p-4">
        <p className="text-sm text-red-600">Could not load your plan. Check your connection and try again.</p>
      </div>
    ) : (
      <div className="flex h-32 items-center justify-center">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }

  const trial = isTrial(plan);
  const paid = plan.plan === 'pro' && !trial;

  return (
    <div>
      {paid ? <PaidHeader plan={plan} /> : <UpgradeHero plan={plan} userId={userId} />}
      <div className="space-y-4 p-4">
        <StatusNote plan={plan} />
        <UsageCard plan={plan} userId={userId} />
        {paid ? <ManageSubscription plan={plan} userId={userId} /> : <Compare plan={plan} />}
      </div>
    </div>
  );
}

function Page({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4 p-4">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-600">Plan &amp; billing</p>
        <h1 className="mt-0.5 text-lg font-semibold text-gray-900">{title}</h1>
      </header>
      {children}
    </div>
  );
}

const HERO = 'border-b border-brand-100 bg-gradient-to-b from-brand-50 to-white px-4 pb-4 pt-5';

function PaidHeader({ plan }: { plan: PlanState }) {
  return (
    <header className={HERO}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">Your plan</p>
      <h1 className="mt-1 text-lg font-semibold text-gray-900">Pro</h1>
      {plan.status === 'active' && (
        <p className="mt-0.5 text-xs text-gray-600">
          Active{plan.periodEnd ? ` · renews ${fmtDate(plan.periodEnd)}` : ''}
        </p>
      )}
    </header>
  );
}

/** What the upgrade pitch says, by where the user is right now. */
function pitch(plan: PlanState): { eyebrow: string; title: string; body: string } {
  const { free, pro } = plan.limits;
  const proLine = `${fmtDuration(pro.transcriptionSeconds)} of transcription and ${pro.questions} AI questions a month`;
  const reset = fmtResetDate(plan.resetsAt);
  if (isTrial(plan)) {
    const d = plan.trialDaysLeft ?? 0;
    return {
      eyebrow: `Pro trial · ${d} ${d === 1 ? 'day' : 'days'} left`,
      title: 'Keep what you have now',
      body: `After ${fmtDate(plan.trialEndsAt)} you move to Free: ${fmtDuration(free.transcriptionSeconds)} of transcription and ${free.questions} AI questions a month. Pro keeps ${proLine}. Calling stays free either way.`,
    };
  }
  const tOut = isBlocked(plan, 'transcription');
  const qOut = isBlocked(plan, 'questions');
  if (tOut || qOut) {
    return {
      eyebrow: 'Your plan · Free',
      title: `Don’t wait until ${reset}`,
      body: `${tOut && qOut ? 'Transcription and AI questions are' : tOut ? 'Transcription is' : 'AI questions are'} paused until then. Pro gives you ${proLine}, starting now.`,
    };
  }
  return {
    eyebrow: 'Your plan · Free',
    title: `Transcribe every call, not just ${fmtDuration(free.transcriptionSeconds)} of them`,
    body: `Pro gives you ${proLine}, plus call recording and your full history.`,
  };
}

/** One line of context for states that need it: trial, trial ended, cancelled, payment issue. */
function StatusNote({ plan }: { plan: PlanState }) {
  const free = plan.limits.free;
  const freeLine = `unlimited calling, ${fmtDuration(free.transcriptionSeconds)} of transcription and ${free.questions} AI questions a month`;

  // Said for two weeks after the trial; after that Free needs no explanation.
  const trialEndedMs = plan.trialEndsAt ? Date.now() - Date.parse(plan.trialEndsAt) : Infinity;
  if (isTrialEnded(plan) && trialEndedMs < 14 * 86_400_000) {
    return (
      <Note tone="gray" title="Your Pro trial has ended">
        You’re on Free: {freeLine}. Your calls, transcripts and notes are still here.
      </Note>
    );
  }
  if (plan.plan === 'pro' && plan.status === 'cancelled') {
    return (
      <Note tone="amber" title="Subscription cancelled">
        Pro stays on until {fmtDate(plan.periodEnd)}. After that you move to Free — calling is not
        affected.
      </Note>
    );
  }
  if (plan.status === 'past_due') {
    return (
      <Note tone="red" title="Payment issue">
        Your last payment didn’t go through. Update your billing details to keep Pro.
      </Note>
    );
  }
  return null;
}

const TONES = {
  brand: 'border-brand-200 bg-brand-50 text-brand-800',
  gray: 'border-gray-200 bg-gray-50 text-gray-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-900',
  red: 'border-red-200 bg-red-50 text-red-800',
} as const;

function Note({ tone, title, children }: { tone: keyof typeof TONES; title: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg border p-3 ${TONES[tone]}`}>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-0.5 text-xs leading-relaxed opacity-90">{children}</p>
    </div>
  );
}

// ── Usage ─────────────────────────────────────────────────────────────────────

function UsageCard({ plan, userId }: { plan: PlanState; userId: string | null }) {
  const tOut = meterLevel(plan.transcription) === 'out';
  const qOut = meterLevel(plan.questions) === 'out';
  const extra = hasExtraBalance(plan);
  // The only way forward for a Pro user at a limit before the reset.
  const offerExtra = plan.plan === 'pro' && !isTrial(plan) && (tOut || qOut) && !extra && !!userId;

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-gray-900">This month</h2>
        <span className="text-[11px] text-gray-500">Resets {fmtResetDate(plan.resetsAt)}</span>
      </div>

      <div className="mt-3 space-y-3">
        <MeterRow label="Transcription" value={fmtTranscriptionUsage(plan.transcription)} meter={plan.transcription} />
        <MeterRow label="AI questions" value={fmtQuestionsUsage(plan.questions)} meter={plan.questions} />
      </div>

      {(tOut || qOut) && (
        <p className="mt-3 text-[11px] leading-relaxed text-gray-600">
          {tOut && qOut
            ? 'Transcription and AI questions are'
            : tOut
              ? 'Transcription is'
              : 'AI questions are'}{' '}
          {extra ? 'now using your extra balance.' : `paused until ${fmtResetDate(plan.resetsAt)}.`} Calls
          are not affected.
        </p>
      )}

      {extra && (
        <div className="mt-3 flex items-baseline justify-between border-t border-gray-100 pt-2.5">
          <div>
            <p className="text-xs font-medium text-gray-900">Extra balance</p>
            <p className="text-[11px] text-gray-500">Used only after this month’s allowance runs out.</p>
          </div>
          <span className="text-sm font-semibold tabular-nums text-gray-900">
            {fmtMoney(plan.extraBalanceCents)}
          </span>
        </div>
      )}

      {offerExtra && (
        <button
          type="button"
          onClick={() => void startTopUp(userId!, TOPUP_PACKS[0])}
          className="mt-3 w-full rounded-md border border-gray-300 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Add {fmtMoney(TOPUP_PACKS[0])} extra balance
        </button>
      )}
    </section>
  );
}

const FILL = { ok: 'bg-brand-600', low: 'bg-amber-500', out: 'bg-red-500' } as const;
const VALUE = { ok: 'text-gray-600', low: 'text-amber-700', out: 'text-red-600' } as const;

function MeterRow({ label, value, meter }: { label: string; value: string; meter: Meter }) {
  const level = meterLevel(meter);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-gray-900">{label}</span>
        <span className={`text-xs tabular-nums ${VALUE[level]}`}>{value}</span>
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100"
        role="progressbar"
        aria-label={`${label} used this month`}
        aria-valuenow={Math.round(meterPct(meter))}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${FILL[level]}`}
          // A sliver stays visible at zero so the bar reads as a meter, not a divider.
          style={{ width: `${Math.max(meterPct(meter), 2)}%` }}
        />
      </div>
    </div>
  );
}

// ── Upgrade ───────────────────────────────────────────────────────────────────

function UpgradeHero({ plan, userId }: { plan: PlanState; userId: string | null }) {
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { perMonthCents, savingCents } = yearlyMath(plan.prices);
  const copy = pitch(plan);

  async function upgrade() {
    if (!userId || loading) return;
    setLoading(true);
    setError(null);
    try {
      chrome.tabs.create({ url: await getCheckoutUrl(userId, cycle) });
    } catch {
      setError('Could not open checkout. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <header className={HERO}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">{copy.eyebrow}</p>
      <h1 className="mt-1 text-lg font-semibold leading-snug text-gray-900">{copy.title}</h1>
      <p className="mt-1.5 text-xs leading-relaxed text-gray-600">{copy.body}</p>

      <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Billing">
        <CycleOption
          selected={cycle === 'monthly'}
          onSelect={() => setCycle('monthly')}
          name="Monthly"
          price={`${fmtMoney(plan.prices.monthlyCents)}/mo`}
          detail="Billed monthly"
        />
        <CycleOption
          selected={cycle === 'yearly'}
          onSelect={() => setCycle('yearly')}
          name="Yearly"
          price={`${fmtMoney(perMonthCents)}/mo`}
          detail={`${fmtMoney(plan.prices.yearlyCents)} billed yearly`}
          badge={savingCents > 0 ? `Save ${fmtMoney(savingCents)}` : undefined}
        />
      </div>

      <button
        type="button"
        onClick={() => void upgrade()}
        disabled={loading || !userId}
        className="mt-2.5 w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-brand-400"
      >
        {loading
          ? 'Opening checkout…'
          : cycle === 'yearly'
            ? `Upgrade — ${fmtMoney(plan.prices.yearlyCents)} / year`
            : `Upgrade — ${fmtMoney(plan.prices.monthlyCents)} / month`}
      </button>
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
      <p className="mt-2 text-center text-[11px] text-gray-500">
        Calling is free and unlimited on every plan. Cancel any time.
      </p>
    </header>
  );
}

function Compare({ plan }: { plan: PlanState }) {
  const { free, pro } = plan.limits;
  const rows: [string, string, string][] = [
    ['Transcription', fmtDuration(free.transcriptionSeconds), `${fmtDuration(pro.transcriptionSeconds)} / month`],
    ['AI questions', String(free.questions), `${pro.questions} / month`],
    ['Call history', `${FREE_HISTORY_DAYS} days`, 'Unlimited'],
    ['Auto-dialer', `${FREE_AUTODIAL_MAX} per list`, `${PRO_AUTODIAL_MAX} + CSV import`],
    ['Claude connector', `Last ${FREE_CONNECTOR_CALLS} calls`, 'All calls'],
    ['Call recording', '—', 'Included'],
  ];
  return (
    <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[11px] text-gray-400">
            <th className="py-1.5 pl-3 text-left font-medium" />
            <th className="px-2 py-1.5 text-left font-medium">Free</th>
            <th className="py-1.5 pr-3 text-left font-medium text-brand-700">Pro</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, f, p]) => (
            <tr key={label} className="border-t border-gray-100">
              <td className="py-1.5 pl-3 text-gray-500">{label}</td>
              <td className="px-2 py-1.5 tabular-nums text-gray-500">{f}</td>
              <td className="py-1.5 pr-3 font-medium tabular-nums text-gray-900">{p}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function CycleOption({
  selected,
  onSelect,
  name,
  price,
  detail,
  badge,
}: {
  selected: boolean;
  onSelect: () => void;
  name: string;
  price: string;
  detail: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={[
        'rounded-md border px-2.5 py-2 text-left transition',
        selected ? 'border-brand-600 bg-white ring-1 ring-brand-600' : 'border-gray-200 bg-white/60 hover:border-gray-300',
      ].join(' ')}
    >
      <span className="flex items-center justify-between gap-1">
        <span className="text-[11px] font-medium text-gray-500">{name}</span>
        {badge && (
          <span className="rounded bg-green-100 px-1 py-px text-[10px] font-semibold text-green-800">{badge}</span>
        )}
      </span>
      <span className="mt-0.5 block text-base font-semibold tabular-nums text-gray-900">{price}</span>
      <span className="block text-[11px] text-gray-500">{detail}</span>
    </button>
  );
}

// ── Manage ────────────────────────────────────────────────────────────────────

function ManageSubscription({ plan, userId }: { plan: PlanState; userId: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  async function open(fn: () => Promise<void>) {
    if (!userId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch {
      if (mounted.current) setError('Something went wrong. Try again.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const checkout = () => open(async () => void chrome.tabs.create({ url: await getCheckoutUrl(userId!) }));

  if (plan.status === 'cancelled' || plan.status === 'past_due') {
    return (
      <section className="space-y-1.5">
        <button
          type="button"
          onClick={() => void checkout()}
          disabled={busy || !userId}
          className="w-full rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:bg-brand-400"
        >
          {busy ? 'Opening checkout…' : plan.status === 'past_due' ? 'Update billing' : 'Resubscribe'}
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </section>
    );
  }

  const cancel = () =>
    open(async () => {
      if (!confirm('Cancel your Pro subscription?\n\nYou keep Pro until the end of the current billing period, then move to Free.')) return;
      const result = await cancelSubscription(userId!);
      if (!result.ok) throw new Error(result.error ?? 'cancel_failed');
      await reloadPlan();
    });

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-3">
      <h2 className="text-sm font-semibold text-gray-900">Manage subscription</h2>
      <p className="mt-1 text-xs leading-relaxed text-gray-500">
        Your price stays the same for as long as you stay subscribed. If you cancel, Pro runs until
        the end of the period you paid for.
      </p>
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
      <button
        type="button"
        onClick={() => void cancel()}
        disabled={busy || !userId}
        className="mt-2.5 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
      >
        {busy ? 'Cancelling…' : 'Cancel subscription'}
      </button>
    </section>
  );
}
