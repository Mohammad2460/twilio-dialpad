import { NextRequest, NextResponse } from 'next/server';
import { corsHeaders } from '@/lib/cors';
import { authenticateUser } from '@/lib/auth';
import { ensureTopUpProduct, createTopUpCheckout } from '@/lib/dodo';

export const runtime = 'nodejs';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://dialler-mcp.vercel.app';

// Allowed top-up pack sizes (credits). Flat $0.01/credit — no bulk discount
// (per plan: discounts erode the 3x margin floor). Server-side allowlist so the
// client can't set an arbitrary price/credit amount.
const PACKS = new Set([1000, 2500, 5000]);

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

/**
 * POST /api/checkout/topup/[userId] — start a one-time credit top-up checkout.
 * Body: { credits }. Device-auth. Returns { checkout_url }.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  if (!(await authenticateUser(req, userId))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  let credits = 0;
  try {
    credits = Number(((await req.json()) as { credits?: unknown }).credits);
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400, headers: corsHeaders });
  }
  if (!PACKS.has(credits)) {
    return NextResponse.json(
      { error: 'invalid_pack', allowed: [...PACKS] },
      { status: 400, headers: corsHeaders },
    );
  }

  try {
    const productId = await ensureTopUpProduct();
    const returnUrl = `${BASE_URL}/api/checkout/success`;
    const { checkout_url } = await createTopUpCheckout(userId, credits, productId, returnUrl);
    return NextResponse.json({ checkout_url }, { headers: corsHeaders });
  } catch (e) {
    console.error('[checkout/topup] failed', e);
    const msg = e instanceof Error ? e.message : 'unknown';
    return NextResponse.json(
      { error: 'checkout_failed', detail: msg },
      { status: 502, headers: corsHeaders },
    );
  }
}
