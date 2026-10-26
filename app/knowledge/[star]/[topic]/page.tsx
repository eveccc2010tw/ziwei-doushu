/**
 * /knowledge/[star]/[topic] — 主星 × 宫位知识页
 *
 * 14 主星 × 13 topic = 182 个独立 URL
 * 内容即时由压缩断语库（SQLite＋Zstd）归纳：白话总览／一句话定调／核心论断／命盘依据／经典出处（lib/seo/knowledge.ts）
 *
 * SEO 要点：
 *  - title 含主关键词（如"紫微入命宫·倪海厦体系详解"）
 *  - description 用 dingdiao（一句话定调）
 *  - JSON-LD Article 结构化数据
 *  - 内链：同主星其他 12 宫 + 同宫其他 13 主星
 *  - generateStaticParams 静态生成，零运行时开销
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { TopicKey } from '@/lib/ziwei/db-analysis';
import {
  ALL_STARS,
  ALL_TOPICS,
  getKnowledge,
  hasKnowledge,
  type Gender,
  STAR_BRIEF_SEO,
  STAR_TO_SLUG,
  SLUG_TO_STAR,
} from '@/lib/seo/knowledge';
import { SITE_URL } from '@/lib/site';
import { TOPIC_PALACE_NAME } from '@/lib/ziwei/db-analysis';
import type { Brightness } from '@/lib/seo/knowledge-extract';

/** ?g=female 才是女命；重複參數取第一個 */
function genderOf(g: string | string[] | undefined): Gender {
  return (Array.isArray(g) ? g[0] : g) === 'female' ? 'female' : 'male';
}

const BRIGHTNESS_LABEL: Record<Brightness, string> = { bright: '庙旺', normal: '平', dim: '落陷' };

/** 断语文字：保留换行，**粗体** 转成 strong */
function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => (
        <span key={i}>
          {line.split(/\*\*(.+?)\*\*/).map((part, j) => (j % 2 ? <strong key={j}>{part}</strong> : part))}
          {'\n'}
        </span>
      ))}
    </>
  );
}

// 内容要读压缩断语库（server 端 SQLite），按请求渲染；归纳结果在进程内快取
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params, searchParams,
}: { params: Promise<{ star: string; topic: string }>; searchParams: Promise<{ g?: string | string[] }> }) {
  const { star: slug, topic } = await params;
  const star = SLUG_TO_STAR[slug];
  if (!star) return {};
  const gender = genderOf((await searchParams).g);
  const data = getKnowledge(star, topic as TopicKey, gender);
  if (!data.exists) return {};

  const title = `${star}入${data.palaceName}宫 · ${data.topicLabel}（${gender === 'female' ? '女命' : '男命'}） · 倪海厦体系详解`;
  const description = data.parsed.dingdiao
    || `${star}入${data.palaceName}宫的紫微斗数解读 — 基于倪海厦《天纪》体系与古籍《紫微斗数全集》《骨髓赋》。`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'article',
      url: `${SITE_URL}/knowledge/${slug}/${topic}`,
    },
    alternates: {
      canonical: `${SITE_URL}/knowledge/${slug}/${topic}`,
    },
    keywords: [
      '紫微斗数', '倪海厦', star, data.palaceName, data.topicLabel,
      `${star}${data.palaceName}`, `${star}入${data.palaceName}`,
      `紫微斗数 ${star}`, '倪海厦紫微斗数', '紫微斗数全集',
    ],
  };
}

