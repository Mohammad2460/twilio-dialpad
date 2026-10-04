import { NextRequest, NextResponse } from 'next/server';
import { corsHeaders } from '@/lib/cors';
import { authenticateUser } from '@/lib/auth';
import { getActivePricing } from '@/lib/credits';
import { checkoutProduct, nextReset, planLimits } from '@/lib/plan';
import { extraBalanceCents, getUserPlan, readMonthUsage } from '@/lib/usage';

export const runtime = 'nodejs';

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

function j(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders });
}

/**
 * GET /api/plan/[userId] — the user's plan, this month's usage and the limits
 * and prices to show. Device-auth. Display only: the routes that spend enforce
 * the limits themselves. Limits and prices come from pricing_config, so they
 * change without an extension release.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  if (!(await authenticateUser(req, userId))) return j({ error: 'Unauthorized' }, 401);

  const now = Date.now();
  const pricing = await getActivePricing();
  const plan = await getUserPlan(userId, pricing, now);
  if (!plan) return j({ error: 'User not found' }, 404);

  const [usage, balance] = await Promise.all([readMonthUsage(userId, now), extraBalanceCents(userId)]);
  const free = planLimits(pricing, 'free');
  const pro = planLimits(pricing, 'pro');

  return j({
    plan: plan.plan,
    status: plan.status,
    trialDaysLeft: plan.trialDaysLeft,
    trialEndsAt: plan.trialEndsAt ?? undefined,
    periodEnd: plan.periodEnd ?? undefined,
    resetsAt: nextReset(now),
    transcription: { used: usage.transcribeSeconds, limit: plan.limits.transcribe_seconds },
    questions: { used: usage.questions, limit: plan.limits.ai_questions },
    extraBalanceCents: balance,
    prices: {
      monthlyCents: checkoutProduct(pricing, 'monthly').price_cents,
      yearlyCents: checkoutProduct(pricing, 'yearly').price_cents,
    },
    limits: {
      free: { transcriptionSeconds: free.transcribe_seconds, questions: free.ai_questions },
      pro: { transcriptionSeconds: pro.transcribe_seconds, questions: pro.ai_questions },
    },
  });
}
