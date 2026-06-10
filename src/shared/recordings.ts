import { authHeader } from './cloud';

const BASE_URL = 'https://dialler-mcp.vercel.app';

export interface Recording {
  id: string;
  callSid: string | null;
  durationSec: number | null;
  createdAt: string;
  url: string | null; // short-lived signed playback URL
}

export async function listRecordings(userId: string): Promise<Recording[]> {
  try {
    const res = await fetch(`${BASE_URL}/api/recordings/${userId}`, {
      headers: { Authorization: await authHeader(userId) },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { recordings?: Recording[] };
    return data.recordings ?? [];
  } catch {
    return [];
  }
}

export async function deleteRecording(userId: string, id: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/recordings/${userId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: await authHeader(userId) },
      body: JSON.stringify({ id }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
