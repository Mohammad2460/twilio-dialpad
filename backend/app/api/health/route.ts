import { NextResponse } from 'next/server';
import { corsHeaders } from '@/lib/cors';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET() {
  return NextResponse.json({ ok: true }, { headers: corsHeaders });
}
