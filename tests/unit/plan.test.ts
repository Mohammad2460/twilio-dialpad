import { describe, it, expect } from 'vitest';
import {
  fmtDuration,
  fmtMoney,
  fmtQuestionsUsage,
  fmtResetDate,
  fmtTranscriptionUsage,
  isBlocked,
  isTrial,
  isTrialEnded,
  limitMessage,
  meterLevel,
  usageChip,
  yearlyMath,
  type PlanState,
} from '@shared/plan';

function plan(over: Partial<PlanState> = {}): PlanState {
  return {
    plan: 'free',
    status: 'trialing',
    resetsAt: '2026-11-01T00:00:00.000Z',
    transcription: { used: 0, limit: 1800 },
    questions: { used: 0, limit: 20 },
    extraBalanceCents: 0,
    prices: { monthlyCents: 1900, yearlyCents: 18000 },
    limits: {
      free: { transcriptionSeconds: 1800, questions: 20 },
      pro: { transcriptionSeconds: 36000, questions: 500 },
    },
    ...over,
  };
}

describe('formatting — hours, minutes and questions, never credits', () => {
  it('durations', () => {
    expect(fmtDuration(0)).toBe('0 min');
    expect(fmtDuration(1800)).toBe('30 min');
    expect(fmtDuration(5400)).toBe('1 h 30 min');
    expect(fmtDuration(36000)).toBe('10 h');
    expect(fmtDuration(119)).toBe('1 min');
  });

  it('usage lines', () => {
    expect(fmtTranscriptionUsage({ used: 720, limit: 1800 })).toBe('12 of 30 min');
    expect(fmtTranscriptionUsage({ used: 12000, limit: 36000 })).toBe('3 h 20 min of 10 h');
    expect(fmtQuestionsUsage({ used: 7, limit: 20 })).toBe('7 of 20');
  });

  it('never shows more used than the limit', () => {
    expect(fmtTranscriptionUsage({ used: 1900, limit: 1800 })).toBe('30 of 30 min');
    expect(fmtQuestionsUsage({ used: 21, limit: 20 })).toBe('20 of 20');
  });

  it('reset date is read in UTC, so it is the 1st everywhere', () => {
    expect(fmtResetDate('2026-11-01T00:00:00.000Z')).toBe('Nov 1');
  });

  it('money', () => {
    expect(fmtMoney(1900)).toBe('$19');
    expect(fmtMoney(640)).toBe('$6.40');
    expect(yearlyMath({ monthlyCents: 1900, yearlyCents: 18000 })).toEqual({ perMonthCents: 1500, savingCents: 4800 });
  });
});

describe('meter level', () => {
  it('ok under 80%, low from 80%, out at the limit', () => {
    expect(meterLevel({ used: 15, limit: 20 })).toBe('ok');
    expect(meterLevel({ used: 16, limit: 20 })).toBe('low');
    expect(meterLevel({ used: 20, limit: 20 })).toBe('out');
    expect(meterLevel({ used: 0, limit: 0 })).toBe('out');
  });
});

describe('status-bar chip', () => {
  it('shows nothing until 80% of something is used', () => {
    expect(usageChip(plan({ transcription: { used: 720, limit: 1800 }, questions: { used: 7, limit: 20 } }))).toBeNull();
  });

  it('shows what is left of the tightest allowance', () => {
    expect(usageChip(plan({ transcription: { used: 1560, limit: 1800 }, questions: { used: 17, limit: 20 } }))).toMatchObject({
      label: '4 min left',
      level: 'low',
      kind: 'transcription',
    });
    expect(usageChip(plan({ questions: { used: 19, limit: 20 } }))).toMatchObject({ label: '1 question left', kind: 'questions' });
  });

  it('at the limit', () => {
    expect(usageChip(plan({ questions: { used: 20, limit: 20 } }))).toMatchObject({ label: '0 questions left', level: 'out' });
  });

  it('stays quiet when extra balance is covering the overage', () => {
    expect(usageChip(plan({ questions: { used: 20, limit: 20 }, extraBalanceCents: 420 }))).toBeNull();
  });
});

describe('at a limit', () => {
  it('blocked only with no extra balance to fall back on', () => {
    const out = plan({ questions: { used: 20, limit: 20 } });
    expect(isBlocked(out, 'questions')).toBe(true);
    expect(isBlocked(out, 'transcription')).toBe(false);
    expect(isBlocked({ ...out, extraBalanceCents: 100 }, 'questions')).toBe(false);
  });

  it('says what was used and when it resets', () => {
    expect(limitMessage(plan(), 'questions')).toBe('You’ve used all 20 AI questions for this month. They reset on Nov 1.');
    expect(limitMessage(plan(), 'transcription')).toBe(
      'You’ve used all 30 min of transcription for this month. It resets on Nov 1.',
    );
  });
});

describe('trial states', () => {
  it('open trial is Pro + trialing; ended trial is Free + trialing', () => {
    expect(isTrial(plan({ plan: 'pro', status: 'trialing' }))).toBe(true);
    expect(isTrialEnded(plan({ plan: 'free', status: 'trialing' }))).toBe(true);
    expect(isTrial(plan({ plan: 'pro', status: 'active' }))).toBe(false);
    expect(isTrialEnded(plan({ plan: 'free', status: 'expired' }))).toBe(false);
  });
});
