/**
 * First-week checklist state. Two of the four steps can be read from data that
 * already exists (a call in history, the transcription setting); the other two
 * are remembered here the first time they happen. Local only.
 */
const KEY = 'onboarding';

export interface OnboardingFlags {
  askedAi?: boolean;
  importedList?: boolean;
  dismissed?: boolean;
}

export type OnboardingStep = 'call' | 'transcription' | 'ai' | 'list';

/** The checklist is offered for this long after setup, then goes away by itself. */
export const CHECKLIST_DAYS = 14;

export async function getOnboarding(): Promise<OnboardingFlags> {
  const got = await chrome.storage.local.get(KEY);
  const v = got[KEY];
  return v && typeof v === 'object' ? (v as OnboardingFlags) : {};
}

/** Set one flag. Never throws — the checklist must not break the action it records. */
export async function markOnboarding(flag: keyof OnboardingFlags): Promise<void> {
  try {
    const cur = await getOnboarding();
    if (cur[flag]) return;
    await chrome.storage.local.set({ [KEY]: { ...cur, [flag]: true } });
  } catch {
    /* best-effort */
  }
}

export interface ChecklistInput {
  flags: OnboardingFlags;
  hasCall: boolean;
  transcriptionOn: boolean;
  configuredAt: number;
  now: number;
}

/** Which steps are done, in display order. */
export function checklistSteps(i: ChecklistInput): { step: OnboardingStep; done: boolean }[] {
  return [
    { step: 'call', done: i.hasCall },
    { step: 'transcription', done: i.transcriptionOn },
    { step: 'ai', done: !!i.flags.askedAi },
    { step: 'list', done: !!i.flags.importedList },
  ];
}

/** Shown until everything is done, it is dismissed, or the first two weeks are over. */
export function showChecklist(i: ChecklistInput): boolean {
  if (i.flags.dismissed) return false;
  if (i.now - i.configuredAt > CHECKLIST_DAYS * 86_400_000) return false;
  return checklistSteps(i).some((s) => !s.done);
}
