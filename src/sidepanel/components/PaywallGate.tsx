import { useEffect, useState } from 'react';
import { getEntitlements, type Entitlements, type Feature } from '@shared/entitlements';
import { useCallStore } from '../stores/call-store';

const BENEFIT: Record<Feature, string> = {
  autodial_unlimited: 'Hit your 80-call daily target',
  ai_analysis: "Know exactly why you're not booking meetings",
  cloud_history: "Never lose a prospect's exact words",
  sms: 'Text prospects without leaving the dialer',
  recording: 'Replay your best calls and copy what works',
};

export function PaywallGate({ feature, children }: { feature: Feature; children: React.ReactNode }) {
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const setView = useCallStore((s) => s.setView);

  useEffect(() => {
    let cancelled = false;
    chrome.storage.local.get('cloudUserId').then((got) => {
      const userId = (got['cloudUserId'] as string | undefined) ?? null;
      getEntitlements(userId).then((result) => {
        if (!cancelled) setEnt(result);
      });
    });
    return () => { cancelled = true; };
  }, []);

  // Loading — neutral placeholder, never flash Pro content
  if (ent === null) {
    return (
      <div className="flex items-center justify-center py-6">
        <span className="text-sm text-gray-400">…</span>
      </div>
    );
  }

  // Entitled — render children as-is
  if (ent.can(feature)) {
    return <>{children}</>;
  }

  // Not entitled — upsell card
  return (
    <div className="rounded-lg border border-gray-200 bg-brand-50 p-4 shadow-sm">
      <p className="text-sm font-semibold text-gray-900">{BENEFIT[feature]}</p>
      <p className="mt-1 text-xs text-gray-500">Unlock with Pro — $9/mo, 7-day free trial.</p>
      <button
        type="button"
        onClick={() => setView('pro')}
        className="mt-3 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        Start free trial
      </button>
    </div>
  );
}
