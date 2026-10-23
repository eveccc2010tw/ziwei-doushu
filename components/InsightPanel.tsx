'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ZiweiChart, Palace } from '@/lib/ziwei/types';
import type { TopicKey } from '@/lib/ziwei/db-analysis';
import type { TimeView } from './TimeNav';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  hidden?: boolean;
}

interface SelectedSiHua {
  starName: string;
  siHua: string;
  view: TimeView;
}

interface InsightPanelProps {
  chart: ZiweiChart;
  selectedPalace?: Palace | null;
  selectedSiHua?: SelectedSiHua | null;
}

interface DatasetApiRecord {
  k: string;
  y: number;
  m: number;
  d: number;
  h: number;
  g: 'male' | 'female';
  ms: string | null;
  t: Record<TopicKey, number>;
  c: Record<TopicKey, string>;
  _engine: {
    source: 'sqlite-zstd' | 'zst-onfly';
    elapsedMs: number;
    cacheHit: boolean;
  };
}

const ALL_TOPICS: ReadonlyArray<{ key: TopicKey; label: string }> = [
  { key: 'overview',    label: '命格' },
  { key: 'personality', label: '性格' },
  { key: 'love',        label: '感情' },
  { key: 'career',      label: '事業' },
  { key: 'wealth',      label: '財運' },
  { key: 'health',      label: '健康' },
  { key: 'family',      label: '兄弟' },
  { key: 'children',    label: '子女' },
  { key: 'move',        label: '遷移' },
  { key: 'friends',     label: '人際' },
  { key: 'home',        label: '田宅' },
  { key: 'spirit',      label: '福德' },
  { key: 'parents',     label: '父母' },
];

const PALACE_TO_TOPIC: Record<string, TopicKey> = {
  '命宫': 'overview',
  '命宮': 'overview',
  '兄弟': 'family',
  '兄弟宫': 'family',
  '兄弟宮': 'family',
  '夫妻': 'love',
  '夫妻宫': 'love',
  '夫妻宮': 'love',
  '子女': 'children',
  '子女宫': 'children',
  '子女宮': 'children',
  '财帛': 'wealth',
  '財帛': 'wealth',
  '财帛宫': 'wealth',
  '財帛宮': 'wealth',
  '疾厄': 'health',
  '疾厄宫': 'health',
  '疾厄宮': 'health',
  '迁移': 'move',
  '遷移': 'move',
  '迁移宫': 'move',
  '遷移宮': 'move',
  '仆役': 'friends',
  '僕役': 'friends',
  '交友': 'friends',
  '交友宫': 'friends',
  '交友宮': 'friends',
  '官禄': 'career',
  '官祿': 'career',
  '官禄宫': 'career',
  '官祿宮': 'career',
  '田宅': 'home',
  '田宅宫': 'home',
  '田宅宮': 'home',
  '福德': 'spirit',
  '福德宫': 'spirit',
  '福德宮': 'spirit',
  '父母': 'parents',
  '父母宫': 'parents',
  '父母宮': 'parents',
};

