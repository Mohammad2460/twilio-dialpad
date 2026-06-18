import { create } from 'zustand';
import type { ActiveCall, CallRecord, DeviceState, Settings, TranscriptSegment } from '@shared/types';

interface CallStore {
  deviceState: DeviceState;
  deviceError: string | null;
  settings: Settings | null;
  activeCall: ActiveCall | null;
  history: CallRecord[];
  view: 'dialpad' | 'history' | 'autodial' | 'settings' | 'pro' | 'sms' | 'ai';
  callerIds: string[];
  selectedCallerId: string;

  setDeviceState: (s: DeviceState, err?: string) => void;
  setSettings: (s: Settings | null) => void;
  setActiveCall: (c: ActiveCall | null) => void;
  patchActiveCall: (p: Partial<ActiveCall>) => void;
  setHistory: (h: CallRecord[]) => void;
  setView: (v: 'dialpad' | 'history' | 'autodial' | 'settings' | 'pro' | 'sms' | 'ai') => void;
  setCallerIds: (ids: string[]) => void;
  setSelectedCallerId: (id: string) => void;

  // Live transcript draft — appended in real-time, cleared when a new call begins.
  // At most one live interim per speaker — a speaker's prior interim is dropped on
  // their next segment; final segments are stable and never removed.
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
      // Keep at most one live interim per speaker. multichannel=true interleaves
      // user (ch0) and remote (ch1) results, so a trailing-only check leaves stale
      // interim lines when speakers overlap. Drop this speaker's prior interim
      // (finals are stable), then append the new segment.
      const base = state.transcriptDraft.filter(
        (s) => s.isFinal || s.speaker !== seg.speaker,
      );
      return { transcriptDraft: [...base, seg] };
    }),
  clearTranscriptDraft: () => set({ transcriptDraft: [] }),
}));
