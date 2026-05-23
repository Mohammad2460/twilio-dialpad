import { useEffect, useState } from 'react';
import { useCallStore } from '../stores/call-store';
import { getManager } from '../hooks/use-device';
import { formatForDisplay } from '@shared/phone';
import { TranscriptPanel } from './TranscriptPanel';

const DTMF_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

export function CallScreen() {
  const call = useCallStore((s) => s.activeCall)!;
  const [showDtmf, setShowDtmf] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (call.phase !== 'open') {
      setElapsed(0);
      return;
    }
    // Use startedAt so timer is accurate after side-panel remounts.
    const tick = () => setElapsed(Math.floor((Date.now() - call.startedAt) / 1000));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [call.phase, call.startedAt]);

  const phaseLabel =
    call.phase === 'connecting' ? 'Connecting…'
      : call.phase === 'ringing' ? 'Ringing…'
      : call.phase === 'open' ? formatTime(elapsed)
      : call.phase;

  return (
    <div className="flex h-full flex-col items-center justify-between p-6">
      <div className="mt-8 flex flex-col items-center">
        <p className="text-sm uppercase tracking-wide text-gray-500">
          {call.direction === 'in' ? 'Incoming' : 'Outgoing'}
        </p>
        <h2 className="mt-2 text-2xl font-medium">
          {call.remoteNumber ? formatForDisplay(call.remoteNumber) : 'Unknown'}
        </h2>
        <p className="mt-1 text-sm text-gray-600 tabular-nums">{phaseLabel}</p>
        {call.phase === 'open' && <TranscriptPanel />}
      </div>

      {showDtmf && (
        <div className="grid grid-cols-3 gap-2">
          {DTMF_KEYS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => getManager().sendDtmf(d)}
              className="h-12 w-12 rounded-full bg-gray-100 text-lg font-light hover:bg-gray-200"
            >
              {d}
            </button>
          ))}
        </div>
      )}

      <div className="mb-4 flex w-full justify-around">
        <ToolButton
          active={call.muted}
          onClick={() => {
            const m = !call.muted;
            getManager().setMute(m);
            useCallStore.getState().patchActiveCall({ muted: m });
          }}
          label={call.muted ? 'Muted' : 'Mute'}
          icon="🎤"
        />
        <ToolButton
          active={showDtmf}
          onClick={() => setShowDtmf((v) => !v)}
          label="Keypad"
          icon="#"
        />
        <ToolButton label="Hangup" icon="📞" danger onClick={() => getManager().hangup()} />
      </div>
    </div>
  );
}

function ToolButton({
  onClick,
  label,
  icon,
  active,
  danger,
}: {
  onClick: () => void;
  label: string;
  icon: string;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-1">
      <span
        className={[
          'flex h-14 w-14 items-center justify-center rounded-full text-xl',
          danger ? 'bg-red-500 text-white' : active ? 'bg-brand-600 text-white' : 'bg-gray-100',
        ].join(' ')}
      >
        {icon}
      </span>
      <span className="text-xs text-gray-600">{label}</span>
    </button>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
