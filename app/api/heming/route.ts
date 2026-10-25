// /api/heming — 合盘 AI 分析后端，上游同 /api/interpret（支援本地 DGX Spark 直连 + 首字逾时自动切换备援）。
// 契约（app/heming/page.tsx）：
//   POST { chartA, chartB, question? } → SSE `data: {"delta":{"text":…}}` … `data: [DONE]`
import { NextRequest } from 'next/server';
import { buildSubjectBasics } from '@/lib/ziwei/subject-context';
import type { ZiweiChart } from '@/lib/ziwei/types';
import { ASK_LIMIT, MAX_QUESTION_CHARS } from '@/lib/ask-limits';
import { identifyCaller, checkRate, tooMany, withCaller } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const BASE_URL = process.env.INTERPRET_BASE_URL || 'https://api.openai.com/v1';
const MODEL = process.env.INTERPRET_MODEL || 'gpt-4o-mini';
const EFFORT = process.env.INTERPRET_EFFORT || 'none';
const ENABLE_THINKING = process.env.INTERPRET_THINKING === 'true';
const FIRST_TOKEN_TIMEOUT_MS = Number(process.env.INTERPRET_FIRST_TOKEN_TIMEOUT_MS || 4500);

const FALLBACK_BASE_URL = process.env.INTERPRET_FALLBACK_BASE_URL || '';
const FALLBACK_MODEL = process.env.INTERPRET_FALLBACK_MODEL || '';

const SYSTEM_PROMPT = `你是紫微斗数（倪海厦《天纪》体系）合盘分析助手。
规则：
- 用户会附上两张命盘 JSON（盘A、盘B）；分析必须严格依据两盘实际星曜、四化、宫位，不编造盘面没有的内容。
- 繁體中文（台灣用語）輸出，用小標題與要點組織（如：性格互动、沟通模式、感情节奏、金钱观、相处建议）。
- 命理名词保留中文。不做医疗诊断或投资指令；结论给「命理视角」，语气专业不玄虚。
- 全文 600–1000 字。
- 只回答與命理、這兩張命盤、運勢與人生方向（從命盤角度）有關的問題。若問題與命理無關（例如寫程式、翻譯、寫文章或信件、一般知識、時事、作業），只用一句話婉拒，並建議一個可以從這兩張命盤問的方向，不要回答原題。`;

function clip(obj: unknown, max = 12000): string {
  const s = obj ? JSON.stringify(obj) : '';
  return s.length > max ? s.slice(0, max) + '…(截断)' : s;
}

interface ActiveUpstream {
  firstText: string;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  initialBuf: string;
}

async function startUpstreamStream(
  baseUrl: string,
  apiKey: string,
  model: string,
  messagesPayload: unknown[],
  firstTokenTimeoutMs: number
): Promise<ActiveUpstream | null> {
  const ac = new AbortController();
  const overallTimer = setTimeout(() => ac.abort(), 90000);
  let firstTokenTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => ac.abort(), firstTokenTimeoutMs);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
        'X-Title': 'ziwei-doushu',
      },
      body: JSON.stringify({
        model,
        stream: true,
        max_tokens: 4096,
        reasoning_effort: EFFORT,
        chat_template_kwargs: { enable_thinking: ENABLE_THINKING },
        messages: messagesPayload,
      }),
    });
    if (!res.ok || !res.body) {
      if (firstTokenTimer) clearTimeout(firstTokenTimer);
      clearTimeout(overallTimer);
      return null;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (firstTokenTimer) clearTimeout(firstTokenTimer);
        clearTimeout(overallTimer);
        return null;
      }
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') {
          if (firstTokenTimer) clearTimeout(firstTokenTimer);
          clearTimeout(overallTimer);
          return null;
        }
        try {
          const text = JSON.parse(data).choices?.[0]?.delta?.content;
          if (typeof text === 'string' && text) {
            if (firstTokenTimer) {
              clearTimeout(firstTokenTimer);
              firstTokenTimer = null;
            }
            const restLines = lines.slice(i + 1).join('\n');
            const initialBuf = restLines ? `${restLines}\n${buf}` : buf;
            return { firstText: text, reader, initialBuf };
          }
        } catch {
          /* skip malformed chunk */
        }
      }
    }
  } catch {
    if (firstTokenTimer) clearTimeout(firstTokenTimer);
    clearTimeout(overallTimer);
    return null;
  }
}

export async function POST(req: NextRequest) {
  const caller = identifyCaller(req);
  const key = process.env.INTERPRET_API_KEY;
  if (!key) return withCaller(new Response('AI provider not configured', { status: 503 }), caller);

  let chartA: unknown; let chartB: unknown; let question = '';
  try {
    const body = await req.json();
    chartA = body.chartA;
    chartB = body.chartB;
    if (typeof body.question === 'string') question = body.question.trim();
  } catch { /* fallthrough */ }
  if (question.length > MAX_QUESTION_CHARS) {
    return withCaller(Response.json({ error: 'question_too_long' }, { status: 413 }), caller);
  }
  const retryAfter = checkRate('ask', caller, ASK_LIMIT);
  if (retryAfter) return tooMany(caller, retryAfter);

  // 兩人的性別、年齡、目前大限與今年流年明確寫出，避免 AI 自行推算出錯
  let subjects = '';
  try {
    subjects = `${buildSubjectBasics(chartA as ZiweiChart, new Date(), '盘A 命主資訊')}\n\n${buildSubjectBasics(chartB as ZiweiChart, new Date(), '盘B 命主資訊')}\n\n`;
  } catch { /* 命盤格式不完整時略過 */ }

  const messagesPayload = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        subjects +
        `盘A(JSON)：\n${clip(chartA)}\n\n盘B(JSON)：\n${clip(chartB)}\n\n` +
        (question ? `重点关注问题：${question}` : '请给出两盘合盘分析。'),
    },
  ];

  let active = await startUpstreamStream(BASE_URL, key, MODEL, messagesPayload, FIRST_TOKEN_TIMEOUT_MS);

  const fbKey = process.env.INTERPRET_FALLBACK_API_KEY;
  if (!active && FALLBACK_BASE_URL && fbKey && FALLBACK_MODEL) {
    active = await startUpstreamStream(FALLBACK_BASE_URL, fbKey, FALLBACK_MODEL, messagesPayload, 25000);
  }

  if (!active) {
    return withCaller(new Response('upstream unavailable', { status: 502 }), caller);
  }

  const { firstText, reader, initialBuf } = active;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buf = initialBuf;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => { if (!closed) controller.enqueue(encoder.encode(s)); };
      const finish = () => {
        if (closed) return;
        closed = true;
        try {
          send('data: [DONE]\n\n');
          controller.close();
        } catch { /* already closed */ }
      };
      send(': connected\n\n');
      send(`data: ${JSON.stringify({ delta: { text: firstText } })}\n\n`);

      const processBufferLines = () => {
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') {
            finish();
            reader.cancel().catch(() => {});
            return true;
          }
          try {
            const text = JSON.parse(data).choices?.[0]?.delta?.content;
            if (typeof text === 'string' && text) {
              send(`data: ${JSON.stringify({ delta: { text } })}\n\n`);
            }
          } catch { /* skip malformed chunk */ }
        }
        return false;
      };

      try {
        if (processBufferLines()) return;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          if (processBufferLines()) return;
        }
        finish();
      } catch {
        finish();
      }
    },
    cancel() { closed = true; reader.cancel().catch(() => {}); },
  });
  return withCaller(new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
  }), caller);
}
