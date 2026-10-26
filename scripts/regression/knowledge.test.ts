/**
 * 知識庫（/knowledge/[star]/[topic]）回歸：
 *   1. 歸納邏輯：多數樣本都有的行才留下；關鍵推導、特殊格局識別整塊略過；總覽取樣本最多的亮度；亮度差異抓得到
 *   2. 資料庫讀不到／異常時不拋錯、不快取，恢復後立即可用
 *   3. 真實壓縮斷語庫：14 主星 × 13 領域 × 男女全部有內容（原本上游 STAR_DB 為空，182 頁全 404），
 *      無該盤專屬內容外洩；男命／女命分開；句子層級去掉段尾的該盤四化句
 */
import { extractKnowledge, sentences, type KnowledgeSample } from '../../lib/seo/knowledge-extract';
import { ALL_STARS, ALL_TOPICS, getAllKnowledgeRoutes, getKnowledge, hasKnowledge } from '../../lib/seo/knowledge';

const fails: string[] = [];
const check = (ok: boolean, msg: string) => { if (!ok) fails.push(msg); };

// 1. 歸納邏輯（合成樣本）
const mk = (bucket: KnowledgeSample['bucket'], extra: { lundian?: string; yiju?: string; zonglan?: string }): KnowledgeSample => ({
  bucket,
  text: [
    `**【命格总览】**\n\n${extra.zonglan ?? '通用總覽'}`,
    '**【一句话定调】**\n\n天府是南斗第一星。',
    `**【核心论断】**\n\n通用論斷第一段。\n\n${extra.lundian ?? ''}\n\n**关键推导**（倪师断法引擎）：\n· 〔倪师断法·格局〕本盤專屬推導`,
    `**【命盘依据】**\n\n· **通用依據**——說明。\n${extra.yiju ?? ''}\n\n▍**特殊格局识别**\n\n⭐ **文曲化忌**：本盤專屬格局`,
    '**【经典出处】**\n\n· 《全書》通用出處',
  ].join('\n\n'),
});
const k = extractKnowledge([
  mk('bright', { lundian: '天府庙旺，守财最强。', yiju: '· 本盤專屬依據 A', zonglan: '廟旺版總覽' }),
  mk('bright', { lundian: '天府庙旺，守财最强。', zonglan: '廟旺版總覽' }),
  mk('bright', { lundian: '天府庙旺，守财最强。', zonglan: '廟旺版總覽' }),
  mk('dim', { lundian: '天府落陷，守财较弱。', zonglan: '落陷版總覽' }),
  mk('dim', { lundian: '天府落陷，守财较弱。', yiju: '· 本盤專屬依據 B', zonglan: '落陷版總覽' }),
]);
check(k.dingdiao === '天府是南斗第一星。', `定調：${k.dingdiao}`);
check(k.lundian === '通用論斷第一段。', `論斷只留通用段、去掉關鍵推導：${JSON.stringify(k.lundian)}`);
check(k.yiju === '· **通用依據**——說明。', `依據去掉專屬條目與特殊格局：${JSON.stringify(k.yiju)}`);
check(k.chuchu === '· 《全書》通用出處', '出處');
check(k.zonglan === '廟旺版總覽' && k.zonglanBucket === 'bright', `總覽取樣本最多的亮度：${k.zonglan} ${k.zonglanBucket}`);
check(k.brightness.bright?.[0] === '天府庙旺，守财最强。' && k.brightness.dim?.[0] === '天府落陷，守财较弱。', `亮度差異：${JSON.stringify(k.brightness)}`);
check(JSON.stringify(k.samples) === JSON.stringify({ bright: 3, dim: 2 }), `樣本統計：${JSON.stringify(k.samples)}`);
check(extractKnowledge([]).dingdiao === '', '沒有樣本回空');
check(JSON.stringify(sentences('倪师说「甲。乙。」后面。再一句。')) === JSON.stringify(['倪师说「甲。乙。」后面。', '再一句。']), `引號內句號不切：${JSON.stringify(sentences('倪师说「甲。乙。」后面。再一句。'))}`);
const single = extractKnowledge([1, 2, 3].map(() => mk('bright', { lundian: '武曲入庙，财星发挥到极致。' })));
check(!single.lundian.includes('入庙') && single.brightness.bright?.[0] === '武曲入庙，财星发挥到极致。', `只有一種亮度時，亮度句移到亮度差異：${JSON.stringify(single.brightness)}`);
const tail = extractKnowledge([
  mk('bright', { lundian: '通用句。化忌（阻碍）则家宅不安。' }), mk('normal', { lundian: '通用句。化禄（进财）则有收益。' }),
  mk('dim', { lundian: '通用句。' }), mk('dim', { lundian: '通用句。' }),
]);
check(tail.lundian.includes('通用句。') && !/化忌|化禄/.test(tail.lundian), `段尾依該盤四化的句子去掉：${JSON.stringify(tail.lundian)}`);

