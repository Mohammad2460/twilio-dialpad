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
}

export interface Settings {
  accountSid: string;
  apiKeySid: string;
  twimlAppSid: string;
  functionUrl: string;
  clientIdentity: string;
  defaultCallerId: string;
  configuredAt: number;

  // V1.1 — optional, all backward compatible with V0 installs.
  serviceSid?: string;
  environmentSid?: string;
  configSecret?: string;        // shared secret for /config endpoint auth

  // HubSpot CRM (optional)
  hubspotToken?: string;
  hubspotPortalId?: string;

  // Deepgram transcription (optional). Without key → no transcription.
  deepgramApiKey?: string;
  transcriptFolderConfigured?: boolean; // true once user picked a folder via showDirectoryPicker

  // Incoming call routing (optional, defaults: incoming=true, forward=false)
  incomingEnabled?: boolean;
  forwardEnabled?: boolean;
  forwardNumber?: string;
}
