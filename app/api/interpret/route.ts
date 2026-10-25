// /api/interpret — AI 解读后端，接 OpenAI 兼容上游（支援本地 DGX Spark 直连 + 首字逾时自动切换备援）。
// 契约（components/ChatPanel.tsx / InsightPanel.tsx）：
//   POST { chart, messages:[{role,content}], profile? } → SSE `data: {"delta":{"text":…}}` … `data: [DONE]`
import { NextRequest } from 'next/server';
import { formatDatasetKey, getDatasetReading } from '@/lib/ziwei-dataset';
import { sanitizeProfile } from '@/lib/ziwei/profile';
import { buildSubjectContext, palaceSummary } from '@/lib/ziwei/subject-context';
import type { ZiweiChart } from '@/lib/ziwei/types';
import { ASK_LIMIT } from '@/lib/ask-limits';
import { identifyCaller, checkRate, tooMany, withCaller } from '@/lib/rate-limit';

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
- 首次整体解读 500–900 字；针对单一问题的追问直答要点，不复述全盘。
- 只回答與命理、這張命盤、運勢與人生方向（從命盤角度）有關的問題。若問題與命理無關（例如寫程式、翻譯、寫文章或信件、一般知識、時事、作業），只用一句話婉拒，並建議一個可以從這張命盤問的方向，不要回答原題。`;

/**
 * 長度上限（防濫用）：對話框打字另由前端限 250 字；使用者訊息硬上限放寬到 1200，
 * 因為點領域／宮位／四化會送出內建的長提示詞。AI 舊回覆隨對話紀錄送回時只截短、不拒絕，
 * 免得某次回覆特別長就讓之後每一題都被擋。
 */
const MAX_USER_MSG_CHARS = 1200;
const MAX_ASSISTANT_MSG_CHARS = 6000;

/** 回答結構：命盤推斷只看盤；有填現況才加「對照你的現況」段（沒填時規則裡完全不提，避免 AI 硬寫一段） */
const CHART_ONLY_RULE = `1. 先寫命盤推斷：只根據命盤（星曜、四化、宮位、大限、流年）與斷語庫，並引用具體宮位、星曜、四化或大限流年作依據；宮位干支與星曜以【十二宮摘要】為準。使用者指定了段落結構就照該結構寫，否則以「**【命盤推斷】**」為標題。`;

function answerRules(hasProfile: boolean): string {
  if (!hasProfile) {
    return `
回答結構（務必遵守）：
${CHART_ONLY_RULE}
2. 命主沒有提供任何現況：只寫命盤推斷，不要另寫任何談命主現況的段落，也不要猜測命主的感情、職業或財務狀況。
3. 年齡、今年、目前大限一律以【命主資訊】為準。`;
  }
  return `
回答結構（務必遵守）：
${CHART_ONLY_RULE}這部分完全不得提及、暗示或引用命主現況（感情、職業、子女、收入、存款、關心事項），也不得假裝從盤上「看出」現況。
2. 最後一段固定為「**【對照你的現況】**」，每一點以下列三種之一開頭：
   - ✅吻合：盤面與現況一致，說明怎麼順勢發揮。
   - ⚠️落差：盤面與現況不同。不說盤錯、也不說人選錯，解讀為盤面潛力尚未發揮，給一個過渡做法；不得建議辭職、離婚、分手、借貸投資等激烈決定。
   - 💡時機：結合年齡、目前大限（含今年還有幾年）與今年流年，說明哪段時間做什麼。
   細則：只用與本題相關的現況欄位，不要逐項複述；資產對照時，房地產對應田宅宮、現金＋股票對應財帛宮；金額只用所給區間談比例與習慣，不推薦投資商品、不編具體金額；離婚、喪偶、待業、健康等狀態語氣溫和、不說宿命、不做醫療診斷；盤面對此沒有依據就直說「盤面對此著墨不多」。本題與現況無關時（例如純命理名詞解釋）省略此段。
3. 不得用現況推論或修正盤面（例如「你已婚所以夫妻宮……」）。
4. 篇幅：命盤推斷約六到七成，對照段約三到四成；短的追問兩段各 2–4 點。
5. 年齡、今年、目前大限一律以【命主資訊】為準。`;
}

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
  const caller = identifyCaller(req);
  const key = process.env.INTERPRET_API_KEY;
  if (!key) return withCaller(new Response('AI provider not configured', { status: 503 }), caller);

  let chart: unknown; let messages: InMsg[] = []; let profileRaw: unknown;
  try {
    const body = await req.json();
    chart = body.chart;
    profileRaw = body.profile;
    if (Array.isArray(body.messages)) messages = body.messages;
  } catch { /* fallthrough */ }

  const tooLong = messages.some((m) => m && m.role === 'user' && typeof m.content === 'string' && m.content.length > MAX_USER_MSG_CHARS);
  if (tooLong) return withCaller(Response.json({ error: 'message_too_long' }, { status: 413 }), caller);
  const retryAfter = checkRate('ask', caller, ASK_LIMIT);
  if (retryAfter) return tooMany(caller, retryAfter);

  const profile = sanitizeProfile(profileRaw);
  let subjectCtx = '';
  try {
    subjectCtx = `${buildSubjectContext(chart as ZiweiChart, profile)}\n\n${palaceSummary(chart as ZiweiChart)}`;
  } catch { /* 命盤格式不完整時略過命主資訊與宮位摘要 */ }

  const chartCtx = clip(chart);
  const safeMsgs = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.role === 'assistant' ? m.content.slice(0, MAX_ASSISTANT_MSG_CHARS) : m.content }));

  const lastUserContent = [...safeMsgs].reverse().find(m => m.role === 'user')?.content || '';
  const ragCtx = await buildDatasetRagSnippet(chart, lastUserContent);

  const messagesPayload = [
    {
      role: 'system',
      content: SYSTEM_PROMPT + answerRules(!!profile)
        + (subjectCtx ? `\n\n${subjectCtx}` : '')
        + (chartCtx ? `\n\n当前命盘数据(JSON)：\n${chartCtx}` : '') + ragCtx,
    },
    ...safeMsgs,
  ];

  let active = await startUpstreamStream(BASE_URL, key, MODEL, messagesPayload, FIRST_TOKEN_TIMEOUT_MS);

  const fbKey = process.env.INTERPRET_FALLBACK_API_KEY;
  if (!active && FALLBACK_BASE_URL && fbKey && FALLBACK_MODEL) {
    active = await startUpstreamStream(FALLBACK_BASE_URL, fbKey, FALLBACK_MODEL, messagesPayload, 25000);
  }

  if (!active) {
    return withCaller(new Response('upstream unavailable', { status: 502 }), caller);
  }
  return withCaller(proxyActiveStream(active), caller);
}
