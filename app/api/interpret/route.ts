// /api/interpret — AI 解读后端，接 OpenAI 兼容上游（支援本地 DGX Spark 直连 + 首字逾时自动切换备援）。
// 契约（components/ChatPanel.tsx / InsightPanel.tsx）：
//   POST { chart, messages:[{role,content}] } → SSE `data: {"delta":{"text":…}}` … `data: [DONE]`
import { NextRequest } from 'next/server';
import { formatDatasetKey, getDatasetReading } from '@/lib/ziwei-dataset';

export const runtime = 'nodejs';

const BASE_URL = process.env.INTERPRET_BASE_URL || 'https://api.openai.com/v1';
const MODEL = process.env.INTERPRET_MODEL || 'gpt-4o-mini';
const EFFORT = process.env.INTERPRET_EFFORT || 'none';
const ENABLE_THINKING = process.env.INTERPRET_THINKING === 'true';
const FIRST_TOKEN_TIMEOUT_MS = Number(process.env.INTERPRET_FIRST_TOKEN_TIMEOUT_MS || 4500);

const FALLBACK_BASE_URL = process.env.INTERPRET_FALLBACK_BASE_URL || '';
const FALLBACK_MODEL = process.env.INTERPRET_FALLBACK_MODEL || '';

const SYSTEM_PROMPT = `你是紫微斗数（倪海厦《天纪》体系）命盘解读助手。
规则：
- 用户会附上排盘结果 JSON 以及 v4.0 权威断语库摘要；解读必须严格依据盘中实际星曜、四化、宫位、大限与断语库依据，不编造盘面没有的内容。
- 繁體中文（台灣用語）輸出，用小標題與要點組織，专业但不说玄虚空话。
- 命理名词保留中文（命宫、化禄、廉贞、陀罗等）。
- 健康、财务等话题只给命理视角的提醒，不输出医疗诊断或投资指令。
- 首次整体解读 500–900 字；针对单一问题的追问直答要点，不复述全盘。`;

type InMsg = { role: 'user' | 'assistant'; content: string };

function sse(text: string) {
  return `data: ${JSON.stringify({ delta: { text } })}\n\n`;
}

function clip(obj: unknown, max = 12000): string {
  const s = obj ? JSON.stringify(obj) : '';
  return s.length > max ? s.slice(0, max) + '…(截断)' : s;
}

async function buildDatasetRagSnippet(chart: unknown, lastUserMsg: string): Promise<string> {
  try {
    const bi = (chart as { birthInfo?: { year?: number; month?: number; day?: number; hour?: number; gender?: 'male' | 'female' } })?.birthInfo;
    if (!bi || typeof bi.year !== 'number' || typeof bi.month !== 'number' || typeof bi.day !== 'number' || typeof bi.hour !== 'number' || (bi.gender !== 'male' && bi.gender !== 'female')) {
      return '';
    }
    const key = formatDatasetKey(bi.year, bi.month, bi.day, bi.hour, bi.gender);
    const rec = await getDatasetReading(key, 'auto');
    if (!rec) return '';

    const q = lastUserMsg || '';
    const extraTopics: Array<keyof typeof rec.c> = [];
    if (/感情|婚姻|夫妻|桃花|另一半|戀愛|恋爱/.test(q)) extraTopics.push('love');
    if (/事業|事业|工作|官祿|官禄|創業|创业|跳槽|職/.test(q)) extraTopics.push('career');
    if (/財|财|錢|钱|投資|投资|賺|赚/.test(q)) extraTopics.push('wealth');
    if (/健康|病|身體|身体|疾厄/.test(q)) extraTopics.push('health');
    if (/家庭|兄弟|朋友|人際|人际/.test(q)) extraTopics.push('family', 'friends');
    if (/買房|买房|田宅|搬家|出國|出国|遷移|迁移/.test(q)) extraTopics.push('home', 'move');
    if (/子女|小孩|懷孕|怀孕/.test(q)) extraTopics.push('children');
    if (/父母|長輩|长辈/.test(q)) extraTopics.push('parents');

    const picked = Array.from(new Set(['overview', 'personality', ...extraTopics])).slice(0, 4) as Array<keyof typeof rec.c>;
    const chunks = picked.map((t) => `### [${t}]\n${(rec.c[t] || '').slice(0, 1200)}`);
    return `\n\n【v4.0 权威断语库摘要 (${rec.k} · 命宫主星:${rec.ms || '无主星'})】：\n` + chunks.join('\n\n');
  } catch {
    return '';
  }
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

function proxyActiveStream(active: ActiveUpstream): Response {
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
      send(sse(firstText));

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
            if (typeof text === 'string' && text) send(sse(text));
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
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}

export async function POST(req: NextRequest) {
  const key = process.env.INTERPRET_API_KEY;
  if (!key) return new Response('AI provider not configured', { status: 503 });

  let chart: unknown; let messages: InMsg[] = [];
  try {
    const body = await req.json();
    chart = body.chart;
    if (Array.isArray(body.messages)) messages = body.messages;
  } catch { /* fallthrough */ }

  const chartCtx = clip(chart);
  const safeMsgs = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content }));

  const lastUserContent = [...safeMsgs].reverse().find(m => m.role === 'user')?.content || '';
  const ragCtx = await buildDatasetRagSnippet(chart, lastUserContent);

  const messagesPayload = [
    { role: 'system', content: SYSTEM_PROMPT + (chartCtx ? `\n\n当前命盘数据(JSON)：\n${chartCtx}` : '') + ragCtx },
    ...safeMsgs,
  ];

  let active = await startUpstreamStream(BASE_URL, key, MODEL, messagesPayload, FIRST_TOKEN_TIMEOUT_MS);

  const fbKey = process.env.INTERPRET_FALLBACK_API_KEY;
  if (!active && FALLBACK_BASE_URL && fbKey && FALLBACK_MODEL) {
    active = await startUpstreamStream(FALLBACK_BASE_URL, fbKey, FALLBACK_MODEL, messagesPayload, 25000);
  }

  if (!active) {
    return new Response('upstream unavailable', { status: 502 });
  }
  return proxyActiveStream(active);
}
