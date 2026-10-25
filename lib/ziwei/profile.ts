/**
 * 命主現況（選填）：排盤表單或命盤頁「👤 現況」填寫，送給 AI 用來調整建議與出題。
 * 全部欄位都是選項（enum）——server 端只認得下列代碼、自行換成文字，不把使用者輸入原樣塞進提示詞。
 * 金額只收區間，不收實際數字；資產分房地產（對照田宅宮）與現金＋股票（對照財帛宮）。
 */

export const RELATIONSHIP_OPTIONS = [
  ['single', '單身'],
  ['dating', '交往中'],
  ['married', '已婚'],
  ['separated', '離婚／分居'],
  ['widowed', '喪偶'],
] as const;

export const OCCUPATION_OPTIONS = [
  ['employee', '上班族'],
  ['manager', '主管／管理職'],
  ['civil', '公務員／教職'],
  ['professional', '專業人士（醫師、律師、會計師、工程師等）'],
  ['sales', '業務／銷售'],
  ['service', '服務業'],
  ['technical', '技術／製造'],
  ['owner', '自營／老闆'],
  ['freelance', '自由業／接案'],
  ['student', '學生'],
  ['unemployed', '待業中'],
  ['retired', '退休'],
  ['homemaker', '家管'],
  ['other', '其他'],
] as const;

export const CHILDREN_OPTIONS = [
  ['none', '無'],
  ['has', '有'],
] as const;

export const INCOME_OPTIONS = [
  ['lt50', '50 萬以下'],
  ['50to100', '50–100 萬'],
  ['100to200', '100–200 萬'],
  ['200to500', '200–500 萬'],
  ['500to1000', '500–1000 萬'],
  ['gt1000', '1000 萬以上'],
] as const;

/** 改版前的年收入級距：讀回舊資料時保留（不丟值），選單上提示重選 */
export const INCOME_LEGACY_OPTIONS = [
  ['gt500', '500 萬以上'],
] as const;

/** 資產級距（單位：萬元），房地產與現金＋股票共用 */
export const ASSET_OPTIONS = [
  ['none', '無'],
  ['lt100', '100 萬以內'],
  ['100to500', '100–500 萬'],
  ['500to1000', '500–1000 萬'],
  ['1000to5000', '1000–5000 萬'],
  ['5000to10000', '5000 萬–1 億'],
  ['10000to30000', '1–3 億'],
  ['gt30000', '3 億以上'],
] as const;

export const CONCERN_OPTIONS = [
  ['love', '感情'],
  ['career', '事業'],
  ['wealth', '財運'],
  ['health', '健康'],
  ['family', '家庭'],
  ['children', '子女'],
  ['study', '學業考試'],
  ['property', '置產搬家'],
  ['social', '人際'],
] as const;

type Code<T extends ReadonlyArray<readonly [string, string]>> = T[number][0];

export interface LifeProfile {
  relationship?: Code<typeof RELATIONSHIP_OPTIONS>;
  occupation?: Code<typeof OCCUPATION_OPTIONS>;
  children?: Code<typeof CHILDREN_OPTIONS>;
  income?: Code<typeof INCOME_OPTIONS> | Code<typeof INCOME_LEGACY_OPTIONS>;
  realEstate?: Code<typeof ASSET_OPTIONS>;
  liquidAssets?: Code<typeof ASSET_OPTIONS>;
  concerns?: Code<typeof CONCERN_OPTIONS>[];
}

function labelOf(options: ReadonlyArray<readonly [string, string]>, code: string | undefined): string | undefined {
  return options.find(([c]) => c === code)?.[1];
}

function pick<T extends string>(options: ReadonlyArray<readonly [string, string]>, raw: unknown): T | undefined {
  return typeof raw === 'string' && options.some(([c]) => c === raw) ? (raw as T) : undefined;
}

