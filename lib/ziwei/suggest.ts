/**
 * AI 依本盤出題：組提示詞（命主資訊＋該領域宮位與三方四正）、解析回覆、驗證題目。
 * 驗證會剔除「四化或星曜落宮與本盤不符」以及與命主現況／年齡矛盾的題目，避免 AI 亂掰盤面。
 */
import { Converter } from 'opencc-js';
import type { Palace, ZiweiChart } from './types';
import { TOPIC_LABEL, TOPIC_PALACE_NAME, type TopicKey } from './db-analysis';
import { buildSubjectContext, describePalace, normPalace as norm, type ChartFacts } from './subject-context';
import { fitsProfile, type LifeProfile } from './profile';

const toCn = Converter({ from: 'tw', to: 'cn' });

export const SUGGEST_COUNT = 3;

const SUGGEST_SYSTEM = `你是紫微斗數（倪海廈《天紀》體系）解盤助理，任務是替命主想出「值得問 AI 的問題」。
規則：
- 只輸出 JSON 字串陣列，剛好 ${SUGGEST_COUNT} 個元素，不要任何其他文字或程式碼框。
- 每題繁體中文（台灣用語），以第一人稱「我」發問，18–30 字，以「？」結尾；要短，放在按鈕上一眼看完。
- 每題只點一個最關鍵的盤面特徵（某宮某星、某個四化、目前大限或今年流年），讓人一看就知道是針對這張盤，不是通用題；不要把好幾顆星、好幾個條件堆在同一題。
- 只能引用下方資料中實際存在的星曜、落宮與四化，不得編造或張冠李戴。
- 依命主性別、年齡與現況調整：不出與現況矛盾或不合年齡的題目（例如已婚不問正緣、年長且無子女不問何時生子、退休不問換工作）；有填「目前最關心」時優先貼近。
- ${SUGGEST_COUNT} 題角度要不同（例如一題問時機、一題問做法、一題問風險）。
- 不問醫療診斷、具體投資標的、壽命生死。`;

/** 領域主宮＋三方四正（命格／性格另加身宮） */
export function domainPalaceLines(chart: ZiweiChart, topic: TopicKey): string[] {
  const main = chart.palaces.find((p) => norm(p.name) === norm(TOPIC_PALACE_NAME[topic]));
  if (!main) return [];
  const at = (offset: number) => chart.palaces.find((p) => p.branch === (main.branch + offset) % 12);
  const lines = [describePalace(main, '本宫 ')];
  const opp = at(6);
  if (opp) lines.push(describePalace(opp, '对宫 '));
  for (const o of [4, 8]) {
    const p = at(o);
    if (p) lines.push(describePalace(p, '三合 '));
  }
  if (topic === 'overview' || topic === 'personality') {
    const shen = chart.palaces.find((p) => p.branch === chart.shenGongBranch);
    if (shen && shen !== main) lines.push(describePalace(shen, '身宫所在 '));
  }
  return lines;
}

export function buildSuggestMessages(chart: ZiweiChart, topic: TopicKey, profile: LifeProfile | undefined, now = new Date()) {
  const user = [
    buildSubjectContext(chart, profile, now),
    '',
    `【本次領域】${TOPIC_LABEL[topic]}（主看${norm(TOPIC_PALACE_NAME[topic])}宮）`,
    ...domainPalaceLines(chart, topic),
    '',
    `請依上述資料出 ${SUGGEST_COUNT} 題。`,
  ].join('\n');
  return [
    { role: 'system' as const, content: SUGGEST_SYSTEM },
    { role: 'user' as const, content: user },
  ];
}

/** 解析模型回覆：優先 JSON 陣列，退而逐行拆 */
export function parseSuggestions(text: string): string[] {
  const s = text.indexOf('[');
  const e = text.lastIndexOf(']');
  if (s >= 0 && e > s) {
    try {
      const arr = JSON.parse(text.slice(s, e + 1));
      if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === 'string').map((x) => x.trim());
    } catch { /* 改逐行 */ }
  }
  return text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.、)）])\s*/, '').replace(/^["「『]|["」』,，]+$/g, '').trim())
    .filter(Boolean);
}

const PALACE_TOKENS = '命宫|父母|福德|田宅|官禄|仆役|交友|迁移|疾厄|财帛|子女|夫妻|兄弟';
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 剔除與本盤不符或不適合命主的題目，最多回傳 SUGGEST_COUNT 題。
 * 檢查：①「某星化X」須是本命／目前大限／今年流年的四化（題目指明時間層就只比該層） ②「某宮＋某星」相鄰描述須真的同宮（空宮可借對宮）
 * ③ 不與現況、年齡矛盾（fitsProfile）。
 */
export function validateSuggestions(
  questions: string[],
  chart: ZiweiChart,
  facts: ChartFacts,
  ctx: { profile?: LifeProfile },
): string[] {
  const starNames = Array.from(new Set(chart.palaces.flatMap((p) => p.stars.map((s) => s.name))))
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join('|');
  // 四化分時間層：題目寫「今年／流年」只比流年、「大限」只比大限、「本命／生年」只比本命，沒寫就任一層皆可
  const layers = { natal: facts.natalSiHua, daxian: facts.daxian?.siHua ?? {}, liunian: facts.liunian.siHua };
  const huaOk = (text: string, at: number, star: string, hua: string) => {
    const before = text.slice(Math.max(0, at - 8), at);
    const pick = /今年|流年/.test(before) ? [layers.liunian]
      : /大限|这十年|这个大运/.test(before) ? [layers.daxian]
      : /本命|生年|原局/.test(before) ? [layers.natal]
      : [layers.natal, layers.daxian, layers.liunian];
    return pick.some((m) => m[star] === hua);
  };
  const palaceOf = (token: string) => {
    const name = token === '交友' ? '仆役' : token;
    return chart.palaces.find((p) => norm(p.name) === norm(name));
  };
  const inPalace = (star: string, token: string) => {
    const p = palaceOf(token);
    if (!p) return true; // 認不出的宮名不判
    return p.stars.some((s) => s.name === star) || (!!p.isEmpty && !!p.borrowedStars?.includes(star));
  };

  const huaRe = new RegExp(`(${starNames})化([禄权科忌])`, 'g');
  const palaceStarRe = new RegExp(`(${PALACE_TOKENS})宫?(?:的主星是?|主星是?|坐守的?|的|有|见|里|内|中|是|坐)?(${starNames})`, 'g');
  const starPalaceRe = new RegExp(`(${starNames})(?:化[禄权科忌])?(?:坐守|坐|在|落|入|守|居)(?:于|在)?(${PALACE_TOKENS})`, 'g');

  const out: string[] = [];
  for (const raw of questions) {
    let q = raw.trim().replace(/\?$/, '？');
    if (q.length < 6 || q.length > 45) continue;
    if (!/[？]$/.test(q)) q += '？';
    const cn = toCn(q);
    const badHua = [...cn.matchAll(huaRe)].some((m) => !huaOk(cn, m.index ?? 0, m[1], m[2]));
    const badPalace =
      [...cn.matchAll(palaceStarRe)].some((m) => !inPalace(m[2], m[1])) ||
      [...cn.matchAll(starPalaceRe)].some((m) => !inPalace(m[1], m[2]));
    if (badHua || badPalace) continue;
    if (!fitsProfile(q, { profile: ctx.profile, age: facts.ages.real })) continue;
    if (!out.includes(q)) out.push(q);
    if (out.length >= SUGGEST_COUNT) break;
  }
  return out;
}
