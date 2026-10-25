'use client';
import type { CSSProperties } from 'react';
import {
  RELATIONSHIP_OPTIONS, OCCUPATION_OPTIONS, CHILDREN_OPTIONS, INCOME_OPTIONS, INCOME_LEGACY_OPTIONS, ASSET_OPTIONS, CONCERN_OPTIONS,
  sanitizeProfile, type LifeProfile,
} from '@/lib/ziwei/profile';

/** 送 AI 的提醒文字（排盤表單與命盤頁共用） */
export const PROFILE_AI_NOTICE = '現況資料會連同命盤送給 AI，用來調整建議與出題；平時由公司自架 AI 處理，忙碌時改用外部備援 AI 服務。';

interface ProfileFieldsProps {
  value: LifeProfile | undefined;
  onChange: (next: LifeProfile | undefined) => void;
  /** 沿用外層表單的下拉樣式（排盤表單）；沒給就用命盤頁的 --t-* 配色 */
  selectStyle?: CSSProperties;
  labelColor?: string;
}

const SELECTS = [
  ['relationship', '感情狀態', RELATIONSHIP_OPTIONS],
  ['occupation', '職業', OCCUPATION_OPTIONS],
  ['children', '子女', CHILDREN_OPTIONS],
  ['income', '年收入', INCOME_OPTIONS],
  ['realEstate', '房地產', ASSET_OPTIONS],
  ['liquidAssets', '現金＋股票', ASSET_OPTIONS],
] as const;

const defaultSelect: CSSProperties = {
  width: '100%', padding: '7px 10px', borderRadius: 8, fontSize: 13,
  background: 'var(--t-bg)', border: '1px solid var(--t-border)', color: 'var(--t-text)',
};

/** 命主現況（全部選填、全部用選的）：感情、職業、子女、年收入、房地產與現金＋股票區間、目前最關心 */
export default function ProfileFields({ value, onChange, selectStyle, labelColor }: ProfileFieldsProps) {
  const p = value ?? {};
  const set = (patch: Record<string, unknown>) => onChange(sanitizeProfile({ ...p, ...patch }));
  const label: CSSProperties = { display: 'block', fontSize: 11, marginBottom: 4, color: labelColor ?? 'var(--t-faint)' };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
        {SELECTS.map(([key, title, options]) => (
          <label key={key}>
            <span style={label}>{title}</span>
            <select
              value={p[key] ?? ''}
              onChange={(e) => set({ [key]: e.target.value || undefined })}
              style={selectStyle ?? defaultSelect}
            >
              <option value="">不填</option>
              {key === 'income' && INCOME_LEGACY_OPTIONS.filter(([code]) => code === p.income).map(([code, text]) => (
                <option key={code} value={code}>{text}（舊級距，請重選）</option>
              ))}
              {options.map(([code, text]) => <option key={code} value={code}>{text}</option>)}
            </select>
          </label>
        ))}
      </div>

      <div style={{ marginTop: 10 }}>
        <span style={label}>目前最關心（可複選）</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {CONCERN_OPTIONS.map(([code, text]) => {
            const on = p.concerns?.includes(code) ?? false;
            return (
              <button
                key={code}
                type="button"
                aria-pressed={on}
                onClick={() => set({ concerns: on ? p.concerns?.filter((c) => c !== code) : [...(p.concerns ?? []), code] })}
                style={{
                  padding: '4px 12px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
                  border: `1px solid ${on ? 'rgba(212,168,67,0.55)' : 'var(--t-border)'}`,
                  background: on ? 'rgba(212,168,67,0.16)' : 'transparent',
                  color: on ? 'var(--t-gold)' : (labelColor ?? 'var(--t-faint)'),
                }}
              >
                {text}
              </button>
            );
          })}
        </div>
      </div>

      <p style={{ fontSize: 11, marginTop: 10, lineHeight: 1.6, color: labelColor ?? 'var(--t-faint)' }}>
        🔒 {PROFILE_AI_NOTICE}
      </p>
    </div>
  );
}
