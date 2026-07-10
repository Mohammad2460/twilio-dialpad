/**
 * Feature flags — UI visibility switches.
 *
 * These hide features without removing their code. Flip a flag back to true
 * to restore the feature exactly as it was.
 */

/** In-extension AI chat (AiTab, AiChatbox, AI upsell bullets). Hidden for now. */
export const AI_CHAT_ENABLED = false;

/**
 * Bring-your-own Deepgram key. When false, the key/model inputs are hidden and
 * transcription always runs through managed transcription (our key, credits).
 */
export const BYO_DEEPGRAM_ENABLED = false;

/** Claude MCP connector promotion (dedicated tab + upgraded promo blocks). */
export const MCP_PROMO_ENABLED = true;
