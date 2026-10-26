/**
 * 從多張樣本盤的斷語歸納「主星 × 宮位」的通用論斷（純函式，無 I/O）。
 *
 * 斷語庫每張盤的某領域文字 = 這顆星坐這宮的通用論斷 + 該盤專屬內容（關鍵推導、同宮其他星的古籍條目、
 * 亮度句、依該盤四化接在段尾的句子等）。做法：以「句」為單位比對，多數樣本都有的句子視為通用；
 * 「關鍵推導」「特殊格局識別」整塊是該盤推導，
 * 直接略過；只在某一種亮度的樣本裡出現的行，先挑出來另列為亮度差異，不算進通用論斷。
 * 男命／女命的論斷常不同（如夫妻宮），呼叫端應男女分開傳入樣本。
 */

export type Brightness = 'bright' | 'normal' | 'dim';

export interface KnowledgeSections {
  /** 白話總覽（各領域第一段，如「命格总览」「财运总览」）；會隨亮度不同，取樣本最多的亮度 */
  zonglan: string;
  zonglanBucket?: Brightness;
  dingdiao: string;
  lundian: string;
  yiju: string;
  chuchu: string;
  /** 只在某種亮度出現的核心論斷句 */
  brightness: Partial<Record<Brightness, string[]>>;
  /** 歸納用了幾張盤、各亮度幾張 */
  samples: Partial<Record<Brightness, number>>;
}

export interface KnowledgeSample {
  text: string;
  bucket: Brightness;
}

const FIELD_BY_SECTION: Record<string, keyof Pick<KnowledgeSections, 'dingdiao' | 'lundian' | 'yiju' | 'chuchu'>> = {
  '一句话定调': 'dingdiao',
  '核心论断': 'lundian',
  '命盘依据': 'yiju',
  '经典出处': 'chuchu',
};

/** 依 **【段名】** 切段 */
export function splitSections(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = text.split(/\*\*【([^】]+)】\*\*/);
  for (let i = 1; i < parts.length; i += 2) {
    if (!out.has(parts[i])) out.set(parts[i], parts[i + 1] ?? '');
  }
  return out;
}

/**
 * 去掉明確屬於該盤的區塊：核心論斷的「關鍵推導」以下（該盤推導過程）、
 * 命盤依據的「特殊格局識別」（依年干、同宮星而定的格局清單）、
 * 經典出處裡同宮其他星的《全書》卷二條目（「卷二·某宮》X条」，X 不是本頁主星）。
 */
function stripChartSpecific(name: string, body: string, star?: string): string {
  if (name === '经典出处' && star) {
    return body
      .split('\n')
      .filter((l) => { const m = /卷二·[^》]*》([\u4e00-\u9fff]{2})条/.exec(l); return !m || m[1] === star; })
      .join('\n');
  }
  if (name === '核心论断') {
    const i = body.indexOf('**关键推导**');
    return i >= 0 ? body.slice(0, i) : body;
  }
  if (name === '命盘依据') {
    const lines = body.split('\n');
    const out: string[] = [];
    let skipping = false;
    for (const l of lines) {
      if (l.trim().startsWith('▍') && l.includes('特殊格局识别')) { skipping = true; continue; }
      if (skipping && l.trim().startsWith('▍')) skipping = false;
      if (!skipping) out.push(l);
    }
    return out.join('\n');
  }
  return body;
}

const OPEN = '「『（(〔【《“‘';
const CLOSE = '」』）)〕】》”’';

/** 一行切成句子（句號、驚嘆號、問號後切開，保留標點；引號、括號內的句號不切）；比對以句為單位 */
export function sentences(line: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of line) {
    cur += ch;
    if (OPEN.includes(ch)) depth++;
    else if (CLOSE.includes(ch)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && '。！？'.includes(ch)) { out.push(cur); cur = ''; }
  }
  if (cur) out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** 描述主星亮度狀態的句子（如「天府庙旺，……」「武曲入庙……」「七杀落陷……」） */
const BRIGHTNESS_SENTENCE = /^[\u4e00-\u9fff]{2}(入庙|庙旺|居庙|居旺|旺地|入旺|落陷|陷地|居陷|得地|利地|平和)/;
const unitsOf = (body: string) => new Set(body.split('\n').flatMap(sentences));

