'use client';
import { useCallback, useEffect, useState } from 'react';

/**
 * 命盤頁的閱讀偏好（字級、面板顯示），記在本機瀏覽器 localStorage。
 * 字級以 --t-fs 倍率套到命盤與解讀面板（tailwind.config 的 text-fs-* 字級）。
 * 元件基礎字級已比改版前大約 15%（標準）；「小」約等於改版前大小。
 */
export const FONT_STEPS = [
  { label: '小', scale: 0.87 },
  { label: '標準', scale: 1 },
  { label: '大', scale: 1.15 },
  { label: '特大', scale: 1.35 },
] as const;
export const DEFAULT_FONT_STEP = 1;

/** both＝命盤＋解讀並排；chart／insight＝只顯示其中一個 */
export type PanelLayout = 'both' | 'chart' | 'insight';

const FONT_KEY = 'ziwei-chart-font-step';
const LAYOUT_KEY = 'ziwei-chart-layout';

export function parseFontStep(raw: string | null): number {
  const n = Number(raw);
  return raw !== null && Number.isInteger(n) && n >= 0 && n < FONT_STEPS.length ? n : DEFAULT_FONT_STEP;
}

export function parseLayout(raw: string | null): PanelLayout {
  return raw === 'chart' || raw === 'insight' ? raw : 'both';
}

/** 切換某一側顯示；兩側不會同時隱藏 */
export function togglePanel(layout: PanelLayout, panel: 'chart' | 'insight'): PanelLayout {
  const other = panel === 'chart' ? 'insight' : 'chart';
  if (layout === 'both') return other;
  if (layout === other) return 'both';
  return layout;
}

export function useChartPrefs() {
  const [fontStep, setFontStep] = useState(DEFAULT_FONT_STEP);
  const [layout, setLayout] = useState<PanelLayout>('both');

  useEffect(() => {
    try {
      setFontStep(parseFontStep(localStorage.getItem(FONT_KEY)));
      setLayout(parseLayout(localStorage.getItem(LAYOUT_KEY)));
    } catch { /* 無痕模式等讀不到時用預設 */ }
  }, []);

  const changeFont = useCallback((delta: number) => {
    setFontStep((cur) => {
      const next = Math.min(FONT_STEPS.length - 1, Math.max(0, cur + delta));
      try { localStorage.setItem(FONT_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const toggle = useCallback((panel: 'chart' | 'insight') => {
    setLayout((cur) => {
      const next = togglePanel(cur, panel);
      try { localStorage.setItem(LAYOUT_KEY, next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  return { fontStep, fontScale: FONT_STEPS[fontStep].scale, changeFont, layout, toggle };
}
