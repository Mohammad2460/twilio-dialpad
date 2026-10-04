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
import { PlanTab } from './components/PlanTab';
import { AiTab } from './components/AiTab';
import { ClaudeTab } from './components/ClaudeTab';
import { AI_CHAT_ENABLED, MCP_PROMO_ENABLED } from '@shared/flags';
import { TrialStartPopup } from './components/TrialStartPopup';
import { ReconnectBanner } from './components/ReconnectBanner';
import { AiNotice } from './components/AiNotice';
import { OnboardingChecklist } from './components/OnboardingChecklist';

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
      <ReconnectBanner settings={settings} />
      {!activeCall && <OnboardingChecklist />}
      <FolderPermissionBanner />
      <TrialStartPopup />
      {AI_CHAT_ENABLED && <AiNotice />}
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
          <PlanTab />
        ) : view === 'ai' ? (
          AI_CHAT_ENABLED ? <AiTab /> : MCP_PROMO_ENABLED ? <ClaudeTab /> : <Dialpad />
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
      {(AI_CHAT_ENABLED || MCP_PROMO_ENABLED) && (
        <TabButton active={view === 'ai'} onClick={() => setView('ai')}>
          {AI_CHAT_ENABLED ? 'AI' : 'Claude'}
        </TabButton>
      )}
      <TabButton active={view === 'history'} onClick={() => setView('history')}>
        Recents
      </TabButton>
      <TabButton active={view === 'pro'} onClick={() => setView('pro')}>
        Plan
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
        'flex-1 py-2.5 text-xs font-medium tracking-wide transition-colors',
        active
          ? 'text-brand-700 border-t-2 border-brand-600 -mt-px bg-brand-50/40'
          : 'text-gray-500 border-t-2 border-transparent -mt-px hover:text-gray-800',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
