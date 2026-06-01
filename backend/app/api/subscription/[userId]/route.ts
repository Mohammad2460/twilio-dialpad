import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { corsHeaders } from '@/lib/cors';
import { cancelSubscription } from '@/lib/dodo';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

type Status = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired';

/**
 * GET /api/subscription/[userId]
 * Returns the user's subscription state for the options page.
 * Auth: Authorization: Bearer {userId}
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;

  const bearer = req.headers.get('Authorization') ?? '';
  const token = bearer.replace(/^Bearer\s+/, '');
  if (!token || token !== userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('subscription_status, trial_ends_at, current_period_end')
    .eq('id', userId)
    .single();

  if (error || !user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404, headers: corsHeaders });
  }

  const now = Date.now();
  const trialEnds = user.trial_ends_at ? new Date(user.trial_ends_at).getTime() : null;
  const periodEnd = user.current_period_end ? new Date(user.current_period_end).getTime() : null;
  const status = (user.subscription_status as Status) ?? 'trialing';

  // Mirror SQL user_has_access logic for the client.
  let hasAccess = false;
  if ((status === 'active' || status === 'past_due') && periodEnd && periodEnd > now) hasAccess = true;
  else if (status === 'cancelled' && periodEnd && periodEnd > now) hasAccess = true;
  else if (status === 'trialing' && trialEnds && trialEnds > now) hasAccess = true;

  // daysLeft = whichever future timestamp is relevant.
  let daysLeft: number | undefined;
  if (status === 'trialing' && trialEnds && trialEnds > now) {
    daysLeft = Math.ceil((trialEnds - now) / 86_400_000);
  } else if (periodEnd && periodEnd > now) {
    daysLeft = Math.ceil((periodEnd - now) / 86_400_000);
  }

  return NextResponse.json(
    {
      status,
      hasAccess,
      daysLeft,
      trialEndsAt: user.trial_ends_at ?? undefined,
      currentPeriodEnd: user.current_period_end ?? undefined,
    },
    { headers: corsHeaders },
  );
}

/**
 * DELETE /api/subscription/[userId]
 * Cancels the user's Dodo subscription at period end.
 * Access continues until `current_period_end` — the webhook
 * `subscription.cancelled` event flips `subscription_status='cancelled'`.
 *
 * Auth: Authorization: Bearer {userId}
 * Returns { ok: true, cancelsAt: ISO date } on success.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;

  const bearer = req.headers.get('Authorization') ?? '';
  const token = bearer.replace(/^Bearer\s+/, '');
  if (!token || token !== userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  // Look up subscription_id for this user.
  const { data: user, error: lookupErr } = await supabase
    .from('users')
    .select('subscription_id, subscription_status, current_period_end')
    .eq('id', userId)
    .single();

  if (lookupErr || !user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404, headers: corsHeaders });
  }

  if (!user.subscription_id) {
    return NextResponse.json(
      { error: 'no_active_subscription', detail: 'User is on trial or never subscribed.' },
      { status: 400, headers: corsHeaders },
    );
  }

  if (user.subscription_status === 'cancelled' || user.subscription_status === 'expired') {
    return NextResponse.json(
      { ok: true, alreadyCancelled: true, cancelsAt: user.current_period_end },
      { headers: corsHeaders },
    );
  }

  const result = await cancelSubscription(user.subscription_id);
  if (!result.ok) {
    console.error('[subscription DELETE] dodo cancel failed', result);
    return NextResponse.json(
      { error: 'dodo_cancel_failed', status: result.status, detail: result.body },
      { status: 502, headers: corsHeaders },
    );
  }

  // Optimistically flip status — webhook will re-confirm.
  await supabase
    .from('users')
    .update({ subscription_status: 'cancelled' })
    .eq('id', userId);

  return NextResponse.json(
    { ok: true, cancelsAt: user.current_period_end },
    { headers: corsHeaders },
  );
}
