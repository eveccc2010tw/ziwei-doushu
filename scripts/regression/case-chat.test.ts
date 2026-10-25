/**
 * 案件覆蓋更新與 AI 對話存檔回歸（寫到暫存目錄，不碰正式資料）：
 *   1. 帶 id 再存＝覆蓋同一案件（不多一筆）；不帶 id＝另存新案件
 *   2. 對話存讀：只留合法訊息、截長度、保留最後 80 則、hidden 保留；chatCount 只算看得到的
 *   3. 案件不存在不存；id 格式不合（含路徑穿越）一律拒絕；刪案件連對話檔一起刪
 *   4. /api/cases/[id]/chat：GET／PUT 的 id 驗證、案件不存在 404
 */
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

const fails: string[] = [];
const check = (ok: boolean, msg: string) => { if (!ok) fails.push(msg); };

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), 'fate-cases-'));
  process.env.CASES_FILE = path.join(dir, 'cases.json');
  const store = await import('../../lib/cases-store');
  const route = await import('../../app/api/cases/[id]/chat/route');

  // 1. 覆蓋更新 vs 另存
  const form = { name: '陳大同', year: '1985', month: '6', day: '15' };
  const a = await store.saveCase({ name: '陳大同', note: '初診', form });
  const a2 = await store.saveCase({ id: a.id, name: '陳大同', note: '複診', form: { ...form, profile: { relationship: 'married' } } });
  let list = await store.listCases();
  check(a2.id === a.id && list.length === 1 && list[0].note === '複診', `帶 id 覆蓋同一案件（${list.length} 筆）`);
  const b = await store.saveCase({ name: '陳大同', note: '另存', form });
  list = await store.listCases();
  check(b.id !== a.id && list.length === 2, '不帶 id 另存新案件');

  // 2. 對話存讀
  const msgs = [
    { role: 'user', content: '請生成命格總覽…', hidden: true },
    { role: 'assistant', content: '長'.repeat(7000) },
    { role: 'user', content: '今年財運？' },
    { role: 'system', content: '不該存' },
    { role: 'assistant', content: '' },
    { role: 'assistant', content: '財運回覆', hidden: 'yes' },
  ];
  const saved = await store.saveCaseChat(a.id, msgs);
  const loaded = await store.loadCaseChat(a.id);
  check(saved?.chatCount === 3, `chatCount 只算看得到的訊息（${saved?.chatCount}）`);
  check(loaded.length === 4 && loaded[0].hidden === true && loaded[1].content.length === 6000 && loaded[3].hidden === undefined,
    `對話清洗：${JSON.stringify(loaded.map((m) => [m.role, m.content.length, m.hidden]))}`);
  const many = Array.from({ length: 120 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `第${i}則` }));
  await store.saveCaseChat(a.id, many);
  const kept = await store.loadCaseChat(a.id);
  check(kept.length === store.MAX_CHAT_MESSAGES && kept[kept.length - 1].content === '第119則', '只留最後 80 則');

  // 3. 拒絕與刪除
  check((await store.saveCaseChat('cnotexist123', msgs)) === null, '案件不存在不存');
  check(!store.isCaseId('../cases') && !store.isCaseId('c../../x') && !store.isCaseId('C123456') && store.isCaseId('cmvnun1hwhr0z'), 'id 格式驗證');
  check((await store.loadCaseChat('../cases')).length === 0, '不合法 id 讀不到東西');
  const chatPath = path.join(dir, 'case-chats', `${a.id}.json`);
  check(existsSync(chatPath), '對話檔存在');
  await store.deleteCase(a.id);
  check(!existsSync(chatPath) && (await store.listCases()).length === 1, '刪案件連對話檔一起刪');

  // 4. API
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const put = (id: string, body: unknown) => route.PUT(new NextRequest(`http://x/api/cases/${id}/chat`, { method: 'PUT', body: JSON.stringify(body) }), ctx(id));
  check((await route.GET(new NextRequest('http://x'), ctx('..%2Fcases'))).status === 400, 'GET 不合法 id 400');
  check((await put('cnotexist123', { messages: msgs })).status === 404, 'PUT 案件不存在 404');
  const ok = await put(b.id, { messages: [{ role: 'user', content: '問' }, { role: 'assistant', content: '答' }] });
  check(ok.status === 200 && (await ok.json()).chatCount === 2, 'PUT 成功回 chatCount');
  const got = await (await route.GET(new NextRequest('http://x'), ctx(b.id))).json();
  check(got.messages.length === 2 && got.messages[1].content === '答', 'GET 讀回對話');
  check((await store.listCases()).find((c) => c.id === b.id)?.chatCount === 2, '案件清單帶 chatCount');

  // 5. 超過 500 案淘汰最舊時，連對話檔一起刪；被淘汰的案件讀不到對話
  const first = (await store.listCases())[(await store.listCases()).length - 1];
  await store.saveCaseChat(first.id, [{ role: 'user', content: '最舊案件的對話' }]);
  for (let i = 0; i < 500; i++) await store.saveCase({ name: `填充${i}`, form: {} });
  check(!existsSync(path.join(dir, 'case-chats', `${first.id}.json`)) && (await store.loadCaseChat(first.id)).length === 0, '淘汰最舊案件連對話檔一起刪');

  // 6. 前端存檔佇列：依序送、送出時取「該次起盤」最新的對話、失敗不卡住後面
  const { createChatSaveQueue } = await import('../../lib/ziwei/chat-save-queue');
  const bySession = new Map<number, string[]>([[1, ['a1']]]);
  const sent: Array<[string, string[]]> = [];
  const gates: Array<() => void> = [];
  const queue = createChatSaveQueue<string>({
    latestFor: (s) => bySession.get(s) ?? [],
    save: (id, m) => new Promise((resolve) => { gates.push(() => { sent.push([id, [...m]]); resolve(id !== 'bad'); }); }),
  });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  // 手動存檔排進佇列後、送出前又答完一題 → 送出的是新內容
  const q1 = queue('A', 1);
  bySession.set(1, ['a1', 'a2']);
  const q2 = queue('A', 1); // 自動存
  await tick();
  check(gates.length === 1, '一次只送一筆');
  gates.shift()!(); await q1; await tick();
  gates.shift()!(); await q2;
  check(JSON.stringify(sent) === JSON.stringify([['A', ['a1', 'a2']], ['A', ['a1', 'a2']]]), `送出時取最新內容：${JSON.stringify(sent)}`);
  // A 的手動存檔很慢：期間又答了一題並自動存好，接著重新起盤（session 2），舊的手動存檔才送 → 仍送 A 盤最新內容
  bySession.set(1, ['a1', 'a2', 'a3']);
  const auto = queue('A', 1);
  await tick(); gates.shift()!(); await auto;
  bySession.set(2, ['B 盤的對話']);
  const lateManual = queue('A', 1);
  await tick(); gates.shift()!(); await lateManual;
  check(JSON.stringify(sent[sent.length - 1]) === JSON.stringify(['A', ['a1', 'a2', 'a3']]), '換盤後晚到的舊存檔送原盤最新內容，不回退、不寫入 B');
  const q4 = queue('bad', 2);
  const q5 = queue('A', 2);
  await tick(); gates.shift()!();
  check((await q4) === false, '失敗回 false');
  await tick(); gates.shift()!();
  check((await q5) === true, '失敗不卡住後面的存檔');

  if (fails.length) {
    console.error(`✗ case-chat：${fails.length} 項失敗`);
    for (const f of fails) console.error('  ' + f);
    process.exit(1);
  }
  console.log('[case-chat] 通過：案件覆蓋更新／另存、對話存讀與清洗、id 驗證、刪案件連對話、對話 API');
}

main().catch((e) => { console.error(e); process.exit(1); });