/** 只留下合法代碼；全空回 undefined。client 讀案件／歷史、server 收請求都先過這裡 */
export function sanitizeProfile(raw: unknown): LifeProfile | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const concerns = Array.isArray(r.concerns)
    ? Array.from(new Set(r.concerns.filter((c): c is string => typeof c === 'string' && CONCERN_OPTIONS.some(([k]) => k === c))))
    : [];
  const p: LifeProfile = {
    relationship: pick(RELATIONSHIP_OPTIONS, r.relationship),
    occupation: pick(OCCUPATION_OPTIONS, r.occupation),
    children: pick(CHILDREN_OPTIONS, r.children),
    income: pick([...INCOME_OPTIONS, ...INCOME_LEGACY_OPTIONS], r.income),
    realEstate: pick(ASSET_OPTIONS, r.realEstate),
    liquidAssets: pick(ASSET_OPTIONS, r.liquidAssets),
    concerns: concerns.length ? (concerns as LifeProfile['concerns']) : undefined,
  };
  for (const k of Object.keys(p) as (keyof LifeProfile)[]) if (p[k] === undefined) delete p[k];
  return Object.keys(p).length ? p : undefined;
}

/** 顯示／提示詞用的文字清單，例：['已婚', '公務員／教職', '有子女', '年收入 100–200 萬', '關心：財運、健康'] */
export function profileSummary(p: LifeProfile | undefined): string[] {
  if (!p) return [];
  const out: string[] = [];
  const rel = labelOf(RELATIONSHIP_OPTIONS, p.relationship);
  if (rel) out.push(rel);
  const occ = labelOf(OCCUPATION_OPTIONS, p.occupation);
  if (occ) out.push(occ);
  if (p.children) out.push(p.children === 'has' ? '有子女' : '無子女');
  const income = labelOf([...INCOME_OPTIONS, ...INCOME_LEGACY_OPTIONS], p.income);
  if (income) out.push(`年收入 ${income}`);
  const realEstate = labelOf(ASSET_OPTIONS, p.realEstate);
  if (realEstate) out.push(`房地產 ${realEstate}`);
  const liquid = labelOf(ASSET_OPTIONS, p.liquidAssets);
  if (liquid) out.push(`現金＋股票 ${liquid}`);
  if (p.concerns?.length) out.push(`關心：${p.concerns.map((c) => labelOf(CONCERN_OPTIONS, c)).join('、')}`);
  return out;
}

/** 給 AI 的現況段（逐欄列出，未填的不列） */
export function profilePromptLines(p: LifeProfile | undefined): string[] {
  if (!p) return [];
  const lines: string[] = [];
  const add = (k: string, v: string | undefined) => { if (v) lines.push(`- ${k}：${v}`); };
  add('感情狀態', labelOf(RELATIONSHIP_OPTIONS, p.relationship));
  add('職業', labelOf(OCCUPATION_OPTIONS, p.occupation));
  add('子女', labelOf(CHILDREN_OPTIONS, p.children));
  add('年收入（新台幣，區間）', labelOf([...INCOME_OPTIONS, ...INCOME_LEGACY_OPTIONS], p.income));
  add('房地產（新台幣，區間；對照田宅宮）', labelOf(ASSET_OPTIONS, p.realEstate));
  add('現金＋股票（新台幣，區間；對照財帛宮）', labelOf(ASSET_OPTIONS, p.liquidAssets));
  add('目前最關心', p.concerns?.map((c) => labelOf(CONCERN_OPTIONS, c)).join('、'));
  return lines;
}

/** 題目是否適合這位命主（預設題與 AI 出的題都套用）：與現況矛盾或不合年齡的題目剔除 */
export function fitsProfile(question: string, ctx: { profile?: LifeProfile; age?: number }): boolean {
  const { profile: p, age } = ctx;
  const rules: Array<[boolean, RegExp]> = [
    [p?.relationship === 'married', /正緣|脫單|晚婚|何時結婚|幾歲結婚|什麼時候結婚/],
    [p?.relationship === 'single' || p?.relationship === 'separated' || p?.relationship === 'widowed', /目前的感情/],
    [p?.children === 'has', /孩子什麼時候來|何時(會)?有(小孩|孩子)/],
    [p?.children === 'none' && (age ?? 0) >= 50, /孩子什麼時候來|何時(會)?有(小孩|孩子)|懷孕|生育/],
    [p?.occupation === 'retired' || p?.occupation === 'student' || p?.occupation === 'unemployed', /換工作|跳槽/],
    [p?.occupation === 'retired' || p?.occupation === 'owner', /主管或老闆/],
    [(age ?? 0) >= 30 && p?.occupation !== 'student' && !p?.concerns?.includes('study'), /讀書考試/],
  ];
  return !rules.some(([active, re]) => active && re.test(question));
}
