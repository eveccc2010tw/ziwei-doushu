// /api/interpret — 开源版未含的 AI 解读后端，接 OpenAI 兼容上游（env 可换供应商）。
// 契约（components/ChatPanel.tsx / InsightPanel.tsx）：
//   POST { chart, messages:[{role,content}] } → SSE `data: {"delta":{"text":…}}` … `data: [DONE]`
import { NextRequest } from 'next/server';
import { formatDatasetKey, getDatasetReading } from '@/lib/ziwei-dataset';

export const runtime = 'nodejs';

const BASE_URL = process.env.INTERPRET_BASE_URL || 'https://api.runinfra.ai/v1';
const MODEL = process.env.INTERPRET_MODEL || 'glm-5-3-flash';
const EFFORT = process.env.INTERPRET_EFFORT || 'low'; // RunInfra glm-5-3-flash 默认 reasoning 爆 token；low 实测 6s 完整作答

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
    if (/健康|疾厄|病|身體|身体/.test(q)) extraTopics.push('health');
    if (/性格|個性|个性/.test(q)) extraTopics.push('personality');
    if (/田宅|房|買房|买房|不動產/.test(q)) extraTopics.push('home');
    if (/福德|精神|心態/.test(q)) extraTopics.push('spirit');
    if (/遷移|迁移|出國|出国|外地/.test(q)) extraTopics.push('move');
    if (/父母|長輩/.test(q)) extraTopics.push('parents');
    if (/子女|小孩|孩子/.test(q)) extraTopics.push('children');
    if (/兄弟|合夥|合伙/.test(q)) extraTopics.push('family');
    if (/人際|朋友|僕役|交友|貴人/.test(q)) extraTopics.push('friends');

    const picked = ['overview' as const, ...extraTopics.filter(t => t !== 'overview')].slice(0, 2);
    const chunks = picked.map(t => (rec.c[t] || '').slice(0, 1800));
    return `\n\n当前命盘 v4.0 权威断语库参考（key=${rec.k}, engine=${rec._engine.source}）：\n${chunks.join('\n\n---\n\n')}`;
  } catch {
    return '';
  }
}

/** OpenAI 兼容 SSE → 本站 SSE。push-based（start 内循环）：reasoning 阶段无 content delta，
 *  pull-based 串流在 Node 实测不会再次触发 pull，会卡死 —— 勿改回 pull 模式。 */
function proxyStream(upstream: Response): Response {
  const reader = upstream.body!.getReader();
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
          if (!sentAny) send(sse('（本次解读生成失败或被截断，请重试一次。）'));
          send('data: [DONE]\n\n');
          controller.close();
        } catch { /* already closed */ }
      };
      send(': connected\n\n'); // SSE comment：headers 立刻下发；前端解析器会跳过非 data: 行
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
              if (typeof text === 'string' && text) { sentAny = true; send(sse(text)); }
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

  const upstream = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(120000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'HTTP-Referer': process.env.NEXT_PUBLIC_SITE_URL || 'https://fate.asources.com',
      'X-Title': 'fate-ziwei',
    },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      max_tokens: 8192,
      reasoning_effort: EFFORT,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT + (chartCtx ? `\n\n当前命盘数据(JSON)：\n${chartCtx}` : '') + ragCtx },
        ...safeMsgs,
      ],
    }),
  });
  if (!upstream.ok || !upstream.body) return new Response(`upstream ${upstream.status}`, { status: 502 });
  return proxyStream(upstream);
}
