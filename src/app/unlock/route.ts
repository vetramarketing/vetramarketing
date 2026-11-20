import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkRequestAccess, privateCache } from '@/lib/server/access-response';
import { safeWorkspaceReturn } from '@/lib/server/site-access';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const session = await checkRequestAccess(request, true);
  if (!(session instanceof Response)) {
    return new Response(null, {
      status: 303,
      headers: { ...privateCache, Location: safeWorkspaceReturn(params.get('next')) },
    });
  }
  if (session.status === 503) return session;
  const template = await readFile(join(process.cwd(), 'public/access/unlock.html'), 'utf8');
  const messages = new Map([
    ['invalid', 'รหัส PIN ไม่ถูกต้อง ลองอีกครั้ง'],
    ['limited', 'ลองหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองอีกครั้ง'],
    ['unavailable', 'ขณะนี้ยังปลดล็อกไม่ได้ กรุณาลองใหม่ภายหลัง'],
  ]);
  const html = template
    .replace('__WORKSPACE_RETURN__', safeWorkspaceReturn(params.get('next')))
    .replace('<!--access-status-->', messages.get(params.get('error') ?? '') ?? '');
  return new Response(html, {
    headers: {
      ...privateCache,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy':
        "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      'Referrer-Policy': 'same-origin',
    },
  });
}
