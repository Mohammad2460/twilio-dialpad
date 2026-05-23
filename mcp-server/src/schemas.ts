import { z } from 'zod';

// ── On-disk JSON shapes (must match what the extension writes) ──

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

export const CallFileSchema = z.object({
  meta: z.object({
    callSid: z.string(),
    direction: z.enum(['in', 'out']),
    number: z.string(),
    startedAt: z.number(),
    durationSec: z.number(),
    status: z.enum(['completed', 'missed', 'failed']),
    contact: ContactSnapshotSchema.optional(),
  }),
  transcript: z.object({
    segments: z.array(SegmentSchema),
    startedAt: z.number(),
    endedAt: z.number(),
  }).optional(),
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
export type CallFile = z.infer<typeof CallFileSchema>;
export type IndexEntry = z.infer<typeof IndexEntrySchema>;
