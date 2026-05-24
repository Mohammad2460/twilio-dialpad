/**
 * CORS headers for all API routes.
 * Chrome extensions use chrome-extension:// origin — must allow all origins.
 * Claude.ai also hits the MCP endpoint from its own origin.
 */
export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id',
  'Access-Control-Max-Age': '86400',
};

export function withCors(headers: Record<string, string> = {}): Record<string, string> {
  return { ...corsHeaders, ...headers };
}
