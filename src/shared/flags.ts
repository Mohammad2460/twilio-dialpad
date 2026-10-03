/**
 * Feature flags — UI visibility switches.
 *
 * These hide features without removing their code. Flip a flag back to true
 * to restore the feature exactly as it was.
 */

/**
 * In-extension AI assistant: AI tab (Today, promises, chat over calls), automatic
 * call summaries, pre-call brief. Off = the Claude connector tab takes its place.
 */
export const AI_CHAT_ENABLED = true;

/**
 * Bring-your-own Deepgram key. When false, the key/model inputs are hidden and
 * transcription always runs through managed transcription (our key, credits).
 */
export const BYO_DEEPGRAM_ENABLED = false;

/** Claude MCP connector promotion (dedicated tab + upgraded promo blocks). */
export const MCP_PROMO_ENABLED = true;
