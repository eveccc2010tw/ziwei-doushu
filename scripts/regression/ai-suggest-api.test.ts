/**
 * AI 出題 API 回歸（本機假上游，不連真的 AI）：
 *   1. 主上游卡住（首字逾時）／回 500 → 改走備援；兩邊都掛 → null
 *   2. 主上游送完 [DONE] 卻不斷線 → 立即回傳並中止連線
 *   3. /api/suggest：壞 JSON、null、原型屬性領域、宮名格式錯 → 400（不 500）；
 *      正常 → 200 且剔除與盤面不符的題；上游全掛 → 502
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { generateChart } from '../../lib/ziwei/algorithm';

type Mode = 'hang' | 'error500' | 'ok' | 'ok-keepalive';

function upstream(name: string) {
  const state = { mode: 'ok' as Mode, reply: '', hits: 0, closedAfterDone: false };
  const server = http.createServer((req, res) => {
    state.hits++;
    req.resume();
    if (state.mode === 'hang') return; // 不回任何東西
    if (state.mode === 'error500') { res.writeHead(500); res.end('boom'); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const ch of [state.reply.slice(0, 5), state.reply.slice(5)]) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    if (state.mode === 'ok') { res.end(); return; }
    res.on('close', () => { state.closedAfterDone = true; }); // ok-keepalive：不主動結束
  });
  return { name, state, server };
}

const fails: string[] = [];
const check = (ok: boolean, msg: string) => { if (!ok) fails.push(msg); };
const listen = (s: http.Server) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const primary = upstream('primary');
  const fallback = upstream('fallback');
  const [pp, fp] = await Promise.all([listen(primary.server), listen(fallback.server)]);
  Object.assign(process.env, {
    INTERPRET_API_KEY: 'k1', INTERPRET_BASE_URL: `http://127.0.0.1:${pp}`, INTERPRET_MODEL: 'm1',
    INTERPRET_FALLBACK_API_KEY: 'k2', INTERPRET_FALLBACK_BASE_URL: `http://127.0.0.1:${fp}`, INTERPRET_FALLBACK_MODEL: 'm2',
    INTERPRET_FIRST_TOKEN_TIMEOUT_MS: '400',
  });
  const { chatOnce } = await import('../../lib/llm-once');
  const { POST } = await import('../../app/api/suggest/route');
  const msgs = [{ role: 'user' as const, content: 'hi' }];
  primary.state.reply = '主上游回覆內容';
  fallback.state.reply = '備援回覆內容';

  // 1. 備援切換
  primary.state.mode = 'hang';
  let t = Date.now();
  check((await chatOnce(msgs)) === '備援回覆內容' && Date.now() - t < 2500, `主上游卡住 → 首字逾時改走備援（${Date.now() - t}ms）`);
  primary.state.mode = 'error500';
  check((await chatOnce(msgs)) === '備援回覆內容', '主上游 500 → 備援');
  fallback.state.mode = 'error500';
  check((await chatOnce(msgs)) === null, '兩邊都失敗 → null');
  fallback.state.mode = 'ok';

  // 2. [DONE] 後不斷線
  primary.state.mode = 'ok-keepalive';
  t = Date.now();
  check((await chatOnce(msgs)) === '主上游回覆內容' && Date.now() - t < 1000, '[DONE] 後立即回傳');
  await sleep(200);
  check(primary.state.closedAfterDone, '[DONE] 後主動中止連線');

  // 3. /api/suggest
  const call = (body: string) => POST(new Request('http://local/api/suggest', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } }) as never);
  const chart = generateChart({ year: 1985, month: 6, day: 15, hour: 4, gender: 'male' });
  check((await call('{bad')).status === 400, '壞 JSON → 400');
  check((await call('null')).status === 400, 'null → 400');
  check((await call(JSON.stringify({ chart, topic: 'constructor' }))).status === 400, '原型屬性領域 → 400');
  const broken = { ...chart, palaces: chart.palaces.map((p, i) => (i === 0 ? { ...p, name: 123 } : p)) };
  check((await call(JSON.stringify({ chart: broken, topic: 'wealth' }))).status === 400, '宮名格式錯 → 400');

  primary.state.mode = 'ok';
  primary.state.reply = JSON.stringify(['財帛宮的主星武曲，我存得住錢嗎？', '財帛空宮借對宮，我適合靠副業增加收入嗎？', '今年天機化權，我該把握什麼？']);
  const ok = await call(JSON.stringify({ chart, topic: 'wealth', profile: { relationship: 'married', occupation: '亂填' } }));
  const okBody = await ok.json();
  check(ok.status === 200 && okBody.questions.length === 2 && !okBody.questions.some((q: string) => q.includes('武曲')), `正常出題並剔除不符題（${JSON.stringify(okBody)}）`);

  primary.state.mode = 'error500';
  fallback.state.mode = 'error500';
  const down = await call(JSON.stringify({ chart, topic: 'wealth' }));
  check(down.status === 502 && (await down.json()).questions.length === 0, '上游全掛 → 502、空題');

  primary.server.closeAllConnections();
  fallback.server.closeAllConnections();
  primary.server.close();
  fallback.server.close();

  if (fails.length) {
    console.error(`✗ ai-suggest-api：${fails.length} 項失敗`);
    for (const f of fails) console.error('  ' + f);
    process.exit(1);
  }
  console.log('[ai-suggest-api] 通過：首字逾時／500 改走備援、[DONE] 後中止連線、出題 API 錯誤輸入與上游失敗');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