const TOPIC_PROMPTS: Record<string, string> = {
  overview: `请生成命格总览，按以下结构输出：

**【命格定性】**
用一句话概括这个命盘的核心格局与命主气质。

**【主星解读】**
命宫主星的核心特质，引用倪海厦原话或观点。

**【三方四正】**
财、官、迁三宫的联动分析及整体格局。

**【当前大限】**
当下大限运势方向与最值得关注的事项。

**【优势与注意】**
命盘天赋优势，以及需要注意的风险或功课。`,

  love: `请深度分析感情婚姻运，按以下结构输出：

**【感情格局】**
一句话定性感情命格。

**【夫妻宫分析】**
夫妻宫主星、四化，以及倪海厦体系的具体解读。

**【三方联动】**
相关宫位对感情的影响。

**【当前大限感情运】**
当下10年感情走向与关键节点。

**【实际建议】**
具体可行的感情建议。`,

  career: `请深度分析事业运，按以下结构输出：

**【事业格局】**
一句话定性事业命格，宜任职或宜创业。

**【官禄宫分析】**
官禄宫主星、四化，以及倪师对这种配置的判断。

**【财帛宫联动】**
财运与事业的关系，财路来源分析。

**【当前大限事业运】**
当下10年事业走向。

**【实际建议】**
适合的方向、行业与策略。`,

  wealth: `请深度分析财运，按以下结构输出：

**【财运格局】**
一句话定性财运模式，是主动财还是被动财。

**【财帛宫分析】**
财帛宫主星、四化，财富来源与流动模式。

**【田宅宫（财库）】**
积蓄能力与不动产运势分析。

**【当前大限财运】**
当下财运走向与注意事项。

**【理财建议】**
具体的财务建议。`,

  health: `请分析健康运势，按以下结构输出：

**【疾厄宫主星】**
疾厄宫星曜与健康含义。

**【主要风险】**
结合倪海厦子午流注理论，分析主要健康隐患与需关注的部位。

**【大限健康走势】**
当下健康趋势与关键时间段。

**【预防建议】**
具体注意事项与养生方向。`,

  personality: `请深度解析性格特质，按以下结构输出：

**【命宫主星性格】**
命宫主星的核心性格特质，引用倪师原话。

**【三方性格综合】**
财、官、迁三宫对性格的影响，全貌描绘。

**【人际关系模式】**
与他人互动方式、待人处世风格。

**【优势与人生课题】**
天赋优势，以及需要面对的人生功课。`,
};

const PALACE_ROLES: Record<string, string> = {
  '命宫':   '自我、性格、先天格局',
  '兄弟宫': '兄弟关系、合伙人',
  '夫妻宫': '感情关系、婚姻状态',
  '子女宫': '子女缘分、下属关系',
  '财帛宫': '财运来源、收入方式',
  '疾厄宫': '身体健康、意外',
  '迁移宫': '外出机遇、人际格局',
  '交友宫': '朋友圈、贵人、小人',
  '官禄宫': '事业成就、社会地位',
  '田宅宫': '不动产、家庭环境',
  '福德宫': '精神享受、内心福分',
  '父母宫': '父母关系、文书契约',
};

/** Render AI / Dataset markdown: **【Title】** → gold header, **bold** → strong */
function AiContent({ text, streaming }: { text: string; streaming?: boolean }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-0.5">
      {lines.map((line, i) => {
        const sectionMatch = line.match(/^\*\*【(.+?)】\*\*$/);
        if (sectionMatch) {
          return (
            <div key={i} className="pt-3 pb-0.5 first:pt-0">
              <span className="text-[11px] font-semibold tracking-wide" style={{ color: 'var(--t-gold)' }}>
                【{sectionMatch[1]}】
              </span>
            </div>
          );
        }
        if (line.trim() === '') return <div key={i} className="h-1" />;
        const parts = line.split(/\*\*(.+?)\*\*/);
        return (
          <div key={i} className="text-[11px] leading-relaxed" style={{ color: 'var(--t-text2)' }}>
            {parts.map((part, j) =>
              j % 2 === 0
                ? part
                : <strong key={j} className="font-medium" style={{ color: 'var(--t-text)' }}>{part}</strong>
            )}
          </div>
        );
      })}
      {streaming && (
        <span
          className="inline-block w-1.5 h-3 ml-0.5 animate-pulse rounded-sm align-middle"
          style={{ background: 'var(--t-gold)', opacity: 0.6 }}
        />
      )}
    </div>
  );
}

