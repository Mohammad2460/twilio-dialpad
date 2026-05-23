import type { ContactInfo } from './types';

const HUBSPOT_API = 'https://api.hubapi.com';

interface HubSpotSearchResponse {
  total: number;
  results: Array<{
    id: string;
    properties: {
      firstname?: string;
      lastname?: string;
      phone?: string;
      mobilephone?: string;
      email?: string;
      lifecyclestage?: string;
      notes_last_contacted?: string;
      lastmodifieddate?: string;
    };
  }>;
}

function buildPortalUrl(portalId: string, contactId: string): string {
  return `https://app.hubspot.com/contacts/${portalId}/contact/${contactId}`;
}

function nameFrom(p: HubSpotSearchResponse['results'][number]['properties']): string {
  const full = `${p.firstname ?? ''} ${p.lastname ?? ''}`.trim();
  return full || p.email || 'Unknown';
}

/**
 * Look up a HubSpot contact by phone number.
 * Tries `phone` first, then `mobilephone` if no hit.
 * Returns null on miss or any error (never throws — caller treats lookup as best-effort).
 */
export async function findContactByPhone(
  token: string,
  portalId: string,
  e164: string,
): Promise<ContactInfo | null> {
  if (!token || !portalId || !e164) return null;

  const properties = [
    'firstname', 'lastname', 'phone', 'mobilephone', 'email',
    'lifecyclestage', 'notes_last_contacted', 'lastmodifieddate',
  ];

  async function search(propertyName: string): Promise<HubSpotSearchResponse | null> {
    try {
      const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/contacts/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          filterGroups: [{
            filters: [{ propertyName, operator: 'EQ', value: e164 }],
          }],
          properties,
          limit: 1,
        }),
      });
      if (!res.ok) {
        console.warn('[hubspot] search failed', res.status, await res.text().catch(() => ''));
        return null;
      }
      return (await res.json()) as HubSpotSearchResponse;
    } catch (e) {
      console.warn('[hubspot] search threw', e);
      return null;
    }
  }

  // Try `phone` first.
  let resp = await search('phone');
  if (!resp || resp.total === 0) {
    // Fallback to `mobilephone`.
    resp = await search('mobilephone');
  }
  if (!resp || resp.results.length === 0) return null;

  const hit = resp.results[0];
  return {
    id: hit.id,
    name: nameFrom(hit.properties),
    lifecycleStage: hit.properties.lifecyclestage,
    lastContacted: hit.properties.notes_last_contacted ?? hit.properties.lastmodifieddate,
    portalUrl: buildPortalUrl(portalId, hit.id),
  };
}

/** Human-readable "3 days ago" / "2 hours ago" formatter for `lastContacted`. */
export function formatRelativeDate(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return undefined;
  const diff = Date.now() - d;
  if (diff < 0) return undefined;
  const day = 86400000;
  const hr = 3600000;
  const min = 60000;
  if (diff < min) return 'just now';
  if (diff < hr) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hr)}h ago`;
  if (diff < day * 30) return `${Math.floor(diff / day)}d ago`;
  if (diff < day * 365) return `${Math.floor(diff / (day * 30))}mo ago`;
  return `${Math.floor(diff / (day * 365))}y ago`;
}
