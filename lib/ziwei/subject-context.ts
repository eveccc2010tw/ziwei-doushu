/**
 * 給 AI 的「命主資訊」：性別、實歲／虛歲、今天日期（台灣時間）、目前大限與今年流年的四化。
 * 命盤 JSON 雖含出生資料，但 AI 不知道今天幾號、也不會自己算年齡，故由這裡明確寫出。
 */
import { Solar } from 'lunar-javascript';
import { SI_HUA_TABLE, STEMS, BRANCHES } from './constants';
import type { Palace, ZiweiChart } from './types';
import { profilePromptLines, type LifeProfile } from './profile';

export interface YMD { y: number; m: number; d: number }

/** 四化代號順序同 SI_HUA_TABLE：禄、权、科、忌 */
const HUA = ['禄', '权', '科', '忌'] as const;

export function taipeiToday(now = new Date()): YMD {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

/** 實歲（足歲）與虛歲（農曆年口徑，與大限年齡同一套） */
export function calcAges(birth: YMD, birthLunarYear: number, today: YMD): { real: number; nominal: number } {
  const hadBirthday = today.m > birth.m || (today.m === birth.m && today.d >= birth.d);
  const real = today.y - birth.y - (hadBirthday ? 0 : 1);
  const todayLunarYear = Solar.fromYmd(today.y, today.m, today.d).getLunar().getYear();
  return { real, nominal: todayLunarYear - birthLunarYear + 1 };
}

function siHuaOf(stemIndex: number): Record<string, string> {
  const stars = SI_HUA_TABLE[stemIndex];
  if (!stars) return {};
  return Object.fromEntries(stars.map((s, i) => [s, HUA[i]]));
}

export interface ChartFacts {
  today: YMD;
  ages: { real: number; nominal: number };
  natalSiHua: Record<string, string>;
  daxian?: { startAge: number; endAge: number; palaceName: string; ganzhi: string; siHua: Record<string, string> };
  liunian: { ganzhi: string; siHua: Record<string, string> };
}

/** 從命盤＋今天推出 AI 需要的時間事實（大限以今天的虛歲重新判定，不信任 client 傳來的索引） */
export function chartFacts(chart: ZiweiChart, now = new Date()): ChartFacts {
  const today = taipeiToday(now);
  const { year, month, day, origInput } = chart.birthInfo;
  const birth = origInput ? { y: origInput.year, m: origInput.month, d: origInput.day } : { y: year, m: month, d: day };
  const ages = calcAges(birth, chart.lunarInfo.lunarYear, today);

  const natalSiHua: Record<string, string> = {};
  for (const p of chart.palaces) for (const s of p.stars) if (s.siHua) natalSiHua[s.name] = s.siHua;

  const dx = chart.daXians.find((d) => ages.nominal >= d.startAge && ages.nominal <= d.endAge);
  const dxPalace = dx && chart.palaces.find((p) => p.branch === dx.palaceBranch);
  const daxian = dx && dxPalace
    ? {
        startAge: dx.startAge, endAge: dx.endAge, palaceName: dx.palaceName,
        ganzhi: `${STEMS[dxPalace.stem]}${BRANCHES[dxPalace.branch]}`,
        siHua: siHuaOf(dxPalace.stem),
      }
    : undefined;

  const lunarToday = Solar.fromYmd(today.y, today.m, today.d).getLunar();
  const lnGanzhi = lunarToday.getYearGan() + lunarToday.getYearZhi();
  const liunian = { ganzhi: lnGanzhi, siHua: siHuaOf(STEMS.indexOf(lnGanzhi[0])) };

  return { today, ages, natalSiHua, daxian, liunian };
}

/** 宮名去掉「宫」字，方便比對（命宫／财帛 等寫法不一） */
export const normPalace = (name: string) => name.replace(/宫$/, '');

/** 一宮一行的盤面摘要：干支、主星（亮度）、其他星、生年四化、大限年齡 */
export function describePalace(p: Palace, role = ''): string {
  const majors = p.stars.filter((s) => s.type === 'major');
  const others = p.stars.filter((s) => s.type !== 'major').map((s) => s.name);
  const hua = p.stars.filter((s) => s.siHua).map((s) => `${s.name}化${s.siHua}`);
  const main = majors.length
    ? majors.map((s) => `${s.name}${s.brightnessRaw ? `（${s.brightnessRaw}）` : ''}`).join('、')
    : `空宫${p.borrowedStars?.length ? `（借对宫：${p.borrowedStars.join('、')}）` : ''}`;
  return `- ${role}${normPalace(p.name)}宫（${STEMS[p.stem]}${BRANCHES[p.branch]}）：主星 ${main}；其他 ${others.join('、') || '无'}；生年四化 ${hua.join('、') || '无'}${p.daXianAge ? `；大限 ${p.daXianAge[0]}–${p.daXianAge[1]} 岁` : ''}`;
}

/** 十二宮摘要（解讀時給 AI 直接照讀，避免它從 JSON 自行換算地支出錯） */
export function palaceSummary(chart: ZiweiChart): string {
  return ['【十二宮摘要】（宮位干支與星曜以此為準）', ...chart.palaces.map((p) => describePalace(p))].join('\n');
}

/** 陽曆出生：有原始輸入就印使用者填的日期時間；子時換日時另註排盤日 */
function birthText(chart: ZiweiChart): string {
  const { year, month, day, origInput: o } = chart.birthInfo;
  const chartDay = `${year}-${pad(month)}-${pad(day)}`;
  if (!o) return chartDay;
  const typed = `${o.year}-${pad(o.month)}-${pad(o.day)} ${pad(o.clockHour)}:${pad(o.clockMinute)}`;
  return o.year === year && o.month === month && o.day === day ? typed : `${typed}（子時換日，排盤日 ${chartDay}）`;
}

const huaText = (m: Record<string, string>) => Object.entries(m).map(([s, h]) => `${s}化${h}`).join('、');
const pad = (n: number) => String(n).padStart(2, '0');

/** 命主基本資訊段（合盤時每張盤各一段，title 用來標示盤A／盤B） */
export function buildSubjectBasics(chart: ZiweiChart, now = new Date(), title = '命主資訊'): string {
  const f = chartFacts(chart, now);
  const bi = chart.birthInfo;
  const gender = bi.gender === 'male' ? '男' : '女';
  return [
    `【${title}】（年齡、今年、目前大限一律以此為準）`,
    `- 性別：${gender}${chart.yinYangGender ? `（${chart.yinYangGender}）` : ''}`,
    `- 出生：陽曆 ${birthText(chart)} ${BRANCHES[bi.hour]}時；農曆 ${chart.lunarInfo.lunarYear} 年${chart.lunarInfo.isLeapMonth ? '閏' : ''}${Math.abs(chart.lunarInfo.lunarMonth)}月${chart.lunarInfo.lunarDay}日`,
    `- 今天（台灣時間）：${f.today.y}-${pad(f.today.m)}-${pad(f.today.d)}`,
    `- 年齡：實歲 ${f.ages.real} 歲、虛歲 ${f.ages.nominal} 歲`,
    f.daxian
      ? `- 目前大限：${f.daxian.startAge}–${f.daxian.endAge} 歲，${f.daxian.palaceName}宮（${f.daxian.ganzhi}），大限四化：${huaText(f.daxian.siHua)}；含今年還有 ${f.daxian.endAge - f.ages.nominal + 1} 年`
      : '- 目前大限：不在已排大限範圍內',
    `- 今年流年：${f.liunian.ganzhi}年，流年四化：${huaText(f.liunian.siHua)}`,
  ].join('\n');
}

/** 單盤解讀／出題用：命主資訊＋現況段 */
export function buildSubjectContext(chart: ZiweiChart, profile: LifeProfile | undefined, now = new Date()): string {
  const profileLines = profilePromptLines(profile);
  return [
    buildSubjectBasics(chart, now),
    '',
    profileLines.length
      ? '【命主現況】（使用者選填；只能用在「對照你的現況」段與調整建議，不得用來推論或修正盤面）'
      : '【命主現況】未提供',
    ...profileLines,
  ].join('\n');
}
