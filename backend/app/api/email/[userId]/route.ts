import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual, randomInt } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { corsHeaders } from '@/lib/cors';
import { authenticateUser } from '@/lib/auth';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VERIFY_CODE_TTL_MS = 15 * 60 * 1_000;
const VERIFY_CODE_MAX = 1_000_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Constant-time comparison of two hex strings (same-length SHA-256 digests). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

function randomSixDigitCode(): string {
  // Cryptographically random 6-digit code (000000–999999) — no modulo bias.
  return String(randomInt(0, VERIFY_CODE_MAX)).padStart(6, '0');
}

/**
 * Email-delivery stub.
 * TODO: wire Resend/SendGrid — replace the console.log below with an actual
 *       API call, e.g.:
 *   await resend.emails.send({ to: email, subject: 'Your code', text: `Code: ${code}` });
 */
async function sendVerificationEmail(email: string, code: string): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('sendVerificationEmail not implemented — wire an email provider');
  }
  console.log(`[email-verify] STUB — would send code ${code} to ${email}`);
}

// ---------------------------------------------------------------------------
// OPTIONS
// ---------------------------------------------------------------------------

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

// ---------------------------------------------------------------------------
// POST — set email + consent, generate + send verification code
// ---------------------------------------------------------------------------

/**
 * POST /api/email/[userId]
 *
 * Body: { email: string; productConsent: boolean; marketingConsent?: boolean }
 *
 * Requires productConsent === true (transactional consent gate).
 * Sets marketing_consent_at only when marketingConsent === true explicitly.
 * Returns { ok: true, sent: true } — plus devCode (non-production only).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;

  if (!(await authenticateUser(req, userId))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  let body: { email?: unknown; productConsent?: unknown; marketingConsent?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400, headers: corsHeaders });
  }

  const { email, productConsent, marketingConsent } = body;

  // --- Validate email ---
  if (typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400, headers: corsHeaders });
  }
  const normalizedEmail = email.trim().toLowerCase();

  // --- Require product (transactional) consent ---
  if (productConsent !== true) {
    return NextResponse.json(
      { error: 'product_consent_required' },
      { status: 400, headers: corsHeaders },
    );
  }

  // --- Verify user row exists before generating a code (read-only probe; the
  //     email is only written in the single atomic update below) ---
  const { data: existing, error: rowCheckError } = await supabase
    .from('users')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (rowCheckError) {
    console.error('[email POST] db row-check failed', rowCheckError);
    return NextResponse.json({ error: 'db_error' }, { status: 500, headers: corsHeaders });
  }

  if (!existing) {
    return NextResponse.json({ error: 'User not found' }, { status: 404, headers: corsHeaders });
  }

  // --- Generate verification code ---
  const code = randomSixDigitCode();
  const codeHash = sha256(code);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + VERIFY_CODE_TTL_MS).toISOString();

  // --- Build the update payload ---
  const update: Record<string, string | null> = {
    email: normalizedEmail,
    product_email_consent_at: now,
    email_verified_at: null,          // re-verify whenever email changes
    email_verify_code_hash: codeHash,
    email_verify_expires_at: expiresAt,
    // marketing_consent_at: only set when explicitly opted in
    ...(marketingConsent === true ? { marketing_consent_at: now } : {}),
  };

  const { error: dbError } = await supabase
    .from('users')
    .update(update)
    .eq('id', userId);

  if (dbError) {
    console.error('[email POST] db update failed', dbError);
    return NextResponse.json({ error: 'db_error' }, { status: 500, headers: corsHeaders });
  }

  // --- Send (stubbed) verification email ---
  await sendVerificationEmail(normalizedEmail, code);

  // --- Response (expose devCode only outside production) ---
  const isDev = process.env.NODE_ENV !== 'production';
  return NextResponse.json(
    { ok: true, sent: true, ...(isDev ? { devCode: code } : {}) },
    { headers: corsHeaders },
  );
}

// ---------------------------------------------------------------------------
// PATCH — verify code
// ---------------------------------------------------------------------------

/**
 * PATCH /api/email/[userId]
 *
 * Body: { code: string }
 *
 * Compares sha256(code) against stored hash and checks expiry.
 * On success: sets email_verified_at, clears hash/expiry columns.
 * On failure: 400 { error: 'invalid_or_expired_code' }.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;

  if (!(await authenticateUser(req, userId))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400, headers: corsHeaders });
  }

  const { code } = body;

  if (typeof code !== 'string' || !code.trim()) {
    return NextResponse.json(
      { error: 'invalid_or_expired_code' },
      { status: 400, headers: corsHeaders },
    );
  }

  // --- Fetch stored hash + expiry ---
  const { data: user, error: fetchError } = await supabase
    .from('users')
    .select('email_verify_code_hash, email_verify_expires_at')
    .eq('id', userId)
    .single();

  if (fetchError || !user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404, headers: corsHeaders });
  }

  const { email_verify_code_hash: storedHash, email_verify_expires_at: expiresAt } = user;

  // Reject if no pending verification or already expired.
  if (
    !storedHash ||
    !expiresAt ||
    new Date(expiresAt).getTime() < Date.now()
  ) {
    return NextResponse.json(
      { error: 'invalid_or_expired_code' },
      { status: 400, headers: corsHeaders },
    );
  }

  // Constant-time comparison.
  const incomingHash = sha256(code.trim());
  if (!safeEqual(incomingHash, storedHash)) {
    return NextResponse.json(
      { error: 'invalid_or_expired_code' },
      { status: 400, headers: corsHeaders },
    );
  }

  // --- Mark verified, clear code columns ---
  const { error: updateError } = await supabase
    .from('users')
    .update({
      email_verified_at: new Date().toISOString(),
      email_verify_code_hash: null,
      email_verify_expires_at: null,
    })
    .eq('id', userId);

  if (updateError) {
    console.error('[email PATCH] db update failed', updateError);
    return NextResponse.json({ error: 'db_error' }, { status: 500, headers: corsHeaders });
  }

  return NextResponse.json({ ok: true, verified: true }, { headers: corsHeaders });
}
