export type DeviceState = 'uninitialized' | 'initializing' | 'registered' | 'offline' | 'error';

export type CallDirection = 'in' | 'out';

export type CallPhase = 'idle' | 'ringing' | 'connecting' | 'open' | 'closed';

export interface ContactInfo {
  id: string;
  name: string;
  lifecycleStage?: string;
  lastContacted?: string; // ISO date string
  portalUrl: string;
}

export interface ActiveCall {
  sid?: string;
  direction: CallDirection;
  remoteNumber: string;
  phase: CallPhase;
  startedAt: number;
  muted: boolean;
  contact?: ContactInfo;
}

export interface CallRecord {
  id: string;
  sid?: string;
  direction: CallDirection;
  number: string;
  startedAt: number;
  durationSec: number;
  status: 'completed' | 'missed' | 'failed';
  hasTranscript?: boolean;
  contact?: ContactInfo; // snapshot at time of call (for offline lookups)
}

// ── Transcription ────────────────────────────────────────────────

export interface TranscriptSegment {
  /** Milliseconds offset from call start. */
  ts: number;
  speaker: 'user' | 'remote';
  text: string;
  /** Only final segments are persisted. Interim flow live to UI only. */
  isFinal: boolean;
  /** Spoken duration of this segment in ms (from Deepgram `duration`). Used for
   *  accurate talk-to-listen ratio (sum per speaker). Optional for back-compat. */
  durationMs?: number;
}

export interface Transcript {
  callSid: string;
  segments: TranscriptSegment[];
  startedAt: number;
  endedAt: number;
  direction: CallDirection;
  remoteNumber: string;
  contactSnapshot?: ContactInfo;
  createdAt: number;
  /** AI notes for this call. Absent until summarised (or when AI summaries are off). */
  insight?: CallInsight;
}

/** A transcript without its segment bodies — cheap to list in bulk. */
export type TranscriptMeta = Omit<Transcript, 'segments'>;

// ── AI call insight ──────────────────────────────────────────────

/** A commitment made on a call. `done` is the user's own check-off. */
export interface CallPromise {
  id: string;
  text: string;
  /** 'me' = the dialer user promised it; 'them' = the other party did. */
  who: 'me' | 'them';
  /** Local date, YYYY-MM-DD. */
  due?: string;
  /** Seconds into the call where it was said. */
  ts?: number;
  done?: boolean;
}

export interface CallInsight {
  summary: string;
  objections: string[];
  promises: CallPromise[];
  nextStep?: string;
  model: string;
  createdAt: number;
  v: 1;
}

// ── Auto-dialer ──────────────────────────────────────────────────

export type DialerItemStatus = 'pending' | 'calling' | 'done' | 'skipped' | 'failed';
export type DialerOutcome = 'interested' | 'callback' | 'no_answer' | 'do_not_call';

export interface DialerQueueItem {
  id: string;
  /** E.164 number. */
  number: string;
  /** Optional label parsed from paste (e.g. "Jane Doe"). */
  label?: string;
  status: DialerItemStatus;
  outcome?: DialerOutcome;
  /** CallSid linked once the call ends. */
  callSid?: string;
  /** ms when call finished — used to surface "last called" hint. */
  endedAt?: number;
}

export interface Settings {
  accountSid: string;
  apiKeySid: string;
  twimlAppSid: string;
  functionUrl: string;
  clientIdentity: string;
  defaultCallerId: string;
  configuredAt: number;

  /** True for installs provisioned on the backend (no per-user Twilio Function). */
  backendVoice?: boolean;

  // V1.1 — optional, all backward compatible with V0 installs.
  serviceSid?: string;
  environmentSid?: string;
  configSecret?: string;        // shared secret for /config endpoint auth

  // HubSpot CRM (optional)
  hubspotToken?: string;
  hubspotPortalId?: string;

  // Deepgram transcription (optional). Without key → no transcription.
  deepgramApiKey?: string;
  deepgramModel?: string; // user-selectable Deepgram model id; default 'nova-2'
  managedTranscription?: boolean; // P8.3: use our Deepgram key (credits) instead of BYO
  /** Summarise transcribed calls automatically. Undefined = on. */
  aiAutoSummary?: boolean;
  transcriptFolderConfigured?: boolean; // true once user picked a folder via showDirectoryPicker

  // Incoming call routing (optional, defaults: incoming=true, forward=false)
  incomingEnabled?: boolean;
  forwardEnabled?: boolean;
  forwardNumber?: string;

  // v1a — extension prefs + recording (all optional, back-compat).
  clickToCallEnabled?: boolean;
  floatingIconEnabled?: boolean;
  smartCopyEnabled?: boolean;
  lastCalledNumber?: string;
  recordOutgoing?: boolean;
  recordIncoming?: boolean;
  recordingConsentAck?: boolean;
  messagingProvisioned?: boolean;
}
