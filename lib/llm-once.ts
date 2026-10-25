/**
 * 單次 AI 呼叫、回傳整段文字（/api/suggest 出題用）：先打主上游（本地 DGX），首字逾時或失敗改打備援。
 * 上游設定與 /api/interpret 相同的 INTERPRET_* 環境變數。
 */
type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

const EFFORT = process.env.INTERPRET_EFFORT || 'none';
const ENABLE_THINKING = process.env.INTERPRET_THINKING === 'true';

/**
 * 串流讀完整段回覆：首字逾時就放棄（主上游卡住時盡快切備援），整體另有上限。
 */
async function callOnce(
  baseUrl: string, apiKey: string, model: string,
  messages: ChatMessage[], maxTokens: number, firstTokenMs: number,
): Promise<string | null> {
  const ac = new AbortController();
  const overall = setTimeout(() => ac.abort(), 30000);
  let first: ReturnType<typeof setTimeout> | null = setTimeout(() => ac.abort(), firstTokenMs);
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
        max_tokens: maxTokens,
        temperature: 0.9,
        reasoning_effort: EFFORT,
        chat_template_kwargs: { enable_thinking: ENABLE_THINKING },
        messages,
      }),
    });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let text = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') return text.trim() ? text : null;
        try {
          const delta = JSON.parse(data).choices?.[0]?.delta?.content;
          if (typeof delta === 'string' && delta) {
            if (first) { clearTimeout(first); first = null; }
            text += delta;
          }
        } catch { /* skip malformed chunk */ }
      }
    }
    return text.trim() ? text : null;
  } catch {
    return null;
  } finally {
    if (first) clearTimeout(first);
    clearTimeout(overall);
    // 上游回錯誤、或送完 [DONE] 卻不斷線時，主動中止，釋放連線
    ac.abort();
  }
}

export async function chatOnce(messages: ChatMessage[], { maxTokens = 400 }: { maxTokens?: number } = {}): Promise<string | null> {
  const key = process.env.INTERPRET_API_KEY;
  if (key) {
    const text = await callOnce(
      process.env.INTERPRET_BASE_URL || 'https://api.openai.com/v1', key,
      process.env.INTERPRET_MODEL || 'gpt-4o-mini', messages, maxTokens,
      Number(process.env.INTERPRET_FIRST_TOKEN_TIMEOUT_MS || 4500),
    );
    if (text) return text;
  }
  const fbUrl = process.env.INTERPRET_FALLBACK_BASE_URL;
  const fbKey = process.env.INTERPRET_FALLBACK_API_KEY;
  const fbModel = process.env.INTERPRET_FALLBACK_MODEL;
  if (fbUrl && fbKey && fbModel) return callOnce(fbUrl, fbKey, fbModel, messages, maxTokens, 25000);
  return null;
}
