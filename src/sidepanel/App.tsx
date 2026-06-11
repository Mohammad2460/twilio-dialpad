import { useEffect, useState } from 'react';
import { useCallStore } from './stores/call-store';
import { useDevice } from './hooks/use-device';
import { track } from '@shared/telemetry';
import { StatusBar } from './components/StatusBar';
import { Dialpad } from './components/Dialpad';
import { CallScreen } from './components/CallScreen';
import { IncomingCall } from './components/IncomingCall';
import { CallHistory } from './components/CallHistory';
import { AutoDialer } from './components/AutoDialer';
import { NotConfigured } from './components/NotConfigured';
import { FolderPermissionBanner } from './components/FolderPermissionBanner';
import { SettingsTab } from './components/SettingsTab';
import { ProTab } from './components/ProTab';
import { AiTab } from './components/AiTab';
import { SmsTab } from './components/SmsTab';
import { TrialStartPopup } from './components/TrialStartPopup';
import { TrialBanner } from './components/TrialBanner';
import { getEntitlements, type Entitlements } from '@shared/entitlements';

export function App() {
  useDevice();
  const settings = useCallStore((s) => s.settings);
  const activeCall = useCallStore((s) => s.activeCall);
  const view = useCallStore((s) => s.view);

  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [cloudUserId, setCloudUserId] = useState<string | null>(null);

  // Telemetry: the side panel mounting = the user opened the dialpad. Fire once
  // per mount (empty deps) — separates "installed, never opened" from "bailed".
  useEffect(() => {
    track('panel_opened');
  }, []);

  // Resolve entitlements (drives the trial popup + expiry banner) once configured.
  useEffect(() => {
    if (!settings) return;
    let cancelled = false;
    (async () => {
      const { cloudUserId: uid } = await chrome.storage.local.get('cloudUserId');
      const userId = typeof uid === 'string' ? uid : null;
      const result = await getEntitlements(userId);
      if (!cancelled) {
        setCloudUserId(userId);
        setEnt(result);
      }
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [settings]);

  if (!settings) return <NotConfigured />;

  const showTrialBanner = ent?.trialing && ent.daysLeft != null && ent.daysLeft <= 3 && cloudUserId;

  return (
    <div className="flex h-full flex-col bg-white">
      <StatusBar />
      <FolderPermissionBanner />
      <TrialStartPopup />
      {showTrialBanner && <TrialBanner userId={cloudUserId} daysLeft={ent.daysLeft!} />}
      <main className="flex-1 overflow-y-auto">
        {activeCall?.phase === 'ringing' && activeCall.direction === 'in' ? (
          <IncomingCall />
        ) : activeCall ? (
          <CallScreen />
        ) : view === 'history' ? (
          <CallHistory />
        ) : view === 'sms' ? (
          <SmsTab />
        ) : view === 'autodial' ? (
          <AutoDialer />
        ) : view === 'settings' ? (
          <SettingsTab />
        ) : view === 'pro' ? (
          <ProTab />
        ) : view === 'ai' ? (
          <AiTab />
        ) : (
          <Dialpad />
        )}
      </main>
      <Footer />
    </div>
  );
}

function Footer() {
  const view = useCallStore((s) => s.view);
  const setView = useCallStore((s) => s.setView);
  const activeCall = useCallStore((s) => s.activeCall);
  if (activeCall) return null;
  return (
    <nav className="flex border-t border-gray-200 bg-white">
      <TabButton active={view === 'dialpad'} onClick={() => setView('dialpad')}>
        Keypad
      </TabButton>
      <TabButton active={view === 'ai'} onClick={() => setView('ai')}>
        AI
      </TabButton>
      <TabButton active={view === 'sms'} onClick={() => setView('sms')}>
        SMS
      </TabButton>
      <TabButton active={view === 'history'} onClick={() => setView('history')}>
        Recents
      </TabButton>
      <TabButton active={view === 'pro'} onClick={() => setView('pro')}>
        Pro
      </TabButton>
      <TabButton active={view === 'settings'} onClick={() => setView('settings')}>
        Settings
      </TabButton>
    </nav>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'flex-1 py-3 text-sm font-medium',
        active ? 'text-brand-600 border-t-2 border-brand-600 -mt-px' : 'text-gray-500 hover:text-gray-900',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
