import { describe, it, expect } from 'vitest';
import { CHECKLIST_DAYS, checklistSteps, showChecklist, type ChecklistInput } from '@shared/onboarding';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-04T12:00:00Z');

function input(over: Partial<ChecklistInput> = {}): ChecklistInput {
  return { flags: {}, hasCall: false, transcriptionOn: false, configuredAt: NOW - DAY, now: NOW, ...over };
}

describe('first-week checklist', () => {
  it('reads two steps from existing data and two from remembered flags', () => {
    const steps = checklistSteps(input({ hasCall: true, flags: { askedAi: true } }));
    expect(steps).toEqual([
      { step: 'call', done: true },
      { step: 'transcription', done: false },
      { step: 'ai', done: true },
      { step: 'list', done: false },
    ]);
  });

  it('shows while something is left to do', () => {
    expect(showChecklist(input())).toBe(true);
  });

  it('goes away once everything is done', () => {
    expect(
      showChecklist(input({ hasCall: true, transcriptionOn: true, flags: { askedAi: true, importedList: true } })),
    ).toBe(false);
  });

  it('goes away when dismissed', () => {
    expect(showChecklist(input({ flags: { dismissed: true } }))).toBe(false);
  });

  it('goes away two weeks after setup, so long-time users never see it', () => {
    expect(showChecklist(input({ configuredAt: NOW - (CHECKLIST_DAYS - 1) * DAY }))).toBe(true);
    expect(showChecklist(input({ configuredAt: NOW - (CHECKLIST_DAYS + 1) * DAY }))).toBe(false);
  });
});
