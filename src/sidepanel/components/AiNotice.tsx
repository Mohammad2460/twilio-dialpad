import { useEffect, useState } from 'react';
import { acknowledgeAiNotice, aiNoticeAcknowledged, autoBackfill } from '@shared/insights';
import { storage } from '@shared/storage';
import { useCallStore } from '../stores/call-store';

/**
 * One-time notice for the AI assistant, pinned app-wide. Automatic summaries
 * stay off until it is answered, so no transcript leaves the device before the
 * user has read what is sent and where.
 */
export function AiNotice() {
  const [seen, setSeen] = useState(true);
  const setSettings = useCallStore((s) => s.setSettings);
  // Not during a call: changing a setting re-initialises the device.
  const onCall = useCallStore((s) => !!s.activeCall);

  useEffect(() => {
    aiNoticeAcknowledged().then(setSeen).catch(() => {});
  }, []);

  if (seen || onCall) return null;

  async function answer(keepOn: boolean) {
    setSeen(true);
    try {
      if (!keepOn) {
        const next = await storage.updateSettings({ aiAutoSummary: false });
        if (next) setSettings(next);
      }
      await acknowledgeAiNotice();
      if (keepOn) void autoBackfill();
    } catch (e) {
      console.warn('[ai-notice] save failed', e);
    }
  }

  return (
    <div className="border-b border-brand-100 bg-brand-50 px-3 py-2">
      <p className="text-xs font-semibold text-brand-900">New: AI call notes</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-gray-700">
        After each transcribed call, AI writes a summary and tracks what was promised. To do that,
        the transcript text of new and recent calls is sent to our AI provider (OpenAI). Uses AI
        credits. You can change this any time in Settings.
      </p>
      <div className="mt-1.5 flex gap-3">
        <button
          type="button"
          onClick={() => void answer(true)}
          className="rounded-md bg-brand-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-brand-700"
        >
          Turn on
        </button>
        <button
          type="button"
          onClick={() => void answer(false)}
          className="text-[11px] font-semibold text-gray-600 hover:underline"
        >
          No thanks
        </button>
      </div>
    </div>
  );
}
