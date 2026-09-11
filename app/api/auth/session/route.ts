import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { readRuntimeConfig } from '@/lib/platform/config';
import { PRIVATE_SESSION_COOKIE } from '@/services/auth/private-route';
import { verifySupabaseSession } from '@/services/auth/server-session';

const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/' };

export async function POST(request: Request) {
  const body = await request.json().catch(() => undefined) as { accessToken?: unknown } | undefined;
  if (typeof body?.accessToken !== 'string' || body.accessToken.length < 20 || body.accessToken.length > 8192)
    return NextResponse.json({ error: 'invalid_session' }, { status: 400 });
  const config = readRuntimeConfig(process.env);
  const user = await verifySupabaseSession(new Request(request.url, { headers: { authorization: `Bearer ${body.accessToken}` } }), config);
  if (!user) return NextResponse.json({ error: 'invalid_session' }, { status: 401 });
  (await cookies()).set(PRIVATE_SESSION_COOKIE, body.accessToken, { ...cookieOptions, maxAge: 60 * 60 * 24 * 7 });
  return NextResponse.json({ user: { id: user.id, email: user.email } });
}

export async function DELETE() {
  (await cookies()).delete(PRIVATE_SESSION_COOKIE);
  return new NextResponse(null, { status: 204 });
}
