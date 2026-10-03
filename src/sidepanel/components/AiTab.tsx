import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildCallDigest, mergeCalls, type CallDigest } from '@shared/ai-context';
import { collectPromises, todayBrief } from '@shared/insights-core';
import { storage } from '@shared/storage';
import { transcripts } from '@shared/transcripts';
import { MCP_PROMO_ENABLED } from '@shared/flags';
import { useCallStore } from '../stores/call-store';
import { useCallData } from '../hooks/use-call-data';
import { AiChatbox } from './AiChatbox';
import { CallHistoryDetail } from './CallHistoryDetail';
import { ClaudeTab } from './ClaudeTab';
import { PromiseList, TodayPanel } from './AiToday';

const SUGGESTIONS = [
  'Who should I call back today?',
  'What objections keep coming up?',
  'What did I promise people this week?',
];

const NOTICE_KEY = 'aiNoticeSeen';

/**
 * AI tab: what needs attention today, open promises, and chat over the user's
 * calls. Today and promises are computed locally from stored call notes — only
 * the chat (and creating the notes) calls the model.
 */
export function AiTab() {
  const { calls, loaded } = useCallData();
  const setView = useCallStore((s) => s.setView);
  const [detailFor, setDetailFor] = useState<string | null>(null);
  const [showClaude, setShowClaude] = useState(false);
  const [noticeSeen, setNoticeSeen] = useState(true);

  useEffect(() => {
    chrome.storage.local
      .get(NOTICE_KEY)
      .then((got) => setNoticeSeen(!!got[NOTICE_KEY]))
      .catch(() => {});
  }, []);

  const brief = useMemo(() => todayBrief(calls, Date.now()), [calls]);
  const promises = useMemo(() => collectPromises(calls), [calls]);
  const hasTranscripts = calls.some((c) => c.sid);

  // Built when the first question is asked: this is the only place full
  // transcript bodies are loaded.
  const loadContext = useCallback(async (): Promise<CallDigest> => {
    const [history, all] = await Promise.all([storage.getHistory(), transcripts.list(150)]);
    return buildCallDigest(mergeCalls(history, all), { now: Date.now() });
  }, []);

  function dismissNotice() {
    setNoticeSeen(true);
    chrome.storage.local.set({ [NOTICE_KEY]: true }).catch(() => {});
  }

  if (showClaude) {
    return (
      <div className="flex h-full flex-col">
        <button
          type="button"
          onClick={() => setShowClaude(false)}
          className="border-b border-gray-200 px-3 py-2 text-left text-xs font-medium text-brand-700 hover:bg-gray-50"
        >
          ← Back to AI
        </button>
        <div className="min-h-0 flex-1">
          <ClaudeTab />
        </div>
      </div>
    );
  }

  if (loaded && calls.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 pb-16 text-center">
        <p className="text-sm font-medium text-gray-900">Your AI assistant starts after your first call</p>
        <p className="mt-1 text-xs leading-relaxed text-gray-500">
          It summarizes each transcribed call, tracks what was promised, and answers questions about
          your conversations.
        </p>
        <button
          type="button"
          onClick={() => setView('dialpad')}
          className="mt-3 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
        >
          Make a call
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {!noticeSeen && (
        <div className="border-b border-brand-100 bg-brand-50 px-3 py-2">
          <p className="text-[11px] leading-relaxed text-gray-700">
            AI reads your call transcripts to summarize calls and answer your questions. To do that,
            transcript text is sent to our AI provider. You can turn off automatic summaries in
            Settings.
          </p>
          <button
            type="button"
            onClick={dismissNotice}
            className="mt-1 text-[11px] font-semibold text-brand-700 hover:underline"
          >
            Got it
          </button>
        </div>
      )}

      {!hasTranscripts && (
        <div className="border-b border-amber-100 bg-amber-50 px-3 py-2">
          <p className="text-[11px] leading-relaxed text-amber-900">
            None of your calls are transcribed yet, so there is little for AI to work with. Turn on
            call transcription to get summaries and answers.
          </p>
          <button
            type="button"
            onClick={() => setView('settings')}
            className="mt-1 text-[11px] font-semibold text-amber-900 underline"
          >
            Open Settings
          </button>
        </div>
      )}

      <TodayPanel brief={brief} onOpenCall={setDetailFor} />
      <PromiseList items={promises} onOpenCall={setDetailFor} />

      <div className="min-h-[13rem] flex-1 border-t border-gray-200">
        <AiChatbox loadContext={loadContext} suggestions={SUGGESTIONS} onOpenCall={setDetailFor} />
      </div>

      {MCP_PROMO_ENABLED && (
        <button
          type="button"
          onClick={() => setShowClaude(true)}
          className="border-t border-gray-100 px-3 py-1.5 text-center text-[11px] text-gray-500 hover:text-gray-700"
        >
          Prefer Claude? Connect your calls to claude.ai →
        </button>
      )}

      {detailFor && <CallHistoryDetail callSid={detailFor} onClose={() => setDetailFor(null)} />}
    </div>
  );
}