export default function InsightPanel({ chart, selectedPalace, selectedSiHua }: InsightPanelProps) {
  const canUseDataset = chart.birthInfo.year >= 1950 && chart.birthInfo.year <= 2026;
  const [panelTab, setPanelTab] = useState<'dataset' | 'ai'>(canUseDataset ? 'dataset' : 'ai');
  const [activeTopic, setActiveTopic] = useState<TopicKey>('overview');

  // Dataset state
  const [datasetRecord, setDatasetRecord] = useState<DatasetApiRecord | null>(null);
  const [datasetLoading, setDatasetLoading] = useState(false);
  const [datasetError, setDatasetError] = useState('');
  const [engineMode, setEngineMode] = useState<'sqlite' | 'zst-onfly'>('sqlite');

  // AI chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesRef = useRef<Message[]>([]);
  const loadingRef = useRef(false);
  const aiAutoLoaded = useRef(false);
  const lastPalaceBranch = useRef<number | undefined>(undefined);
  const lastSiHuaKey = useRef<string | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { loadingRef.current = loading; }, [loading]);

  // Fetch dataset reading
  const loadDataset = useCallback(async (mode: 'sqlite' | 'zst-onfly', nocache = false) => {
    if (!canUseDataset) return;
    setDatasetLoading(true);
    setDatasetError('');
    try {
      const { year, month, day, hour, gender } = chart.birthInfo;
      const qs = new URLSearchParams({
        y: String(year),
        m: String(month),
        d: String(day),
        h: String(hour),
        g: gender,
        mode: mode === 'sqlite' ? 'auto' : 'zst-onfly',
        ...(nocache ? { nocache: '1' } : {}),
      });
      const res = await fetch(`/api/dataset?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || '查無斷語資料');
      }
      setDatasetRecord(data.record);
    } catch (e) {
      setDatasetError(e instanceof Error ? e.message : '讀取斷語庫失敗');
    } finally {
      setDatasetLoading(false);
    }
  }, [canUseDataset, chart.birthInfo]);

  useEffect(() => {
    setMessages([]);
    aiAutoLoaded.current = false;
    lastPalaceBranch.current = undefined;
    lastSiHuaKey.current = undefined;
  }, [chart.birthInfo]);

  useEffect(() => {
    if (canUseDataset) {
      loadDataset(engineMode, false);
    } else {
      setPanelTab('ai');
    }
  }, [canUseDataset, chart.birthInfo, engineMode, loadDataset]);

  // Auto-scroll when AI messages update
  useEffect(() => {
    if (panelTab === 'ai' && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, panelTab]);

  // Scroll to top when switching dataset topic
  useEffect(() => {
    if (panelTab === 'dataset' && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [activeTopic, panelTab]);

  const streamResponse = async (apiMessages: { role: 'user' | 'assistant'; content: string }[]) => {
    try {
      const res = await fetch('/api/interpret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chart, messages: apiMessages }),
      });
      if (res.status === 404) throw new Error('api-missing');
      if (!res.ok) throw new Error('请求失败');
      if (!res.body) throw new Error('无响应流');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = '';

      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') break;
          try {
            const delta = JSON.parse(data).delta?.text ?? '';
            assistantText += delta;
            setMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: 'assistant', content: assistantText };
              return updated;
            });
          } catch { /* skip */ }
        }
      }
    } catch (e) {
      const missing = e instanceof Error && e.message === 'api-missing';
      setMessages(prev => [...prev, { role: 'assistant', content: missing ? '开源版不含 AI 解读接口（/api/interpret），需要你自己实现后才能用，详见 README「快速开始」。排盘本身不需要任何 API Key。' : '解读失败，请稍后重试。' }]);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  };

  const sendMessage = useCallback((text: string, hidden = false) => {
    if (!text.trim() || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);

    const userMsg: Message = { role: 'user', content: text, hidden };
    const apiMessages = [...messagesRef.current, userMsg].map(m => ({
      role: m.role,
      content: m.content,
    }));

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    streamResponse(apiMessages);
  }, [chart]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-generate AI overview when switching to AI tab for the first time
  useEffect(() => {
    if (panelTab === 'ai' && !aiAutoLoaded.current && messagesRef.current.length === 0) {
      aiAutoLoaded.current = true;
      sendMessage(TOPIC_PROMPTS[activeTopic] || TOPIC_PROMPTS.overview, true);
    }
  }, [panelTab, activeTopic, sendMessage]);

  // Inject palace analysis when palace selected on ChartBoard
  useEffect(() => {
    if (!selectedPalace || selectedPalace.branch === lastPalaceBranch.current) return;
    lastPalaceBranch.current = selectedPalace.branch;

    const mappedTopic = PALACE_TO_TOPIC[selectedPalace.name];
    if (panelTab === 'dataset' && mappedTopic && datasetRecord) {
      setActiveTopic(mappedTopic);
      return;
    }

    const majorStars = selectedPalace.stars.filter(s => s.type === 'major');
    const starDesc = majorStars.length > 0
      ? majorStars.map(s => `${s.name}${s.siHua ? '化' + s.siHua : ''}`).join('、')
      : '空宫（借对宫）';
    const role = PALACE_ROLES[selectedPalace.name] ?? '';

    const prompt = `请重点分析【${selectedPalace.name}】（主管：${role}），该宫主星为${starDesc}，按以下结构输出：

**【宫位定性】**
${selectedPalace.name}在命盘中的意义，以及这种星曜配置的整体判断。

**【主星解读】**
主星在此宫的倪海厦体系解读，引用具体观点。

**【三方四正联动】**
三方四正宫位对此宫的影响。

**【实际建议】**
基于此宫的具体建议。`;

    setPanelTab('ai');
    aiAutoLoaded.current = true;
    sendMessage(prompt, true);
  }, [selectedPalace, panelTab, datasetRecord, sendMessage]);

  // 注入四化飞化分析
  useEffect(() => {
    if (!selectedSiHua) return;
    const key = `${selectedSiHua.starName}-${selectedSiHua.siHua}-${selectedSiHua.view}`;
    if (key === lastSiHuaKey.current) return;
    lastSiHuaKey.current = key;

    const palaceOfStar = chart.palaces.find(p =>
      p.stars.some(s => s.name === selectedSiHua.starName)
    );
    const palaceName = palaceOfStar?.name ?? '未知宫位';
    const viewLabel = selectedSiHua.view === 'daxian' ? '大限' : '流年';

    const prompt = `请分析【${viewLabel}${selectedSiHua.starName}化${selectedSiHua.siHua}】的飞化影响，按以下结构输出：

**【化${selectedSiHua.siHua}基本含义】**
化${selectedSiHua.siHua}在倪海厦体系中的核心含义，以及${selectedSiHua.starName}化${selectedSiHua.siHua}的特殊含义。

**【落宫影响】**
${selectedSiHua.starName}化${selectedSiHua.siHua}落在【${palaceName}】，该宫主管的领域受到何种影响，倪师如何解读。

**【三方四正飞化路径】**
化${selectedSiHua.siHua}入${palaceName}后，对其三方四正（对宫、两个三合宫）的联动影响。

**【当前运势影响】**
在${viewLabel}时间维度下，此化${selectedSiHua.siHua}对命主近期运势的具体影响。

**【实际建议】**
基于此四化的具体可操作建议。`;

    setPanelTab('ai');
    aiAutoLoaded.current = true;
    sendMessage(prompt, true);
  }, [selectedSiHua, chart.palaces, sendMessage]);

  const handleTopicClick = (topicKey: TopicKey) => {
    setActiveTopic(topicKey);
    if (panelTab === 'ai') {
      if (loadingRef.current) return;
      const label = ALL_TOPICS.find(t => t.key === topicKey)?.label || topicKey;
      const prompt = TOPIC_PROMPTS[topicKey] || `請依倪海廈《天紀》體系深度分析此命盤的【${label}】運勢與格局要點。`;
      sendMessage(prompt, true);
    }
  };

  const handleSend = () => {
    if (!input.trim() || loadingRef.current) return;
    setPanelTab('ai');
    aiAutoLoaded.current = true;
    sendMessage(input);
  };

  const currentTopicText = datasetRecord?.c?.[activeTopic] || '';
  const currentTopicChars = datasetRecord?.t?.[activeTopic] ?? currentTopicText.length;
  const totalChartChars = datasetRecord
    ? Object.values(datasetRecord.t || {}).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <div className="flex flex-col h-full rounded-xl overflow-hidden card-glass">

      {/* ── Mode Switcher: 典籍詳批 vs AI 互動解讀 ── */}
      <div className="flex-shrink-0 px-2.5 pt-2.5 pb-1.5 flex items-center justify-between gap-2" style={{ borderBottom: '1px solid var(--t-border)' }}>
        <div className="flex gap-1.5 flex-1">
          {canUseDataset && (
            <button
              type="button"
              onClick={() => setPanelTab('dataset')}
              className="flex-1 py-1.5 px-2 text-[11px] font-semibold rounded-lg transition-all"
              style={{
                background: panelTab === 'dataset' ? 'rgba(212,168,67,0.16)' : 'transparent',
                border: `1px solid ${panelTab === 'dataset' ? 'rgba(212,168,67,0.4)' : 'var(--t-border)'}`,
                color: panelTab === 'dataset' ? 'var(--t-gold)' : 'var(--t-faint)',
              }}
            >
              📚 典籍詳批（13維秒出）
            </button>
          )}
          <button
            type="button"
            onClick={() => setPanelTab('ai')}
            className="flex-1 py-1.5 px-2 text-[11px] font-semibold rounded-lg transition-all"
            style={{
              background: panelTab === 'ai' ? 'rgba(212,168,67,0.16)' : 'transparent',
              border: `1px solid ${panelTab === 'ai' ? 'rgba(212,168,67,0.4)' : 'var(--t-border)'}`,
              color: panelTab === 'ai' ? 'var(--t-gold)' : 'var(--t-faint)',
            }}
          >
            ✨ AI 互動解讀
          </button>
        </div>
      </div>

      {/* ── 13 Topic buttons ── */}
      <div className="flex-shrink-0 px-2 pt-2 pb-2" style={{ borderBottom: '1px solid var(--t-border)' }}>
        <div className="grid grid-cols-7 gap-1">
          {ALL_TOPICS.map(t => {
            const isActive = activeTopic === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => handleTopicClick(t.key)}
                disabled={panelTab === 'ai' && loading}
                className="py-1 text-[10px] font-medium rounded-md transition-all duration-150 disabled:opacity-40"
                style={{
                  background: isActive ? 'rgba(212,168,67,0.14)' : 'transparent',
                  border: `1px solid ${isActive ? 'rgba(212,168,67,0.35)' : 'var(--t-border)'}`,
                  color: isActive ? 'var(--t-gold)' : 'var(--t-faint)',
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Engine Telemetry Bar (Dataset Mode) ── */}
      {panelTab === 'dataset' && (
        <div
          className="flex-shrink-0 px-3 py-1.5 flex items-center justify-between gap-2 text-[10px]"
          style={{ borderBottom: '1px solid var(--t-border)', background: 'rgba(212,168,67,0.04)', color: 'var(--t-faint)' }}
        >
          <span>
            {datasetLoading ? (
              '⚡ 解壓讀取中…'
            ) : datasetRecord ? (
              <>
                ⚡ <strong>{datasetRecord._engine.source === 'sqlite-zstd' ? 'SQLite+Zstd' : '.zst 即時解壓'}</strong>
                {' · '}
                <span style={{ color: 'var(--t-gold)' }}>{datasetRecord._engine.elapsedMs}ms</span>
                {datasetRecord._engine.cacheHit ? ' (快取)' : ' (冷讀)'}
                {' · '}
                本維 {currentTopicChars.toLocaleString()} 字 / 全盤 {totalChartChars.toLocaleString()} 字
              </>
            ) : (
              datasetError || '無資料'
            )}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => { setEngineMode('sqlite'); loadDataset('sqlite', true); }}
              className="px-1.5 py-0.5 rounded text-[9px]"
              style={{
                border: `1px solid ${engineMode === 'sqlite' ? 'rgba(212,168,67,0.4)' : 'var(--t-border)'}`,
                color: engineMode === 'sqlite' ? 'var(--t-gold)' : 'var(--t-faint)',
              }}
              title="從去重字典 SQLite+Zstd 區塊讀取（冷讀 ~2ms）"
            >
              SQLite
            </button>
            <button
              type="button"
              onClick={() => { setEngineMode('zst-onfly'); loadDataset('zst-onfly', true); }}
              className="px-1.5 py-0.5 rounded text-[9px]"
              style={{
                border: `1px solid ${engineMode === 'zst-onfly' ? 'rgba(212,168,67,0.4)' : 'var(--t-border)'}`,
                color: engineMode === 'zst-onfly' ? 'var(--t-gold)' : 'var(--t-faint)',
              }}
              title="直接串流解壓原始 year-YYYY.jsonl.zst（不經 DB）"
            >
              .zst直讀
            </button>
          </div>
        </div>
      )}

      {/* ── Content Area ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0" style={{ maxHeight: '72vh' }}>
        {panelTab === 'dataset' ? (
          datasetLoading ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="text-4xl mb-3" style={{ color: 'var(--t-gold)', opacity: 0.1 }}>✦</div>
              <p className="text-[11px] animate-pulse" style={{ color: 'var(--t-faint)' }}>正在從壓縮庫即時解碼 13 維斷語…</p>
            </div>
          ) : datasetError ? (
            <div className="text-[11px] py-8 text-center" style={{ color: 'var(--t-faint)' }}>
              {datasetError}
            </div>
          ) : (
            <AiContent key={activeTopic} text={currentTopicText} />
          )
        ) : (
          <>
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="text-4xl mb-3" style={{ color: 'var(--t-gold)', opacity: 0.1 }}>✦</div>
                <p className="text-[10px] animate-pulse" style={{ color: 'var(--t-faint)' }}>命格解读生成中…</p>
              </div>
            )}

            <AnimatePresence initial={false}>
              {messages.map((msg, i) => {
                if (msg.role === 'user' && msg.hidden) return null;

                if (msg.role === 'user') {
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex justify-end"
                    >
                      <div
                        className="max-w-[85%] rounded-xl px-3 py-2 text-[11px]"
                        style={{
                          background: 'rgba(212,168,67,0.08)',
                          border: '1px solid rgba(212,168,67,0.18)',
                          color: 'var(--t-gold)',
                        }}
                      >
                        {msg.content}
                      </div>
                    </motion.div>
                  );
                }

                const isLastMsg = i === messages.length - 1;
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <div
                      className="text-[9px] tracking-widest mb-2 flex items-center gap-1.5"
                      style={{ color: 'var(--t-faint)' }}
                    >
                      <span style={{ color: 'var(--t-gold)', opacity: 0.4 }}>✦</span>
                      AI 命理解讀（已注入 v4.0 斷語 RAG）
                    </div>
                    <AiContent text={msg.content} streaming={loading && isLastMsg} />
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </>
        )}
      </div>

      {/* ── Input ── */}
      <div className="flex-shrink-0 px-3 pb-3 pt-2" style={{ borderTop: '1px solid var(--t-border)' }}>
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="繼續追問 AI（自動引用本盤 13 維斷語），如：今年適合換工作嗎？"
            disabled={loading}
            className="flex-1 rounded-lg px-3 py-2 text-[11px] focus:outline-none transition-colors"
            style={{
              background: 'var(--t-card)',
              border: '1px solid var(--t-border)',
              color: 'var(--t-text)',
            }}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="px-3 py-2 rounded-lg text-[11px] font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: 'rgba(212,168,67,0.15)',
              border: '1px solid rgba(212,168,67,0.25)',
              color: 'var(--t-gold)',
            }}
          >
            {loading ? '…' : '追問'}
          </button>
        </div>
      </div>

    </div>
  );
}
