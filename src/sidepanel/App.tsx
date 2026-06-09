import { useEffect } from 'react';
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

export function App() {
  useDevice();
  const settings = useCallStore((s) => s.settings);
  const activeCall = useCallStore((s) => s.activeCall);
  const view = useCallStore((s) => s.view);

  // Telemetry: the side panel mounting = the user opened the dialpad. Fire once
  // per mount (empty deps) — separates "installed, never opened" from "bailed".
  useEffect(() => {
    track('panel_opened');
  }, []);

  if (!settings) return <NotConfigured />;

  return (
    <div className="flex h-full flex-col bg-white">
      <StatusBar />
      <FolderPermissionBanner />
      <main className="flex-1 overflow-y-auto">
        {activeCall?.phase === 'ringing' && activeCall.direction === 'in' ? (
          <IncomingCall />
        ) : activeCall ? (
          <CallScreen />
        ) : view === 'history' ? (
          <CallHistory />
        ) : view === 'autodial' ? (
          <AutoDialer />
        ) : view === 'settings' ? (
          <SettingsTab />
        ) : view === 'pro' ? (
          <ProTab />
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
