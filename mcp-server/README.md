# `@twilio-dialer/mcp`

MCP server that exposes your Twilio Dialer Chrome extension's call history and transcripts to Claude (Desktop or Code).

Read-only by default — Claude can search transcripts, pull contact history, and analyze your call patterns, but cannot make outbound calls (yet — coming in a future native-host release).

---

## Setup

### 1. Configure the extension to sync transcripts to a folder

In the extension's Options page:
1. Add your **Deepgram API key** ("Call Transcription" card)
2. Click "Choose folder" in the **Transcript Sync Folder** card → pick a folder, e.g. `~/Documents/Dialer`

After every call, the extension writes:
- `{folder}/calls/{callSid}.json` — one file per call
- `{folder}/index.json` — flat list with summary metadata

### 2. Add the MCP server to Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "twilio-dialer": {
      "command": "npx",
      "args": ["-y", "@twilio-dialer/mcp", "--folder", "/Users/me/Documents/Dialer"]
    }
  }
}
```

Replace `/Users/me/Documents/Dialer` with the folder you picked in the extension.

Restart Claude Desktop. The tools should appear in the tool list.

### 3. Or use with Claude Code

```bash
claude mcp add twilio-dialer -- npx -y @twilio-dialer/mcp --folder /Users/me/Documents/Dialer
```

---

## Available tools

| Tool | What it does |
|------|--------------|
| `list_recent_calls` | List recent calls with metadata (no transcript body) |
| `get_call` | Full metadata for one call |
| `get_transcript` | Transcript for one call (text or JSON format) |
| `search_transcripts` | Full-text search across all transcripts |
| `get_call_stats` | Aggregate metrics: total calls, talk time, missed rate, top contacts |
| `get_contact_history` | All calls + transcripts for one phone number or HubSpot contact |
| `export_bundle` | Generate CSV/JSON dump for backup or external analysis |

All tools are read-only.

---

## Example queries

> "What calls did I have today?"
> "Find any call where pricing was discussed in the last week."
> "Show me everything I have with +14155551234."
> "Generate a CSV of all calls from the past month."
> "Who do I talk to most often?"
> "Summarize the call with the longest duration this week."

---

## Privacy

This MCP server reads only from the local folder you point it at. It does not send your call data anywhere. The extension stores transcripts locally on your device only. Your Twilio + Deepgram API keys never leave your browser.

---

## Develop

```bash
cd mcp-server
pnpm install
pnpm build
node dist/index.js --folder /tmp/test-calls

# Inspect with the MCP Inspector
npx @modelcontextprotocol/inspector node dist/index.js --folder /tmp/test-calls
```
