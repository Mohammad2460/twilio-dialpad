import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { corsHeaders } from '@/lib/cors';
import { ensurePlanProduct, createCheckoutSession } from '@/lib/dodo';
import { getActivePricing } from '@/lib/credits';
import { checkoutProduct, parseCycle } from '@/lib/plan';
import { authenticateUser } from '@/lib/auth';

export const runtime = 'nodejs';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://dialler-mcp.vercel.app';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

/**
 * POST /api/checkout/[userId]
 * Creates a Dodo checkout session for Pro. Optional body `{ plan: 'monthly' |
 * 'yearly' }`; a request with no body (builds already in the store) is monthly.
 * Returns { checkout_url } to redirect the user.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;

  if (!(await authenticateUser(req, userId))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  // Verify user exists + check current state.
  const { data: user, error } = await supabase
    .from('users')
    .select('id, subscription_status, current_period_end')
    .eq('id', userId)
    .single();

  if (error || !user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404, headers: corsHeaders });
  }

  // Block double-subscribe.
  if (
    user.subscription_status === 'active' &&
    user.current_period_end &&
    new Date(user.current_period_end) > new Date()
  ) {
    return NextResponse.json(
      { error: 'already_subscribed' },
      { status: 409, headers: corsHeaders },
    );
  }

  // Body is optional — older builds send none.
  let requested: unknown;
  try {
    requested = ((await req.json()) as { plan?: unknown } | null)?.plan;
  } catch {
    requested = undefined;
  }
  const cycle = parseCycle(requested);

  try {
    const pricing = await getActivePricing();
    const productId = await ensurePlanProduct(cycle, checkoutProduct(pricing, cycle));
    const returnUrl = `${BASE_URL}/api/checkout/success`;
    const { checkout_url } = await createCheckoutSession(userId, productId, returnUrl);
    return NextResponse.json({ checkout_url }, { headers: corsHeaders });
  } catch (e) {
    console.error('[checkout] failed', e);
    const msg = e instanceof Error ? e.message : 'unknown';
    return NextResponse.json(
      { error: 'checkout_failed', detail: msg },
      { status: 502, headers: corsHeaders },
    );
  }
}
