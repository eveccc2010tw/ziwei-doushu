'use client';
import { useCallback, useEffect, useState } from 'react';
import BirthForm, { type BirthFormState } from '@/components/BirthForm';
import ChartBoard from '@/components/ChartBoard';
import InsightPanel from '@/components/InsightPanel';
import ShareCardCanvas, { captureShareCard, downloadDataURL } from '@/components/ShareCardCanvas';
import ProfileFields from '@/components/ProfileFields';
import { useHistory } from '@/lib/ziwei/history';
import { useChartPrefs, FONT_STEPS } from '@/lib/ziwei/chart-prefs';
import { generateChart } from '@/lib/ziwei/algorithm';
import type { BirthInfo, ZiweiChart, Palace } from '@/lib/ziwei/types';

interface CaseRow {
  id: string;
  name: string;
  note: string;
  form: Partial<BirthFormState>;
  createdAt: number;
  updatedAt: number;
}

/**
 * 命盤頁 —— 排盤引擎 Demo + 本站自接功能：
 * 1. 瀏覽器歷史（localStorage，最近 10 筆）
 * 2. 案件（server 端 /api/cases，跨裝置）
 * 3. 分享卡 PNG 下載
 * 4. 字級 A−／A＋、命盤／解讀顯示切換（本機記憶）
 * 5. 命主現況（選填）：表單或「👤 現況」填寫，送給 AI 調整建議與出題，隨案件／歷史保存
 * 介面文字以繁體撰寫；其餘簡體字串由 Traditionalizer 於顯示層轉換。
 */
