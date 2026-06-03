// Telemetry ingest contract — shared shape between extension and backend.
// Keep this in sync with src/shared/telemetry.ts on the extension side.
import { z } from 'zod';

/**
 * Allowlisted event names. Anything else is rejected at ingest.
 * Order/rank lives in SQL (tel_stage_rank) — this is just the gate.
 */
export const EVENT_NAMES = [
  'extension_installed',
  'panel_opened',
  'wizard_started',
  'twilio_creds_submitted',
  'autodeploy_succeeded',
  'autodeploy_failed',
  'device_ready',
  'first_call_synced',
  'transcript_enabled',
] as const;

export const EventNameSchema = z.enum(EVENT_NAMES);

// meta is intentionally small + PII-free. We cap size and key count server-side.
// Allowed value types: string (short), number, boolean.
const MetaValue = z.union([z.string().max(120), z.number(), z.boolean()]);

export const TelemetryEventSchema = z.object({
  id: z.string().uuid(), // client-generated, idempotency key
  name: EventNameSchema,
  ts: z.number().int().positive(), // client epoch ms
  meta: z.record(MetaValue).optional(),
});

export const TrackBatchSchema = z.object({
  installId: z.string().uuid(),
  userId: z.string().uuid().nullable().optional(),
  events: z.array(TelemetryEventSchema).min(1).max(50), // batch cap
});

export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;
export type TrackBatch = z.infer<typeof TrackBatchSchema>;

// ALLOWLIST (not denylist): only these meta keys are ever persisted. Any other
// key — including a future one that accidentally carries PII — is dropped. This
// is the safe default: new keys are excluded until explicitly added here.
const ALLOWED_META_KEYS = new Set([
  'step',          // autodeploy_failed: which step
  'reason',        // autodeploy_failed: coarse error (already truncated client-side)
  'reconfigure',   // twilio_creds_submitted: re-run vs first setup
  'hasTranscript', // first_call_synced: true/false
  'backfill',      // extension_installed: backfilled existing install
]);

/** Keep only allowlisted keys. Returns a clean, PII-free meta object. */
export function sanitizeMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!meta) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (ALLOWED_META_KEYS.has(k)) out[k] = v;
  }
  return out;
}
