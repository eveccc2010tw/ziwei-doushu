/**
 * 產生知識庫的樣本索引：lib/seo/knowledge-samples.json
 *
 * 知識庫「主星 × 宮位」的論斷來自壓縮斷語庫（data/ziwei-v4.sqlite）：每張盤的 13 維斷語裡，
 * 某宮只有一顆主星時，該領域的「一句話定調／核心論斷／命盤依據／經典出處」就是這顆星坐這宮的通用論斷
 * （夾雜少量該盤專屬內容）。這裡為每個「主星 × 領域」挑 4 對樣本盤（同一出生時辰男女各一張；同一亮度
 * bright／normal／dim 最多 3 對，讓各種亮度都有代表；各對出生年不同、月時組合不同，避免依年干、月、時排的
 * 四化與輔星剛好同宮而被誤當成通用內容），執行時讀這些盤的斷語、男女分開取共同段落（lib/seo/knowledge-extract.ts）。
 * 排一張盤約 60ms，最多掃 MAX_CHARTS 張；極少見的組合樣本可能不足 8 張。
 *
 * 用法：npx tsx scripts/knowledge/build-sample-index.ts
 * 結果是確定性的（固定掃描順序），改了排盤引擎或資料庫後重跑即可。
 */
import { writeFileSync } from 'node:fs';
import { generateChart } from '../../lib/ziwei/algorithm';
import { formatDatasetKey } from '../../lib/ziwei-dataset';
import { TOPIC_PALACE_NAME, type TopicKey } from '../../lib/ziwei/db-analysis';

const PER_BUCKET = 6;   // 同一亮度最多 3 對（不少組合只會出現一種亮度）
const TARGET = 8;       // 4 對（男女各 4 張）
const MAX_CHARTS = 8000;
const OUT = 'lib/seo/knowledge-samples.json';
const YEARS = Array.from({ length: 10 }, (_, i) => 1980 + i); // 十個年干各一年

/** 固定種子的亂數（mulberry32）；回傳 0..n-1。舊版用線性同餘取低位元，週期太短會一直抽到同一個時辰 */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return (n: number) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
  };
}

const norm = (n: string) => n.replace(/宫$/, '');
const topicsByPalace = new Map<string, TopicKey[]>();
for (const [topic, palace] of Object.entries(TOPIC_PALACE_NAME) as [TopicKey, string][]) {
  const k = norm(palace);
  topicsByPalace.set(k, [...(topicsByPalace.get(k) ?? []), topic]);
}

const index: Record<string, Array<[string, string]>> = {};
const count = (key: string, pred: (k: string, b: string) => boolean) => (index[key] ?? []).filter(([k, b]) => pred(k, b)).length;

// 出生年月日時以固定種子的亂數序列取（確定性）：同一組合的樣本落在不同年干、月時組合也不同，
// 依年干（四化）、月（左輔右弼）、時（文昌文曲）排的星不易剛好都同宮而被誤當成通用內容
const rand = mulberry32(20261026);
const parse = (k: string) => { const [y, m, , h] = k.split('-').map(Number); return { y, m, h }; };
let charts = 0;
while (charts < MAX_CHARTS) {
  const y = YEARS[rand(YEARS.length)];
  const m = 1 + rand(12);
  const d = 1 + rand(28);
  const h = rand(12);
  const male = generateChart({ year: y, month: m, day: d, hour: h, gender: 'male' });
  const female = generateChart({ year: y, month: m, day: d, hour: h, gender: 'female' });
  charts += 2;
  for (const p of male.palaces) {
    const majors = p.stars.filter((s) => s.type === 'major');
    if (majors.length !== 1) continue;
    const fp = female.palaces.find((x) => x.branch === p.branch);
    const fMajors = fp?.stars.filter((s) => s.type === 'major') ?? [];
    if (fMajors.length !== 1 || fMajors[0].name !== majors[0].name) continue;
    const star = majors[0];
    const bucket = star.brightness ?? 'normal';
    for (const topic of topicsByPalace.get(norm(p.name)) ?? []) {
      const key = `${star.name}|${topic}`;
      const list = index[key] ?? [];
      if (list.length + 2 > TARGET) continue;
      if (count(key, (_, b) => b === bucket) + 2 > PER_BUCKET) continue;
      // 出生年不同（年干四化、年系星不重複）；月與時辰不同時相同（命宮與月系、時系星的落點不重複）
      if (list.some(([k]) => { const x = parse(k); return x.y === y || (x.m === m && x.h === h); })) continue;
      (index[key] ??= []).push(
        [formatDatasetKey(y, m, d, h, 'male'), bucket],
        [formatDatasetKey(y, m, d, h, 'female'), bucket],
      );
    }
  }
  if (Object.keys(index).length >= 14 * 13 && Object.values(index).every((v) => v.length >= TARGET)) break;
}

const sorted = Object.fromEntries(Object.keys(index).sort().map((k) => [k, index[k]]));
writeFileSync(OUT, JSON.stringify(sorted) + '\n');
const counts = Object.values(index).map((v) => v.length);
console.log(`[knowledge] 掃描 ${charts} 張盤，${Object.keys(index).length} 個主星×領域，每組樣本 ${Math.min(...counts)}–${Math.max(...counts)} 張 → ${OUT}`);