export default function ChartPage() {
  const [chart, setChart] = useState<ZiweiChart | null>(null);
  const [selectedPalace, setSelectedPalace] = useState<Palace | null>(null);
  const [lastForm, setLastForm] = useState<BirthFormState | null>(null);
  const [prefill, setPrefill] = useState<Partial<BirthFormState> | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const { history, save, remove } = useHistory();
  const { fontStep, fontScale, changeFont, layout, toggle } = useChartPrefs();
  const showChart = layout !== 'insight';
  const showInsight = layout !== 'chart';

  // ── 案件（server 端）──
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [caseNote, setCaseNote] = useState('');
  const [caseFormOpen, setCaseFormOpen] = useState(false);
  const [caseMsg, setCaseMsg] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);

  const reloadCases = useCallback(async () => {
    try {
      const r = await fetch('/api/cases', { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      setCases(Array.isArray(d.cases) ? d.cases : []);
    } catch { /* offline 時靜默 */ }
  }, []);

  useEffect(() => { reloadCases(); }, [reloadCases]);

  const handleSaveCase = async () => {
    if (!lastForm) return;
    setCaseMsg('儲存中…');
    try {
      const r = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: lastForm.name?.trim() || '未命名',
          note: caseNote.trim(),
          form: lastForm,
        }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setCaseNote('');
      setCaseFormOpen(false);
      setCaseMsg(`已儲存案件（${lastForm.name?.trim() || '未命名'}）`);
      reloadCases();
    } catch {
      setCaseMsg('儲存失敗，請重試');
    }
  };

  const handleDeleteCase = async (id: string) => {
    try {
      await fetch(`/api/cases/${id}`, { method: 'DELETE' });
      reloadCases();
    } catch { /* ignore */ }
  };

  const handleDownload = async () => {
    if (!chart || downloading) return;
    setDownloading(true);
    try {
      const dataURL = await captureShareCard();
      if (dataURL) downloadDataURL(dataURL, `紫微命盤_${lastForm?.name || Date.now()}.png`);
    } finally {
      setDownloading(false);
    }
  };

  const applyPrefill = (form: Partial<BirthFormState>) => {
    setPrefill(form);
    setFormKey((k) => k + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ── 未起盤：出生資訊表單 + 歷史 + 案件 ──
  if (!chart) {
    return (
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 20px' }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>紫微斗數排盤</h1>
        <p style={{ color: '#888', marginBottom: 32, fontSize: 14, lineHeight: 1.7 }}>
          輸入出生年月日時，開源排盤引擎即時生成命盤。
        </p>
        <BirthForm
          key={formKey}
          showProfile
          initialData={prefill ?? undefined}
          onFormSave={(form) => { setLastForm(form); save(form); setPrefill(null); }}
          onSubmit={(info: BirthInfo) => { setChart(generateChart(info)); setSelectedPalace(null); }}
        />

        {cases.length > 0 && (
          <section style={{ marginTop: 48 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#8a6d1a' }}>
              📁 案件（伺服器，跨裝置）
            </h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {cases.map((c) => (
                <li
                  key={c.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '10px 12px', marginBottom: 8, borderRadius: 10,
                    border: '1px solid #e2d9c2', background: '#faf6ec',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => applyPrefill(c.form)}
                    style={{ flex: 1, textAlign: 'left', cursor: 'pointer', background: 'transparent', border: 'none', padding: 0, fontSize: 14, color: '#333' }}
                  >
                    <strong>{c.name}</strong>
                    {c.note && <span style={{ color: '#666', fontSize: 12, marginLeft: 8 }}>{c.note.slice(0, 40)}</span>}
                    <span style={{ color: '#aaa', fontSize: 12, marginLeft: 8 }}>
                      {new Date(c.updatedAt).toLocaleString('zh-TW', { hour12: false })}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label="刪除案件"
                    onClick={() => handleDeleteCase(c.id)}
                    style={{ cursor: 'pointer', background: 'transparent', border: 'none', color: '#bbb', fontSize: 16, padding: '2px 6px' }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <p style={{ color: '#aaa', fontSize: 12, marginTop: 8 }}>
              案件存在伺服器，任何裝置登入後都能調閱。
            </p>
          </section>
        )}

        {history.length > 0 && (
          <section style={{ marginTop: 40 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: '#666' }}>
              最近排盤（本機瀏覽器）
            </h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {history.map((e) => (
                <li
                  key={e.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '10px 12px', marginBottom: 8, borderRadius: 10,
                    border: '1px solid #e5e0d5', background: '#faf8f3',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => applyPrefill(e.form)}
                    style={{ flex: 1, textAlign: 'left', cursor: 'pointer', background: 'transparent', border: 'none', padding: 0, fontSize: 14, color: '#333' }}
                  >
                    {e.label}
                    <span style={{ color: '#aaa', fontSize: 12, marginLeft: 8 }}>
                      {new Date(e.savedAt).toLocaleString('zh-TW', { hour12: false })}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label="刪除"
                    onClick={() => remove(e.id)}
                    style={{ cursor: 'pointer', background: 'transparent', border: 'none', color: '#bbb', fontSize: 16, padding: '2px 6px' }}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <p style={{ color: '#aaa', fontSize: 12, marginTop: 8 }}>
              歷史只存在此瀏覽器（localStorage，最多 10 筆）；換裝置請改用上方「案件」。
            </p>
          </section>
        )}
      </main>
    );
  }

  // ── 已起盤：命盤 + 解讀 ──
  return (
    <main style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => { setChart(null); setSelectedPalace(null); setCaseMsg(''); setProfileOpen(false); }}
          style={{
            padding: '6px 14px', cursor: 'pointer',
            border: '1px solid #ccc', borderRadius: 8, background: 'transparent',
          }}
        >
          ← 重新起盤
        </button>
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading || !lastForm}
          style={{
            padding: '6px 14px', cursor: downloading ? 'wait' : 'pointer',
            border: '1px solid #c9a648', borderRadius: 8,
            background: lastForm ? 'rgba(212,168,67,0.12)' : 'transparent',
            color: '#8a6d1a', opacity: downloading ? 0.6 : 1,
          }}
        >
          {downloading ? '產生中…' : '⬇ 下載命盤圖'}
        </button>
        <button
          type="button"
          onClick={() => { setCaseFormOpen((v) => !v); setCaseMsg(''); }}
          disabled={!lastForm}
          style={{
            padding: '6px 14px', cursor: 'pointer',
            border: '1px solid #7a9a54', borderRadius: 8,
            background: 'rgba(122,154,84,0.12)', color: '#4c6b2d',
          }}
        >
          📁 {caseFormOpen ? '取消儲存' : '儲存為案件'}
        </button>
        <button
          type="button"
          onClick={() => setProfileOpen((v) => !v)}
          disabled={!lastForm}
          aria-expanded={profileOpen}
          style={{
            padding: '6px 14px', cursor: 'pointer',
            border: '1px solid var(--t-border)', borderRadius: 8,
            background: profileOpen ? 'rgba(212,168,67,0.16)' : 'transparent', color: 'var(--t-gold)',
          }}
        >
          👤 現況{lastForm?.profile ? ' ✓' : ''}
        </button>
        {caseMsg && <span style={{ fontSize: 13, color: '#7a9a54' }}>{caseMsg}</span>}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={prefGroupStyle} role="group" aria-label="字級">
            <button type="button" onClick={() => changeFont(-1)} disabled={fontStep === 0} style={{ ...prefBtnStyle(false), opacity: fontStep === 0 ? 0.35 : 1 }} aria-label="縮小字級">A−</button>
            <span style={{ fontSize: 13, color: 'var(--t-faint)', minWidth: 32, textAlign: 'center' }}>{FONT_STEPS[fontStep].label}</span>
            <button type="button" onClick={() => changeFont(1)} disabled={fontStep === FONT_STEPS.length - 1} style={{ ...prefBtnStyle(false), opacity: fontStep === FONT_STEPS.length - 1 ? 0.35 : 1 }} aria-label="放大字級">A+</button>
          </div>
          <div style={prefGroupStyle} role="group" aria-label="顯示">
            {/* 只剩一側顯示時，該側按鈕停用（兩側不能同時隱藏） */}
            <button type="button" onClick={() => toggle('chart')} aria-pressed={showChart} disabled={layout === 'chart'} style={{ ...prefBtnStyle(showChart), cursor: layout === 'chart' ? 'default' : 'pointer' }}>命盤</button>
            <button type="button" onClick={() => toggle('insight')} aria-pressed={showInsight} disabled={layout === 'insight'} style={{ ...prefBtnStyle(showInsight), cursor: layout === 'insight' ? 'default' : 'pointer' }}>解讀</button>
          </div>
        </div>
      </div>

      {caseFormOpen && lastForm && (
        <div
          style={{
            display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16,
            padding: '10px 14px', borderRadius: 10,
            border: '1px solid #d9e4c8', background: '#f7faf2', flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 13, color: '#555' }}>
            案件名稱：<strong>{lastForm.name?.trim() || '未命名'}</strong>
          </span>
          <input
            type="text"
            value={caseNote}
            onChange={(e) => setCaseNote(e.target.value)}
            placeholder="備註（例如：客戶來電詢問感情）"
            style={{
              flex: 1, minWidth: 220, padding: '6px 10px', borderRadius: 8,
              border: '1px solid #ccc', fontSize: 13,
            }}
          />
          <button
            type="button"
            onClick={handleSaveCase}
            style={{
              padding: '6px 16px', cursor: 'pointer', borderRadius: 8,
              border: '1px solid #7a9a54', background: '#7a9a54', color: '#fff', fontSize: 13,
            }}
          >
            確認儲存
          </button>
        </div>
      )}

      {profileOpen && lastForm && (
        <div
          style={{
            marginBottom: 16, padding: '12px 16px', borderRadius: 10,
            border: '1px solid var(--t-border)', background: 'var(--t-card)',
          }}
        >
          <div style={{ fontSize: 13, marginBottom: 10, color: 'var(--t-text2)' }}>
            👤 命主現況（選填）——改完下一次問 AI 就生效；「儲存為案件」會一起存
          </div>
          <ProfileFields
            value={lastForm.profile}
            onChange={(profile) => {
              const next = { ...lastForm, profile };
              setLastForm(next);
              save(next);
            }}
          />
        </div>
      )}

      {/* 兩側都保持掛載（隱藏只是不顯示），對話紀錄與選宮狀態不會因切換而消失 */}
      <div
        className="ziwei-workspace"
        data-layout={layout}
        style={{ '--t-fs': fontScale } as React.CSSProperties}
      >
        <div hidden={!showChart}>
          <ChartBoard chart={chart} onPalaceSelect={setSelectedPalace} />
        </div>
        <div className="ziwei-insight" hidden={!showInsight}>
          {/* 解讀隱藏時點宮位只同步選取，不觸發 AI 分析 */}
          <InsightPanel chart={chart} selectedPalace={selectedPalace} paused={!showInsight} profile={lastForm?.profile} />
        </div>
      </div>

      {/* 分享卡隱藏渲染：html2canvas 依 DOM 截圖，放在視窗外即可 */}
      {lastForm && (
        <div
          aria-hidden
          style={{ position: 'fixed', left: -10000, top: 0, pointerEvents: 'none' }}
        >
          <ShareCardCanvas
            chart={chart}
            birth={{
              year: lastForm.year,
              month: lastForm.month,
              day: lastForm.day,
              hour: lastForm.clockHour,
              minute: lastForm.clockMinute,
              gender: lastForm.gender,
              city: lastForm.city,
            }}
          />
        </div>
      )}
    </main>
  );
}

const prefGroupStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 2, padding: 2,
  border: '1px solid var(--t-border)', borderRadius: 8,
};

function prefBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: '4px 10px', cursor: 'pointer', borderRadius: 6, border: 'none', fontSize: 13,
    background: active ? 'rgba(212,168,67,0.16)' : 'transparent',
    color: active ? 'var(--t-gold)' : 'var(--t-faint)',
  };
}