/** 多數樣本（≥ minShare）都有的句子（排除 exclude）；以涵蓋最多通用句的樣本為底，保留原本順序、分行與段落空行 */
function consensus(bodies: string[], minShare: number, exclude: Set<string> = new Set()): { text: string; kept: Set<string> } {
  const counts = new Map<string, number>();
  for (const b of bodies) for (const u of unitsOf(b)) counts.set(u, (counts.get(u) ?? 0) + 1);
  const need = Math.max(1, Math.ceil(bodies.length * minShare));
  const kept = new Set([...counts].filter(([u, c]) => c >= need && !exclude.has(u)).map(([u]) => u));
  let base = bodies[0] ?? '';
  let best = -1;
  for (const b of bodies) {
    const n = [...unitsOf(b)].filter((u) => kept.has(u)).length;
    if (n > best) { best = n; base = b; }
  }
  const text = base
    .split('\n')
    .map((l) => (l.trim() ? sentences(l).filter((u) => kept.has(u)).join('') : ''))
    .filter((l, i, arr) => l || (i > 0 && arr[i - 1]))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, kept };
}

export function extractKnowledge(samples: KnowledgeSample[], minShare = 0.75, star?: string): KnowledgeSections {
  const out: KnowledgeSections = { zonglan: '', dingdiao: '', lundian: '', yiju: '', chuchu: '', brightness: {}, samples: {} };
  for (const s of samples) out.samples[s.bucket] = (out.samples[s.bucket] ?? 0) + 1;
  const split = samples.map((s) => ({ bucket: s.bucket, sections: splitSections(s.text) }));

  // 白話總覽：各領域第一段名稱以「总览」結尾；文字隨亮度不同，取樣本最多的那種亮度歸納
  const zl = split
    .map((s) => ({ bucket: s.bucket, body: [...s.sections].find(([name]) => name.endsWith('总览'))?.[1] }))
    .filter((s): s is { bucket: Brightness; body: string } => !!s.body);
  if (zl.length) {
    const byBucket = new Map<Brightness, string[]>();
    for (const s of zl) byBucket.set(s.bucket, [...(byBucket.get(s.bucket) ?? []), s.body]);
    const [bucket, bodies] = [...byBucket].sort((a, b) => b[1].length - a[1].length)[0];
    out.zonglan = consensus(bodies, minShare).text;
    if (byBucket.size > 1) out.zonglanBucket = bucket;
  }

  for (const [name, field] of Object.entries(FIELD_BY_SECTION)) {
    const withSec = split
      .map((s) => ({ bucket: s.bucket, body: s.sections.has(name) ? stripChartSpecific(name, s.sections.get(name)!, star) : null }))
      .filter((s): s is { bucket: Brightness; body: string } => s.body !== null);
    if (!withSec.length) continue;
    // 先挑出亮度專屬句（核心論斷、命盤依據），不算進通用論斷，另列亮度差異
    const byBrightness = name === '核心论断' || name === '命盘依据' ? brightnessLines(withSec) : new Map<Brightness, string[]>();
    const exclude = new Set([...byBrightness.values()].flat());
    out[field] = consensus(withSec.map((s) => s.body), minShare, exclude).text;
    for (const [b, lines] of byBrightness) out.brightness[b] = [...(out.brightness[b] ?? []), ...lines];
  }
  return out;
}

/**
 * 亮度專屬句：
 * ① 樣本有多種亮度時，在某亮度的樣本裡幾乎都有（≥75%）、在其他亮度幾乎沒有（≤25%）的句子（該亮度至少 2 張才判斷）；
 * ② 不論幾種亮度，以「主星＋廟旺／落陷等字樣」開頭、且過半樣本都有的句子（亮度只有一種時無從比較，
 *    或斷語庫自己的亮度分法與排盤引擎不同時），歸到出現比例最高的那種亮度。
 */
function brightnessLines(withSec: { bucket: Brightness; body: string }[]): Map<Brightness, string[]> {
  const out = new Map<Brightness, string[]>();
  const add = (b: Brightness, u: string) => { if (![...out.values()].flat().includes(u)) out.set(b, [...(out.get(b) ?? []), u]); };
  const buckets = [...new Set(withSec.map((s) => s.bucket))];
  const units = new Map(withSec.map((s) => [s, unitsOf(s.body)]));
  const share = (group: typeof withSec, u: string) => (group.length ? group.filter((s) => units.get(s)!.has(u)).length / group.length : 0);

  if (buckets.length >= 2) {
    for (const b of buckets) {
      const inB = withSec.filter((s) => s.bucket === b);
      const outB = withSec.filter((s) => s.bucket !== b);
      if (inB.length < 2) continue;
      for (const u of units.get(inB[0])!) {
        if (share(inB, u) >= 0.75 && share(outB, u) <= 0.25) add(b, u);
      }
    }
  }
  const all = new Set(withSec.flatMap((s) => [...units.get(s)!]));
  for (const u of all) {
    if (!BRIGHTNESS_SENTENCE.test(u) || share(withSec, u) < 0.5) continue;
    const best = buckets
      .map((b) => [b, share(withSec.filter((s) => s.bucket === b), u)] as const)
      .sort((x, y) => y[1] - x[1])[0][0];
    add(best, u);
  }
  return out;
}
