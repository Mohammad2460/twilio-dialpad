import { useEffect, useSyncExternalStore } from 'react';
import { getPlanSnapshot, loadCachedPlan, refreshPlan, subscribePlan, type PlanState } from '@shared/plan';

let started = false;

/** Refresh the shared plan state from the backend (after spending, or on demand). */
export async function reloadPlan(): Promise<PlanState | null> {
  const { cloudUserId } = await chrome.storage.local.get('cloudUserId');
  if (typeof cloudUserId !== 'string') return null;
  return refreshPlan(cloudUserId);
}

/**
 * The user's plan + monthly usage. Cached-first, then live; every component
 * using this shares one copy. Null until known (not registered, or offline
 * with no cache) — callers render nothing rather than guess.
 */
export function usePlan(): PlanState | null {
  const plan = useSyncExternalStore(subscribePlan, getPlanSnapshot);
  useEffect(() => {
    if (started) return;
    started = true;
    void loadCachedPlan().then(reloadPlan);
  }, []);
  return plan;
}
