/**
 * 防濫用回歸（本機假上游，不連真的 AI）：
 *   1. 頻率限制：每人 10 分鐘 30 次、超過回等待秒數、過了視窗恢復；被擋那次不扣額度；同 IP 安全網
 *   2. 身分：CF Access email 優先，其次 cookie；沒 cookie 發新的（https 才加 Secure）
 *   3. /api/interpret：系統提示含「非命理題一句話婉拒」、訊息過長 413、第 31 次 429（含 Retry-After）
 *   4. /api/heming：追問超過 250 字 413；與解讀共用 30 次額度
 *   5. /api/suggest：每人 10 分鐘 60 次，超過 429 且回空題
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { NextRequest } from 'next/server';
import { generateChart } from '../../lib/ziwei/algorithm';
import { checkRate, identifyCaller, rateLimitKeyCount, MAX_KEYS } from '../../lib/rate-limit';
import { ASK_LIMIT, SUGGEST_LIMIT, MAX_QUESTION_CHARS } from '../../lib/ask-limits';

const fails: string[] = [];
const check = (ok: boolean, msg: string) => { if (!ok) fails.push(msg); };

async function main() {
  // 1. 頻率限制
  const t0 = 1_000_000_000_000;
  const a = { person: 'uid:a', ip: '1.1.1.1' };
  for (let i = 0; i < ASK_LIMIT; i++) check(checkRate('ask', a, ASK_LIMIT, t0 + i) === 0, `第 ${i + 1} 次應放行`);
  const retry = checkRate('ask', a, ASK_LIMIT, t0 + 60_000);
  check(retry > 0 && retry <= 600 && retry >= 540, `第 31 次擋下並回等待秒數（${retry}）`);
  check(checkRate('ask', a, ASK_LIMIT, t0 + 600_001) === 0, '視窗過了恢復');
  check(checkRate('ask', { person: 'uid:b', ip: '1.1.1.1' }, ASK_LIMIT, t0 + 60_000) === 0, '別人不受影響');
  const ipOnly = (n: number) => ({ person: `uid:ip-${n}`, ip: '9.9.9.9' });
  let ipBlocked = -1;
  for (let i = 0; i < ASK_LIMIT * 10 + 1; i++) if (checkRate('ask', ipOnly(i), ASK_LIMIT, t0) > 0) { ipBlocked = i; break; }
  check(ipBlocked === ASK_LIMIT * 10, `同 IP 安全網在第 ${ASK_LIMIT * 10 + 1} 次擋（實際 ${ipBlocked + 1}）`);
  check(checkRate('ask', ipOnly(9999), ASK_LIMIT, t0) > 0 && checkRate('ask', { person: 'uid:ip-9999', ip: '8.8.8.8' }, ASK_LIMIT, t0) === 0,
    '被 IP 擋下的那次沒有扣到個人額度');

  // 被 IP 擋下後一直換 cookie：不再新增紀錄（記憶體不長大）；總量另有硬上限
  const before = rateLimitKeyCount();
  for (let i = 0; i < 20_000; i++) checkRate('ask', { person: `uid:flood-${i}`, ip: '9.9.9.9' }, ASK_LIMIT, t0 + 1);
  check(rateLimitKeyCount() === before, `IP 被擋後換 cookie 不增加紀錄（${before}→${rateLimitKeyCount()}）`);
  for (let i = 0; i < MAX_KEYS + 500; i++) checkRate('suggest', { person: `uid:many-${i}`, ip: `10.0.${i >> 8}.${i & 255}` }, SUGGEST_LIMIT, t0 + 2);
  check(rateLimitKeyCount() <= MAX_KEYS, `紀錄總數不超過硬上限（${rateLimitKeyCount()}）`);

  // 2. 身分
  const uid = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
  check(identifyCaller(new NextRequest('https://x/api', { headers: { 'cf-access-authenticated-user-email': 'Ann@Asources.com', cookie: `fate_uid=${uid}` } })).person === 'email:ann@asources.com', 'email 優先');
  const withCookie = identifyCaller(new NextRequest('https://x/api', { headers: { cookie: `fate_uid=${uid}` } }));
  check(withCookie.person === `uid:${uid}` && !withCookie.setCookie, '沿用合法 cookie');
  const fresh = identifyCaller(new NextRequest('http://x/api', { headers: { cookie: 'fate_uid=not-a-uuid', 'x-forwarded-proto': 'https', 'cf-connecting-ip': '5.5.5.5' } }));
  check(!!fresh.setCookie?.includes('HttpOnly') && fresh.setCookie.includes('Secure') && fresh.ip === '5.5.5.5', `不合法 cookie 換新的（https 加 Secure）：${fresh.setCookie}`);
  check(!identifyCaller(new NextRequest('http://x/api')).setCookie?.includes('Secure'), 'http 不加 Secure');

  // 3–5. API（假上游）
  const seen: string[] = [];
  const upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push(body);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '["今年天機化權，我該把握什麼？"]' } }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  const port = await new Promise<number>((r) => upstream.listen(0, '127.0.0.1', () => r((upstream.address() as AddressInfo).port)));
  Object.assign(process.env, {
    INTERPRET_API_KEY: 'k', INTERPRET_BASE_URL: `http://127.0.0.1:${port}`, INTERPRET_MODEL: 'm', INTERPRET_FIRST_TOKEN_TIMEOUT_MS: '2000',
  });
  const interpret = (await import('../../app/api/interpret/route')).POST;
  const heming = (await import('../../app/api/heming/route')).POST;
  const suggest = (await import('../../app/api/suggest/route')).POST;
  const chart = generateChart({ year: 1985, month: 6, day: 15, hour: 4, gender: 'male' });
  const req = (body: unknown, cookie: string) => new NextRequest('https://fate.local/api', {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', cookie, 'cf-connecting-ip': '7.7.7.7' },
  });
  const ask = (content: string, cookie: string) => interpret(req({ chart, messages: [{ role: 'user', content }] }, cookie));

  const p1 = `fate_uid=${uid.replace('0a1b', '1111')}`;
  const first = await ask('幫我寫一段 Python 程式', p1);
  await first.text();
  const system = JSON.parse(seen[seen.length - 1]).messages[0].content as string;
  check(first.status === 200 && system.includes('若問題與命理無關') && system.includes('只用一句話婉拒'), '系統提示含非命理題婉拒規則');
  check((await ask('問'.repeat(1201), p1)).status === 413, '單則訊息過長 413');
  const longHistory = await interpret(req({ chart, messages: [
    { role: 'user', content: '今年財運如何？' }, { role: 'assistant', content: '長'.repeat(9000) }, { role: 'user', content: '那明年呢？' },
  ] }, p1));
  await longHistory.text();
  const sentHistory = JSON.parse(seen[seen.length - 1]).messages as Array<{ role: string; content: string }>;
  check(longHistory.status === 200 && sentHistory.find((m) => m.role === 'assistant')!.content.length === 6000, 'AI 舊回覆過長只截短、不擋下一題');
  for (let i = 2; i < ASK_LIMIT; i++) await (await ask('今年財運如何？', p1)).text();
  const blocked = await ask('今年財運如何？', p1);
  const blockedBody = await blocked.json();
  check(blocked.status === 429 && blockedBody.retryAfterSec > 0 && blocked.headers.get('retry-after') === String(blockedBody.retryAfterSec),
    `第 31 次 429：${blocked.status} ${JSON.stringify(blockedBody)}`);
  check((await heming(req({ chartA: chart, chartB: chart, question: '短問題' }, p1))).status === 429, '合盤與解讀共用 30 次額度');

  const p2 = `fate_uid=${uid.replace('0a1b', '2222')}`;
  const hm = await heming(req({ chartA: chart, chartB: chart, question: '幫我翻譯這段英文' }, p2));
  await hm.text();
  const hmSystem = JSON.parse(seen[seen.length - 1]).messages[0].content as string;
  check(hm.status === 200 && hmSystem.includes('若問題與命理無關') && hmSystem.includes('只用一句話婉拒'), '合盤系統提示也含非命理題婉拒規則');
  check((await heming(req({ chartA: chart, chartB: chart, question: '問'.repeat(MAX_QUESTION_CHARS + 1) }, p2))).status === 413, '合盤追問超過 250 字 413');
  const newcomer = await ask('今年財運如何？', '');
  await newcomer.text();
  check(!!newcomer.headers.get('set-cookie')?.startsWith('fate_uid='), '第一次來發 cookie');

  const p3 = `fate_uid=${uid.replace('0a1b', '3333')}`;
  for (let i = 0; i < SUGGEST_LIMIT; i++) await (await suggest(req({ chart, topic: 'wealth' }, p3))).json();
  const sBlocked = await suggest(req({ chart, topic: 'wealth' }, p3));
  const sBody = await sBlocked.json();
  check(sBlocked.status === 429 && Array.isArray(sBody.questions) && sBody.questions.length === 0, `出題第 61 次 429：${sBlocked.status}`);

  upstream.closeAllConnections();
  upstream.close();
  if (fails.length) {
    console.error(`✗ ai-guard：${fails.length} 項失敗`);
    for (const f of fails) console.error('  ' + f);
    process.exit(1);
  }
  console.log('[ai-guard] 通過：頻率限制與身分、非命理題婉拒規則、訊息長度上限、解讀／合盤共用額度、出題額度');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
