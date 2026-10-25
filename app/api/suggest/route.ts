// /api/suggest — AI 依本盤出題（AI 互動解讀切到某領域時呼叫）。
// 契約（components/InsightPanel.tsx）：POST { chart, topic, profile? } → { questions: string[] }（0–3 題，已驗證）
import { NextRequest } from 'next/server';
import type { ZiweiChart } from '@/lib/ziwei/types';
import { TOPIC_PALACE_NAME, type TopicKey } from '@/lib/ziwei/db-analysis';
import { sanitizeProfile } from '@/lib/ziwei/profile';
import { chartFacts } from '@/lib/ziwei/subject-context';
import { buildSuggestMessages, parseSuggestions, validateSuggestions } from '@/lib/ziwei/suggest';
import { chatOnce } from '@/lib/llm-once';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 命盤由 client 傳來，先驗結構，避免組提示詞時拋例外 */
function looksLikeChart(c: unknown): c is ZiweiChart {
  const x = c as ZiweiChart | null | undefined;
  if (!x || typeof x !== 'object' || !x.birthInfo || !x.lunarInfo) return false;
  const bi = x.birthInfo;
  return isNum(bi.year) && isNum(bi.month) && isNum(bi.day) && isNum(bi.hour) && isNum(x.lunarInfo.lunarYear)
    && Array.isArray(x.daXians) && x.daXians.every((d) => d && isNum(d.startAge) && isNum(d.endAge) && isNum(d.palaceBranch))
    && Array.isArray(x.palaces) && x.palaces.length === 12
    && x.palaces.every((p) => p && typeof p.name === 'string' && isNum(p.branch) && isNum(p.stem) && Array.isArray(p.stars)
      && p.stars.every((st) => st && typeof st.name === 'string'));
}

export async function POST(req: NextRequest) {
  let body: { chart?: unknown; topic?: unknown; profile?: unknown } | null;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') return Response.json({ error: 'chart and topic required' }, { status: 400 });
  const { chart, topic } = body;
  if (!looksLikeChart(chart) || typeof topic !== 'string' || !Object.hasOwn(TOPIC_PALACE_NAME, topic)) {
    return Response.json({ error: 'chart and topic required' }, { status: 400 });
  }
  const profile = sanitizeProfile(body.profile);
  const now = new Date();
  let facts;
  let messages;
  try {
    facts = chartFacts(chart, now);
    messages = buildSuggestMessages(chart, topic as TopicKey, profile, now);
  } catch {
    return Response.json({ error: 'invalid chart' }, { status: 400 });
  }

  const text = await chatOnce(messages);
  if (!text) return Response.json({ questions: [], error: 'upstream unavailable' }, { status: 502 });
  try {
    return Response.json({ questions: validateSuggestions(parseSuggestions(text), chart, facts, { profile }) });
  } catch {
    return Response.json({ questions: [] });
  }
}