check(JSON.stringify(sentences('他说“甲。乙。”然后。')) === JSON.stringify(['他说“甲。乙。”然后。']), '彎引號內句號不切');

// 2. 資料庫讀不到／讀取異常時：不拋錯、頁面不存在、不快取；資料庫恢復後同一頁立即可用
//    （須在下面全量讀取之前跑，避免該組合已被快取）
process.env.ZIWEI_SQLITE_PATH = '/nonexistent/ziwei-v4.sqlite';
const missing = getKnowledge('破军', 'move', 'female');
process.env.ZIWEI_SQLITE_PATH = 'package.json'; // 不是 SQLite 檔：開檔或查詢會拋錯
let threw = false;
let broken;
try { broken = getKnowledge('破军', 'home', 'female'); } catch { threw = true; }
delete process.env.ZIWEI_SQLITE_PATH;
check(!missing.exists && !threw && broken?.exists === false, `資料庫讀不到或異常時不拋錯、頁面不存在（threw=${threw}）`);
check(getKnowledge('破军', 'move', 'female').exists && getKnowledge('破军', 'home', 'female').exists, '資料庫恢復後同一頁立即可用（未被快取成不存在）');

// 3. 真實壓縮斷語庫
const t0 = performance.now();
check(getAllKnowledgeRoutes().length === ALL_STARS.length * ALL_TOPICS.length, `182 頁都有樣本（${getAllKnowledgeRoutes().length}）`);
let exists = 0;
const leaks: string[] = [];
for (const star of ALL_STARS) {
  for (const topic of ALL_TOPICS) {
    if (!hasKnowledge(star, topic)) continue;
    for (const g of ['male', 'female'] as const) {
      const d = getKnowledge(star, topic, g);
      if (d.exists && d.parsed.dingdiao && d.parsed.lundian) exists++;
      const body = [d.parsed.zonglan, d.parsed.lundian, d.parsed.yiju, d.parsed.chuchu].join('\n');
      if (/关键推导|倪师断法·|特殊格局识别|⭐/.test(body)) leaks.push(`${star}|${topic}|${g}：推導／格局標記`);
      // 經典出處的「卷二·某宮》X条」只能是這顆星自己的條目（其他星的條目是該盤同宮星帶進來的）
      for (const m of d.parsed.chuchu.matchAll(/卷二·[^》]*》([\u4e00-\u9fff]{2})条/g)) {
        if (m[1] !== star) leaks.push(`${star}|${topic}|${g}：出處混入「${m[1]}条」`);
      }
      // 亮度句（主星＋廟旺／落陷開頭）不該留在通用論斷
      if (d.parsed.lundian.split('\n').flatMap(sentences).some((u) => /^[\u4e00-\u9fff]{2}(入庙|庙旺|居庙|落陷|居陷|得地)/.test(u))) {
        leaks.push(`${star}|${topic}|${g}：亮度句留在通用論斷`);
      }
    }
  }
}
const ms = performance.now() - t0;
check(exists === 364, `182 頁 × 男女都抽得出定調與論斷（${exists}）`);
check(leaks.length === 0, `無該盤專屬內容外洩：${leaks.slice(0, 5)}`);
check(getKnowledge('天府', 'overview').parsed.dingdiao.startsWith('天府是南斗第一星'), '天府坐命定調正確');
check(getKnowledge('武曲', 'wealth').palaceName === '财帛', '領域對應宮位');
check(getKnowledge('紫微', 'spirit', 'female').parsed.lundian.includes('女命') && !getKnowledge('紫微', 'spirit', 'male').parsed.lundian.includes('女命'),
  '男命／女命分開歸納（紫微坐福德）');
check(!/化忌（阻碍）则|化禄（进财）则/.test(getKnowledge('天机', 'home').parsed.lundian) && getKnowledge('天机', 'home').parsed.lundian.includes('退祖新创置'),
  '段尾依該盤四化接的句子被去掉、通用句保留（天機坐田宅）');

if (fails.length) {
  console.error(`✗ knowledge：${fails.length} 項失敗`);
  for (const f of fails) console.error('  ' + f);
  process.exit(1);
}
console.log(`[knowledge] 通過：歸納邏輯、182 頁由壓縮斷語庫產生且無專屬內容外洩（全部抽取 ${ms.toFixed(0)}ms）`);
