// Copied from mcp-server/src/schemas.ts — shared shapes between extension and backend.
import { z } from 'zod';

export const SegmentSchema = z.object({
  ts: z.number(),
  speaker: z.enum(['user', 'remote']),
  text: z.string(),
  isFinal: z.boolean(),
});

export const ContactSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  lifecycleStage: z.string().optional(),
  lastContacted: z.string().optional(),
  portalUrl: z.string(),
}).partial();

export const CallMetaSchema = z.object({
  callSid: z.string(),
  direction: z.enum(['in', 'out']),
  number: z.string(),
  startedAt: z.number(),
  durationSec: z.number(),
  status: z.enum(['completed', 'missed', 'failed']),
  contact: ContactSnapshotSchema.optional(),
});

export const TranscriptBodySchema = z.object({
  segments: z.array(SegmentSchema),
  startedAt: z.number(),
  endedAt: z.number(),
}).optional();

export const IngestCallSchema = z.object({
  meta: CallMetaSchema,
  transcript: TranscriptBodySchema,
});

export const CallFileSchema = z.object({
  meta: CallMetaSchema,
  transcript: TranscriptBodySchema,
});

export const IndexEntrySchema = z.object({
  sid: z.string(),
  direction: z.enum(['in', 'out']),
  number: z.string(),
  startedAt: z.number(),
  durationSec: z.number(),
  status: z.enum(['completed', 'missed', 'failed']),
  hasTranscript: z.boolean().optional(),
});

export type Segment = z.infer<typeof SegmentSchema>;
export type CallMeta = z.infer<typeof CallMetaSchema>;
export type CallFile = z.infer<typeof CallFileSchema>;
export type IndexEntry = z.infer<typeof IndexEntrySchema>;
export type IngestCall = z.infer<typeof IngestCallSchema>;
