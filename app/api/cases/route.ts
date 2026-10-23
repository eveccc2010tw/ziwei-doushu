// /api/cases — 案件列表與儲存（server 端，跨裝置）
import { NextRequest } from 'next/server';
import { listCases, saveCase } from '@/lib/cases-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const cases = await listCases();
  return Response.json({ cases });
}

export async function POST(req: NextRequest) {
  let body: { id?: string; name?: string; note?: string; form?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : '';
  if (!name) return Response.json({ error: 'name required' }, { status: 400 });
  if (!body.form || typeof body.form !== 'object') return Response.json({ error: 'form required' }, { status: 400 });
  const entry = await saveCase({
    id: typeof body.id === 'string' ? body.id : undefined,
    name,
    note: typeof body.note === 'string' ? body.note.slice(0, 500) : '',
    form: body.form,
  });
  return Response.json({ case: entry });
}
