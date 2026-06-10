import { create } from 'zustand';
import type { ActiveCall, CallRecord, DeviceState, Settings, TranscriptSegment } from '@shared/types';

interface CallStore {
  deviceState: DeviceState;
  deviceError: string | null;
  settings: Settings | null;
  activeCall: ActiveCall | null;
  history: CallRecord[];
  view: 'dialpad' | 'history' | 'autodial' | 'settings' | 'pro' | 'sms';
  callerIds: string[];
  selectedCallerId: string;

  setDeviceState: (s: DeviceState, err?: string) => void;
  setSettings: (s: Settings | null) => void;
  setActiveCall: (c: ActiveCall | null) => void;
  patchActiveCall: (p: Partial<ActiveCall>) => void;
  setHistory: (h: CallRecord[]) => void;
  setView: (v: 'dialpad' | 'history' | 'autodial' | 'settings' | 'pro' | 'sms') => void;
  setCallerIds: (ids: string[]) => void;
  setSelectedCallerId: (id: string) => void;

  // Live transcript draft — appended in real-time, cleared when a new call begins.
  // Interim segments overwrite the trailing interim per speaker; final segments are stable.
  transcriptDraft: TranscriptSegment[];
  transcriptError: string | null;
  appendTranscriptSegment: (seg: TranscriptSegment) => void;
  clearTranscriptDraft: () => void;
  setTranscriptError: (e: string | null) => void;
}

// Note: incomingEnabled / forwardEnabled / forwardNumber live on Settings,
// not the store — the StatusBar toggle reads them via `settings`.

export const useCallStore = create<CallStore>((set) => ({
  deviceState: 'uninitialized',
  deviceError: null,
  settings: null,
  activeCall: null,
  history: [],
  view: 'dialpad',
  callerIds: [],
  selectedCallerId: '',

  setDeviceState: (s, err) => set({ deviceState: s, deviceError: err ?? null }),
  setSettings: (s) => set({ settings: s }),
  setActiveCall: (c) => set({ activeCall: c }),
  patchActiveCall: (p) =>
    set((state) => (state.activeCall ? { activeCall: { ...state.activeCall, ...p } } : {})),
  setHistory: (h) => set({ history: h }),
  setView: (v) => set({ view: v }),
  setCallerIds: (ids) => set({ callerIds: ids }),
  setSelectedCallerId: (id) => set({ selectedCallerId: id }),

  transcriptDraft: [],
  transcriptError: null,
  setTranscriptError: (e: string | null) => set({ transcriptError: e }),
  appendTranscriptSegment: (seg) =>
    set((state) => {
      const list = state.transcriptDraft;
      // Replace trailing interim segment for the same speaker; otherwise append.
      const lastIdx = list.length - 1;
      if (lastIdx >= 0) {
        const last = list[lastIdx];
        if (!last.isFinal && last.speaker === seg.speaker) {
          const next = list.slice(0, lastIdx);
          next.push(seg);
          return { transcriptDraft: next };
        }
      }
      return { transcriptDraft: [...list, seg] };
    }),
  clearTranscriptDraft: () => set({ transcriptDraft: [] }),
}));
