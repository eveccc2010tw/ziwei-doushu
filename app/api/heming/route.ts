// /api/heming — 合盘 AI 分析后端，上游同 /api/interpret。
// 契约（app/heming/page.tsx）：
//   POST { chartA, chartB, question? } → SSE `data: {"delta":{"text":…}}` … `data: [DONE]`
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

const BASE_URL = process.env.INTERPRET_BASE_URL || 'https://api.openai.com/v1';
const MODEL = process.env.INTERPRET_MODEL || 'gpt-4o-mini';
const EFFORT = process.env.INTERPRET_EFFORT || 'none';
const ENABLE_THINKING = process.env.INTERPRET_THINKING === 'true';

const FALLBACK_BASE_URL = process.env.INTERPRET_FALLBACK_BASE_URL || '';
const FALLBACK_MODEL = process.env.INTERPRET_FALLBACK_MODEL || '';

const SYSTEM_PROMPT = `你是紫微斗数（倪海厦《天纪》体系）合盘分析助手。
规则：
- 用户会附上两张命盘 JSON（盘A、盘B）；分析必须严格依据两盘实际星曜、四化、宫位，不编造盘面没有的内容。
- 繁體中文（台灣用語）輸出，用小標題與要點組織（如：性格互动、沟通模式、感情节奏、金钱观、相处建议）。
- 命理名词保留中文。不做医疗诊断或投资指令；结论给「命理视角」，语气专业不玄虚。
- 全文 600–1000 字。`;

function clip(obj: unknown, max = 12000): string {
  const s = obj ? JSON.stringify(obj) : '';
  return s.length > max ? s.slice(0, max) + '…(截断)' : s;
}

export async function POST(req: NextRequest) {
  const key = process.env.INTERPRET_API_KEY;
  if (!key) return new Response('AI provider not configured', { status: 503 });

  let chartA: unknown; let chartB: unknown; let question = '';
  try {
    const body = await req.json();
    chartA = body.chartA;
    chartB = body.chartB;
    if (typeof body.question === 'string') question = body.question.slice(0, 500);
  } catch { /* fallthrough */ }

  const messagesPayload = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        `盘A(JSON)：\n${clip(chartA)}\n\n盘B(JSON)：\n${clip(chartB)}\n\n` +
        (question ? `重点关注问题：${question}` : '请给出两盘合盘分析。'),
    },
  ];

  async function callUpstream(baseUrl: string, apiKey: string, model: string) {
    return fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(90000),
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
  }

  let upstream: Response | null = null;
  try {
    upstream = await callUpstream(BASE_URL, key, MODEL);
  } catch {
    upstream = null;
  }

  const fbKey = process.env.INTERPRET_FALLBACK_API_KEY;
  if ((!upstream || !upstream.ok || !upstream.body) && FALLBACK_BASE_URL && fbKey && FALLBACK_MODEL) {
    try {
      upstream = await callUpstream(FALLBACK_BASE_URL, fbKey, FALLBACK_MODEL);
    } catch {
      upstream = null;
    }
  }

  if (!upstream || !upstream.ok || !upstream.body) {
    return new Response(`upstream ${upstream?.status ?? 'unreachable'}`, { status: 502 });
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buf = '';
  let closed = false;
  let sentAny = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => { if (!closed) controller.enqueue(encoder.encode(s)); };
      const finish = () => {
        if (closed) return;
        closed = true;
        try {
          if (!sentAny) send(`data: ${JSON.stringify({ delta: { text: '（本次分析生成失败或被截断，请重试一次。）' } })}\n\n`);
          send('data: [DONE]\n\n');
          controller.close();
        } catch { /* already closed */ }
      };
      send(': connected\n\n');
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);
            if (data === '[DONE]') { finish(); reader.cancel().catch(() => {}); return; }
            try {
              const text = JSON.parse(data).choices?.[0]?.delta?.content;
              if (typeof text === 'string' && text) {
                sentAny = true;
                send(`data: ${JSON.stringify({ delta: { text } })}\n\n`);
              }
            } catch { /* skip malformed chunk */ }
          }
        }
        finish();
      } catch {
        finish();
      }
    },
    cancel() { closed = true; reader.cancel().catch(() => {}); },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}
