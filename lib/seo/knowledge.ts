/**
 * 知识页数据 helper
 *
 * 14 主星 × 13 topic = 182 个页面。论断来自压缩断语库（data/ziwei-v4.sqlite，SQLite＋Zstd）：
 * 每个「主星 × 领域」取 lib/seo/knowledge-samples.json 列出的样本盘（该宫只有这颗主星），
 * 读出该领域断语后归纳共同段落（lib/seo/knowledge-extract.ts）。男命／女命分开归纳（样本成对）。结果在进程内快取。
 * 样本索引由 scripts/knowledge/build-sample-index.ts 产生。
 */
import type { TopicKey } from '@/lib/ziwei/db-analysis';
import { TOPIC_PALACE_NAME, TOPIC_LABEL } from '@/lib/ziwei/db-analysis';
import { lookupFromSqlite, parseDatasetKey } from '@/lib/ziwei-dataset';
import { extractKnowledge, type Brightness, type KnowledgeSample, type KnowledgeSections } from './knowledge-extract';
import SAMPLE_INDEX from './knowledge-samples.json';

export const ALL_STARS = [
  '紫微', '天机', '太阳', '武曲', '天同', '廉贞', '天府',
  '太阴', '贪狼', '巨门', '天相', '天梁', '七杀', '破军',
];

// 主星名 ↔ 拼音 slug 映射（URL 用 slug，避免中文 URL 在 Vercel/CDN 上的边界问题）
export const STAR_TO_SLUG: Record<string, string> = {
  '紫微': 'ziwei',
  '天机': 'tianji',
  '太阳': 'taiyang',
  '武曲': 'wuqu',
  '天同': 'tiantong',
  '廉贞': 'lianzhen',
  '天府': 'tianfu',
  '太阴': 'taiyin',
  '贪狼': 'tanlang',
  '巨门': 'jumen',
  '天相': 'tianxiang',
  '天梁': 'tianliang',
  '七杀': 'qisha',
  '破军': 'pojun',
};

export const SLUG_TO_STAR: Record<string, string> = Object.fromEntries(
  Object.entries(STAR_TO_SLUG).map(([k, v]) => [v, k])
);

export const ALL_TOPICS: TopicKey[] = [
  'overview', 'personality', 'love', 'career', 'wealth', 'health',
  'family', 'children', 'move', 'friends', 'home', 'spirit', 'parents',
];

const SAMPLES = SAMPLE_INDEX as unknown as Record<string, Array<[string, string]>>;
/** 样本（男女合计）少于这个数就不出页面；男命／女命各自至少 2 张才归纳 */
const MIN_SAMPLES = 4;

export type Gender = 'male' | 'female';

export interface KnowledgeData {
  star: string;
  topic: TopicKey;
  gender: Gender;
  topicLabel: string;
  palaceName: string;
  parsed: KnowledgeSections;
  exists: boolean;
}

/** 有没有这一页（只看样本索引，不读资料库；列表、sitemap 用） */
export function hasKnowledge(star: string, topic: TopicKey): boolean {
  return (SAMPLES[`${star}|${topic}`]?.length ?? 0) >= MIN_SAMPLES;
}

const cache = new Map<string, KnowledgeData>();

export function getKnowledge(star: string, topic: TopicKey, gender: Gender = 'male'): KnowledgeData {
  const key = `${star}|${topic}`;
  const hit = cache.get(`${key}|${gender}`);
  if (hit) return hit;
  const samples: KnowledgeSample[] = [];
  // 只用同性別的樣本（論斷常分男命／女命，不混合）
  const mine = hasKnowledge(star, topic) ? SAMPLES[key].filter(([k]) => k.endsWith(`-${gender}`)) : [];
  for (const [k, bucket] of mine) {
    const parts = parseDatasetKey(k);
    let text: string | undefined;
    try {
      text = parts ? lookupFromSqlite(parts)?.c?.[topic] : undefined;
    } catch { /* 資料庫讀取異常：當作這張樣本讀不到 */ }
    if (text) samples.push({ text, bucket: bucket as Brightness });
  }
  const parsed = extractKnowledge(samples, undefined, star);
  const data: KnowledgeData = {
    star,
    topic,
    gender,
    topicLabel: TOPIC_LABEL[topic],
    palaceName: TOPIC_PALACE_NAME[topic].replace(/宫$/, ''), // 页面模板会自己加「宫」（命宫原本带宫字，会变成「命宫宫」）
    parsed,
    exists: samples.length >= 2 && Boolean(parsed.dingdiao || parsed.lundian),
  };
  // 样本要全部读到才快取；资料库暂时读不到或只读到部分时不快取，下次请求再试
  if (mine.length && samples.length === mine.length) cache.set(`${key}|${gender}`, data);
  return data;
}

/** 所有有样本的 14×13 组合（sitemap 用） */
export function getAllKnowledgeRoutes() {
  const routes: { star: string; slug: string; topic: TopicKey }[] = [];
  for (const star of ALL_STARS) {
    for (const topic of ALL_TOPICS) {
      if (hasKnowledge(star, topic)) routes.push({ star, slug: STAR_TO_SLUG[star], topic });
    }
  }
  return routes;
}

/** 主星属性简介（用于 SEO 页"了解 XX 星"section） */
export const STAR_BRIEF_SEO: Record<string, string> = {
  '紫微': '紫微为帝星，主尊贵，化气为尊。落命主有领导气场、宜大平台高位。',
  '天机': '天机为智慧星，主善变机灵，化气为善。落命主聪明机变、宜辅佐策划。',
  '太阳': '太阳为男贵星，主名誉公务，化气为贵。落命主光明磊落、宜公职名声。',
  '武曲': '武曲为财星，主刚毅果决，化气为财。落命主理财能力强、宜实业金融。',
  '天同': '天同为福星，主温和享乐，化气为福。落命主性情温和、有福气。',
  '廉贞': '廉贞为次桃花星，文武兼备，化气为囚。落命主多才多艺、感情丰富。',
  '天府': '天府为南帝守财星，主稳重保守，化气为令。落命主品行端正、善守财库。',
  '太阴': '太阴为月亮富贵星，主田宅富贵，化气为富。落命主感情细腻、女命最吉。',
  '贪狼': '贪狼为桃花欲望星，多才多社交，化气为桃花。落命主多才艺、社交广。',
  '巨门': '巨门为是非口才星，主辩论传媒，化气为暗。落命主口才好、宜律师教师。',
  '天相': '天相为印星辅佐，主忠厚老实，化气为印。落命主品行端正、宜行政法务。',
  '天梁': '天梁为老人星荫星，善逢凶化吉，化气为荫。落命主慈悲善良、宜法律医学。',
  '七杀': '七杀为将星，主孤独果决冒险，化气为肃杀。落命主刚毅果决、宜军警创业。',
  '破军': '破军为破坏创新星，主六亲缘薄，化气为耗。落命主开创变动、宜技术专长。',
};
