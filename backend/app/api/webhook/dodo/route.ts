import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { verifyWebhookSignature } from '@/lib/dodo';
import { grant, getActivePricing } from '@/lib/credits';

/**
 * POST /api/webhook/dodo
 * Receives Dodo Payments webhook events.
 * Verifies signature (Standard Webhooks spec), then updates the user row.
 * Returns 200 OK on success; 401 on bad signature; 500 on internal error.
 * Always idempotent — webhook retries are safe.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const webhookId = req.headers.get('webhook-id') ?? '';
  const webhookTimestamp = req.headers.get('webhook-timestamp') ?? '';
  const webhookSignature = req.headers.get('webhook-signature') ?? '';

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return NextResponse.json({ error: 'missing webhook headers' }, { status: 400 });
  }

  let valid = false;
  try {
    valid = await verifyWebhookSignature({
      rawBody,
      webhookId,
      webhookTimestamp,
      webhookSignature,
    });
  } catch (e) {
    console.error('[webhook/dodo] signature verify threw', e);
    return NextResponse.json({ error: 'verify_error' }, { status: 500 });
  }

  if (!valid) {
    console.warn('[webhook/dodo] invalid signature for id', webhookId);
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  let evt: WebhookEvent;
  try {
    evt = JSON.parse(rawBody) as WebhookEvent;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const eventType = evt.type ?? '';
  const data = evt.data ?? {};

  // Locate the user. First try metadata.userId (set during checkout), then by subscription_id.
  const metadataUserId = (data.metadata as Record<string, string> | undefined)?.userId;
  const subscriptionId =
    (data.subscription_id as string | undefined) ??
    (data.id as string | undefined);
  const customerId =
    typeof data.customer === 'object' && data.customer
      ? ((data.customer as Record<string, unknown>).customer_id as string | undefined)
      : (data.customer_id as string | undefined);

  let userId = metadataUserId;
  if (!userId && subscriptionId) {
    const { data: row } = await supabase
      .from('users')
      .select('id')
      .eq('subscription_id', subscriptionId)
      .maybeSingle();
    userId = row?.id;
  }

  if (!userId) {
    console.warn('[webhook/dodo] could not locate user for event', eventType, 'sub', subscriptionId);
    // Still 200 to prevent infinite retries for malformed events.
    return NextResponse.json({ ok: true, note: 'no user matched' }, { status: 200 });
  }

  // Compute current_period_end from various possible payload fields.
  const periodEndRaw =
    (data.next_billing_date as string | undefined) ??
    (data.current_period_end as string | undefined) ??
    (data.period_end as string | undefined) ??
    null;
  const periodEnd = periodEndRaw ? new Date(periodEndRaw).toISOString() : null;

  // Extract customer identity (email + name) from payload — used for support.
  // Dodo nests customer info under `data.customer` on subscription events.
  const customer = (typeof data.customer === 'object' && data.customer
    ? (data.customer as Record<string, unknown>)
    : null) ?? null;
  const customerEmail =
    typeof customer?.email === 'string'
      ? customer.email
      : typeof data.email === 'string'
        ? data.email
        : null;
  const customerName =
    typeof customer?.name === 'string'
      ? customer.name
      : typeof data.name === 'string'
        ? data.name
        : null;

  const update: Record<string, unknown> = {};
  // Capture identity on any event that includes it — defensive across event types.
  if (customerEmail) update.email = customerEmail;
  if (customerName) update.name = customerName;
  if (customerId) update.dodo_customer_id = customerId;

  switch (eventType) {
    case 'subscription.active': {
      update.subscription_status = 'active';
      if (subscriptionId) update.subscription_id = subscriptionId;
      if (periodEnd) update.current_period_end = periodEnd;
      break;
    }
    case 'subscription.renewed': {
      update.subscription_status = 'active';
      if (periodEnd) update.current_period_end = periodEnd;
      break;
    }
    case 'subscription.on_hold':
    case 'payment.failed': {
      update.subscription_status = 'past_due';
      break;
    }
    case 'subscription.cancelled': {
      update.subscription_status = 'cancelled';
      // Keep current_period_end — user retains access until then.
      break;
    }
    case 'subscription.expired': {
      update.subscription_status = 'expired';
      update.current_period_end = null;
      break;
    }
    case 'payment.succeeded': {
      // subscription.renewed handles period bump — here we only flush identity
      // (email/name/customer_id) captured above so support can find the user.
      console.log('[webhook/dodo] payment.succeeded for user', userId);
      break;
    }
    default: {
      console.log('[webhook/dodo] unhandled event', eventType);
      // Fall through — still flush identity if payload carried email/name.
      break;
    }
  }

  // ── Credit grants (v2) ──────────────────────────────────────────────────────
  // Monthly Pro allotment on activation/renewal; one-time top-up on purchase.
  // Idempotent on the webhook delivery id so retries never double-grant. Grant
  // failures are logged but never fail the webhook (payment state already applied).
  try {
    const pricing = await getActivePricing();

    if (eventType === 'subscription.active' || eventType === 'subscription.renewed') {
      const amount = pricing.monthly_grant;
      // Monthly credits expire at cycle end (no roll-over). Fall back to ~31d if
      // the payload carried no period end.
      const expiresAt =
        periodEnd ?? new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();
      if (amount > 0) {
        await grant(userId, amount, 'grant', expiresAt, `grant:${webhookId}`, pricing.version);
      }
    }

    // Top-up: a one-time purchase carrying `topup_credits` in metadata. Flat
    // $0.01/credit; longer expiry from config. MUST gate on the payment-success
    // event — metadata can ride on payment.failed / other lifecycle events, and
    // granting on mere metadata presence would hand out credits without payment.
    if (eventType === 'payment.succeeded') {
      const topupRaw = (data.metadata as Record<string, string> | undefined)?.topup_credits;
      const topupCredits = topupRaw ? parseInt(topupRaw, 10) : 0;
      if (Number.isFinite(topupCredits) && topupCredits > 0) {
        const exp = new Date();
        exp.setMonth(exp.getMonth() + pricing.topup_expiry_months);
        await grant(userId, topupCredits, 'topup', exp.toISOString(), `topup:${webhookId}`, pricing.version);
      }
    }
  } catch (e) {
    console.error('[webhook/dodo] credit grant failed (non-fatal)', e, 'event', eventType, 'user', userId);
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const { error } = await supabase.from('users').update(update).eq('id', userId);
  if (error) {
    console.error('[webhook/dodo] db update failed', error, 'event', eventType, 'user', userId);
    return NextResponse.json({ error: 'db_update_failed' }, { status: 500 });
  }

  console.log('[webhook/dodo] applied', eventType, 'for user', userId);
  return NextResponse.json({ ok: true }, { status: 200 });
}

interface WebhookEvent {
  type?: string;
  data?: Record<string, unknown>;
}
