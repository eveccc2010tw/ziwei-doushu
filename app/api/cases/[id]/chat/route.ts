// /api/cases/[id]/chat — 案件的 AI 對話：GET 讀回、PUT 整段覆蓋（前端以存檔佇列依序送最新內容）
import { NextRequest } from 'next/server';
import { isCaseId, loadCaseChat, saveCaseChat } from '@/lib/cases-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isCaseId(id)) return Response.json({ error: 'invalid id' }, { status: 400 });
  return Response.json({ messages: await loadCaseChat(id) });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isCaseId(id)) return Response.json({ error: 'invalid id' }, { status: 400 });
  let body: { messages?: unknown } | null;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  const entry = await saveCaseChat(id, body?.messages);
  if (!entry) return Response.json({ error: 'case not found' }, { status: 404 });
  return Response.json({ ok: true, chatCount: entry.chatCount ?? 0 });
}
