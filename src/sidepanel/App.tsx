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
import { EmailCaptureSheet } from './components/EmailCaptureSheet';

export function App() {
  useDevice();
  const settings = useCallStore((s) => s.settings);
  const activeCall = useCallStore((s) => s.activeCall);
  const view = useCallStore((s) => s.view);

  // null = loading; true = show capture sheet; false = hide
  const [showEmailCapture, setShowEmailCapture] = useState<boolean | null>(null);

  // Telemetry: the side panel mounting = the user opened the dialpad. Fire once
  // per mount (empty deps) — separates "installed, never opened" from "bailed".
  useEffect(() => {
    track('panel_opened');
  }, []);

  // Check whether to show email capture once settings are confirmed configured
  useEffect(() => {
    if (!settings) return;
    // Only evaluate once — guard against re-runs if settings re-emits mid-session
    if (showEmailCapture !== null) return;
    chrome.storage.local
      .get(['emailCaptured', 'emailPromptSkipped'])
      .then(({ emailCaptured, emailPromptSkipped }) => {
        setShowEmailCapture(!emailCaptured && !emailPromptSkipped);
      })
      .catch(() => setShowEmailCapture(false));
  }, [settings]);

  if (!settings) return <NotConfigured />;

  return (
    <div className="flex h-full flex-col bg-white">
      <StatusBar />
      <FolderPermissionBanner />
      <main className="flex-1 overflow-y-auto">
        {showEmailCapture && (
          <div className="p-3">
            <EmailCaptureSheet onDone={() => setShowEmailCapture(false)} />
          </div>
        )}
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
