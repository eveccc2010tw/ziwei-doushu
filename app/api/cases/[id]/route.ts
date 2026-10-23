// /api/cases/[id] — 刪除案件
import { NextRequest } from 'next/server';
import { deleteCase } from '@/lib/cases-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await deleteCase(id);
  return Response.json({ ok: true });
}
