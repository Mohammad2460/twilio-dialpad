import { NextRequest, NextResponse } from 'next/server';
import { corsHeaders } from '@/lib/cors';
import { authenticateUser } from '@/lib/auth';
import { getBalance, getActivePricing } from '@/lib/credits';

export const runtime = 'nodejs';

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

function j(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders });
}

/**
 * GET /api/credits/[userId] — current spendable credit balance + per-model pricing.
 * Device-auth. Drives the credit UI (balance, burn-down, model price labels).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  if (!(await authenticateUser(req, userId))) return j({ error: 'Unauthorized' }, 401);

  const [balance, pricing] = await Promise.all([getBalance(userId), getActivePricing()]);
  // Expose only what the client needs to render prices — not raw vendor costs.
  const models = Object.keys(pricing.llm).map((id) => ({ id }));
  return j({ balance, models, pricingVersion: pricing.version });
}