export default async function KnowledgePage({
  params, searchParams,
}: { params: Promise<{ star: string; topic: string }>; searchParams: Promise<{ g?: string | string[] }> }) {
  const { star: slug, topic } = await params;
  const star = SLUG_TO_STAR[slug];
  if (!star) notFound();
  // 论断常分男命／女命（如夫妻宫），以 ?g=female 切换，默认男命
  const gender = genderOf((await searchParams).g);
  const gq = gender === 'female' ? '?g=female' : '';
  const data = getKnowledge(star, topic as TopicKey, gender);
  if (!data.exists) notFound();

  // 同主星其他 topic、同 topic 其他主星（只看样本索引，不读资料库）
  const otherTopicsForStar = ALL_TOPICS.filter(t => t !== topic && hasKnowledge(star, t));
  const otherStarsForTopic = ALL_STARS.filter(s => s !== star && hasKnowledge(s, topic as TopicKey));
  const sampleNote = (Object.entries(data.parsed.samples) as [Brightness, number][])
    .map(([b, n]) => `${BRIGHTNESS_LABEL[b]} ${n}`).join('、');

  // JSON-LD
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: `${star}入${data.palaceName}宫 · ${data.topicLabel}`,
    description: data.parsed.dingdiao,
    author: { '@type': 'Organization', name: '紫微研究 · 倪海厦正宗' },
    publisher: {
      '@type': 'Organization',
      name: '紫微研究',
      url: SITE_URL,
    },
    datePublished: '2026-04-28',
    dateModified: '2026-04-28',
    mainEntityOfPage: `${SITE_URL}/knowledge/${slug}/${topic}`,
    articleSection: '紫微斗数 · 倪海厦体系',
    keywords: [`紫微斗数`, star, data.palaceName, data.topicLabel].join(', '),
  };

  return (
    <div style={{ background: 'var(--bg-page)', minHeight: '100vh' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* 顶栏 */}
      <div className="px-6 py-4 flex items-center justify-between"
        style={{ borderBottom: '1px solid rgba(184,146,42,0.15)', background: 'var(--bg-page)' }}>
        <Link href="/" style={{ fontSize: '12px', color: 'var(--ac)', letterSpacing: '0.3em', textDecoration: 'none' }}>
          ← 首页
        </Link>
        <div style={{ fontSize: '12px', color: 'var(--tx-3)', letterSpacing: '0.2em' }}>
          倪师方法论 · 知识库
        </div>
        <Link href="/chart" style={{ fontSize: '12px', color: 'var(--ac)', letterSpacing: '0.2em', textDecoration: 'none' }}>
          起盘 →
        </Link>
      </div>

      <article className="max-w-3xl mx-auto px-6 py-12">
        {/* 面包屑 */}
        <nav style={{ fontSize: '11px', color: 'var(--tx-3)', letterSpacing: '0.1em', marginBottom: '16px' }}>
          <Link href="/" style={{ color: 'var(--tx-3)', textDecoration: 'none' }}>首页</Link>
          <span style={{ margin: '0 8px' }}>/</span>
          <Link href="/knowledge" style={{ color: 'var(--tx-3)', textDecoration: 'none' }}>知识库</Link>
          <span style={{ margin: '0 8px' }}>/</span>
          <span>{star}</span>
          <span style={{ margin: '0 8px' }}>·</span>
          <span style={{ color: 'var(--ac)' }}>{data.palaceName}宫</span>
        </nav>

        {/* 标题区 */}
        <header style={{ marginBottom: '36px' }}>
          <div style={{ fontSize: '11px', color: 'var(--tx-3)', letterSpacing: '0.25em', marginBottom: '8px' }}>
            {data.topicLabel} · 倪海厦体系详解
          </div>
          <h1 style={{ fontSize: 'clamp(28px, 5vw, 44px)', fontWeight: 700, color: 'var(--tx-0)', letterSpacing: '0.1em', lineHeight: 1.2 }}>
            {star}入{data.palaceName}宫
          </h1>
          {STAR_BRIEF_SEO[star] && (
            <p style={{ fontSize: '13px', color: 'var(--tx-2)', marginTop: '14px', lineHeight: 1.8 }}>
              {STAR_BRIEF_SEO[star]}
            </p>
          )}
          <nav aria-label="男命／女命" style={{ display: 'flex', gap: '8px', marginTop: '18px' }}>
            {(['male', 'female'] as const).map(g => (
              <Link
                key={g}
                href={`/knowledge/${slug}/${topic}${g === 'female' ? '?g=female' : ''}`}
                aria-current={gender === g ? 'page' : undefined}
                style={{
                  fontSize: '13px', padding: '6px 16px', borderRadius: '999px', textDecoration: 'none',
                  border: `1px solid ${gender === g ? 'rgba(184,146,42,0.6)' : 'rgba(184,146,42,0.2)'}`,
                  background: gender === g ? 'rgba(184,146,42,0.14)' : 'transparent',
                  color: gender === g ? 'var(--ac)' : 'var(--tx-2)',
                }}
              >
                {g === 'male' ? '男命' : '女命'}
              </Link>
            ))}
          </nav>
        </header>

        {/* 内容：白话总览＋4 段论断＋亮度差异 */}
        {data.parsed.zonglan && (
          <Section title={data.parsed.zonglanBucket ? `白话总览（以${BRIGHTNESS_LABEL[data.parsed.zonglanBucket]}为例）` : '白话总览'}>
            <div style={{ fontSize: '15px', color: 'var(--tx-0)', lineHeight: 2, letterSpacing: '0.02em', whiteSpace: 'pre-wrap' }}>
              <RichText text={data.parsed.zonglan} />
            </div>
          </Section>
        )}

        {data.parsed.dingdiao && (
          <Section title="一句话定调" gradient>
            <p style={{ fontSize: '17px', color: 'var(--tx-0)', lineHeight: 1.9, fontWeight: 500, letterSpacing: '0.04em' }}>
              {data.parsed.dingdiao}
            </p>
          </Section>
        )}

        {data.parsed.lundian && (
          <Section title="核心论断">
            <div style={{ fontSize: '15px', color: 'var(--tx-0)', lineHeight: 2, letterSpacing: '0.02em', whiteSpace: 'pre-wrap' }}>
              <RichText text={data.parsed.lundian} />
            </div>
          </Section>
        )}

        {data.parsed.yiju && (
          <Section title="命盘依据">
            <div style={{ fontSize: '14px', color: 'var(--tx-0)', lineHeight: 2, letterSpacing: '0.02em', whiteSpace: 'pre-wrap' }}>
              <RichText text={data.parsed.yiju} />
            </div>
          </Section>
        )}

        {data.parsed.chuchu && (
          <Section title="经典出处" minimal>
            <div style={{ fontSize: '13px', color: 'var(--tx-2)', lineHeight: 2, letterSpacing: '0.02em', whiteSpace: 'pre-wrap' }}>
              <RichText text={data.parsed.chuchu} />
            </div>
          </Section>
        )}

        {Object.keys(data.parsed.brightness).length > 0 && (
          <Section title="亮度差异" minimal>
            {(Object.entries(data.parsed.brightness) as [Brightness, string[]][]).map(([b, lines]) => (
              <div key={b} style={{ fontSize: '14px', color: 'var(--tx-0)', lineHeight: 2, marginBottom: '10px' }}>
                <strong style={{ color: 'var(--ac)' }}>{BRIGHTNESS_LABEL[b]}：</strong>
                {lines.map((l, i) => <div key={i}><RichText text={l} /></div>)}
              </div>
            ))}
          </Section>
        )}

        <p style={{ fontSize: '11px', color: 'var(--tx-3)', lineHeight: 1.8, margin: '8px 0 0' }}>
          本页由压缩断语库中 {star} 独坐{data.palaceName}宫的{gender === 'female' ? '女命' : '男命'} {Object.values(data.parsed.samples).reduce((a, b) => a + (b ?? 0), 0)} 张命盘（{sampleNote}）归纳共同论断而成；个别命盘专属的推导与格局不列入。
        </p>

        {/* CTA */}
        <div style={{
          margin: '40px 0 30px',
          padding: '24px',
          background: 'linear-gradient(135deg, rgba(212,169,72,0.15) 0%, rgba(184,146,42,0.06) 100%)',
          borderRadius: '14px',
          border: '1px solid rgba(184,146,42,0.3)',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '14px', color: 'var(--tx-0)', fontWeight: 600, letterSpacing: '0.1em', marginBottom: '6px' }}>
            想看你自己命盘的{data.topicLabel}？
          </div>
          <div style={{ fontSize: '12px', color: 'var(--tx-2)', marginBottom: '16px' }}>
            输入生辰起盘 · 倪师正宗解读 · AI 答疑伴学
          </div>
          <Link href="/chart" style={{
            display: 'inline-block',
            padding: '12px 28px',
            background: 'linear-gradient(135deg, #d4a948 0%, #b8922a 100%)',
            color: 'white',
            borderRadius: '999px',
            fontSize: '14px',
            fontWeight: 600,
            letterSpacing: '0.15em',
            textDecoration: 'none',
            boxShadow: '0 4px 12px rgba(184,146,42,0.3)',
          }}>
            立即起盘 →
          </Link>
        </div>

        {/* 内链：同主星其他 topic */}
        <Section title={`${star}星的其他宫位解读`} minimal>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {otherTopicsForStar.map(t => {
              const d = { palaceName: TOPIC_PALACE_NAME[t] };
              return (
                <Link
                  key={t}
                  href={`/knowledge/${slug}/${t}${gq}`}
                  style={{
                    fontSize: '12px',
                    padding: '6px 12px',
                    background: 'var(--bg-card)',
                    border: '1px solid rgba(184,146,42,0.25)',
                    borderRadius: '999px',
                    color: 'var(--tx-2)',
                    textDecoration: 'none',
                  }}
                >
                  {star}入{d.palaceName}
                </Link>
              );
            })}
          </div>
        </Section>

        {/* 内链：同 topic 其他主星 */}
        <Section title={`其他主星入${data.palaceName}宫的解读`} minimal>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {otherStarsForTopic.slice(0, 13).map(s => (
              <Link
                key={s}
                href={`/knowledge/${STAR_TO_SLUG[s]}/${topic}${gq}`}
                style={{
                  fontSize: '12px',
                  padding: '6px 12px',
                  background: 'var(--bg-card)',
                  border: '1px solid rgba(184,146,42,0.25)',
                  borderRadius: '999px',
                  color: 'var(--tx-2)',
                  textDecoration: 'none',
                }}
              >
                {s}入{data.palaceName}
              </Link>
            ))}
          </div>
        </Section>

        {/* 古籍库链接 */}
        <div style={{
          marginTop: '40px',
          padding: '16px 20px',
          background: 'rgba(184,146,42,0.04)',
          border: '1px dashed rgba(184,146,42,0.25)',
          borderRadius: '10px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '11px', color: 'var(--ac-dim)', letterSpacing: '0.15em', marginBottom: '6px' }}>
            想读原典？
          </div>
          <Link href="/library" style={{ fontSize: '13px', color: 'var(--ac)', fontWeight: 500, letterSpacing: '0.1em', textDecoration: 'none' }}>
            📜 查阅古籍原典库 — 紫微斗数全集 / 全书 / 骨髓赋 →
          </Link>
        </div>
      </article>

      {/* 页脚 */}
      <footer style={{ borderTop: '1px solid rgba(184,146,42,0.15)', padding: '20px 24px', textAlign: 'center', fontSize: '11px', color: 'var(--tx-3)', letterSpacing: '0.1em' }}>
        <div style={{ marginBottom: '6px' }}>紫微研究 · 基于倪海厦正宗体系 · 仅供学习参考</div>
        <div style={{ opacity: 0.85 }}>本平台不构成任何医疗、投资、法律或重大决策建议</div>
      </footer>
    </div>
  );
}

function Section({ title, children, gradient, minimal }: { title: string; children: React.ReactNode; gradient?: boolean; minimal?: boolean }) {
  return (
    <section style={{ marginBottom: minimal ? '24px' : '32px' }}>
      <h2 style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '13px',
        color: 'var(--ac)',
        fontWeight: 600,
        letterSpacing: '0.2em',
        marginBottom: '12px',
      }}>
        <span style={{ width: '4px', height: '14px', background: 'var(--ac)', borderRadius: '2px' }} />
        {title}
      </h2>
      <div style={{
        background: gradient
          ? 'linear-gradient(135deg, rgba(212,169,72,0.12) 0%, rgba(184,146,42,0.04) 100%)'
          : 'var(--bg-card)', // 跟著深／淺色主題（原本寫死白底，深色主題下淺色字看不到）
        border: '1px solid rgba(184,146,42,0.15)',
        borderRadius: '10px',
        padding: minimal ? '14px 18px' : '20px 22px',
      }}>
        {children}
      </div>
    </section>
  );
}
