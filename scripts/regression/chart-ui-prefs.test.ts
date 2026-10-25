/**
 * 命盤頁 UI 小工具回歸：
 *   1. Ctrl／⌘+Enter 才送出，單按 Enter 與輸入法選字不送出
 *   2. 預設提問題庫涵蓋 13 個領域、抽題不重複
 *   3. 字級／面板偏好的解析與切換（兩側不會同時隱藏）
 *   4. 元件用到的 --t-* 顏色變數都在 globals.css 有定義（曾整組未定義，格線與邊框全消失）
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isSubmitShortcut } from '../../lib/submit-shortcut';
import { PRESET_QUESTIONS, pickQuestions } from '../../lib/ziwei/preset-questions';
import { FONT_STEPS, DEFAULT_FONT_STEP, parseFontStep, parseLayout, togglePanel } from '../../lib/ziwei/chart-prefs';

const fails: string[] = [];
const check = (ok: boolean, msg: string) => { if (!ok) fails.push(msg); };

// 1. 送出鍵
const key = (k: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; isComposing: boolean }>) =>
  ({ key: 'Enter', ctrlKey: false, metaKey: false, isComposing: false, ...k });
check(!isSubmitShortcut(key({})), '單按 Enter 不應送出');
check(isSubmitShortcut(key({ ctrlKey: true })), 'Ctrl+Enter 應送出');
check(isSubmitShortcut(key({ metaKey: true })), '⌘+Enter 應送出');
check(!isSubmitShortcut(key({ ctrlKey: true, isComposing: true })), '選字中不應送出');
check(!isSubmitShortcut(key({ key: 'a', ctrlKey: true })), 'Ctrl+A 不應送出');

// 2. 題庫
const TOPICS = ['overview', 'personality', 'love', 'career', 'wealth', 'health', 'family', 'children', 'move', 'friends', 'home', 'spirit', 'parents'] as const;
check(Object.keys(PRESET_QUESTIONS).length === TOPICS.length, `題庫應有 ${TOPICS.length} 個領域`);
for (const t of TOPICS) {
  const pool = PRESET_QUESTIONS[t];
  check(Array.isArray(pool) && pool.length >= 6, `${t} 題庫至少 6 題`);
  check(new Set(pool).size === pool.length, `${t} 題庫有重複題`);
}
for (let i = 0; i < 50; i++) {
  const picked = pickQuestions(PRESET_QUESTIONS.wealth, 3);
  check(picked.length === 3 && new Set(picked).size === 3, '抽 3 題應不重複');
  check(picked.every((q) => PRESET_QUESTIONS.wealth.includes(q)), '抽出的題目應來自題庫');
}
check(pickQuestions(['a', 'b'], 5).length === 2, '題庫不足時回傳全部');

// 3. 偏好
check(parseFontStep(null) === DEFAULT_FONT_STEP, '未設定字級用預設');
check(parseFontStep('0') === 0 && parseFontStep(String(FONT_STEPS.length - 1)) === FONT_STEPS.length - 1, '合法字級照用');
check(parseFontStep('9') === DEFAULT_FONT_STEP && parseFontStep('x') === DEFAULT_FONT_STEP && parseFontStep('1.5') === DEFAULT_FONT_STEP, '非法字級回預設');
check(FONT_STEPS[DEFAULT_FONT_STEP].label === '標準' && FONT_STEPS[DEFAULT_FONT_STEP].scale === 1, '預設字級為「標準」');
check(FONT_STEPS.every((s, i) => i === 0 || s.scale > FONT_STEPS[i - 1].scale), '字級由小到大遞增');
check(parseLayout('chart') === 'chart' && parseLayout('insight') === 'insight' && parseLayout('x') === 'both' && parseLayout(null) === 'both', '面板設定解析');
check(togglePanel('both', 'chart') === 'insight', '並排時隱藏命盤 → 只剩解讀');
check(togglePanel('both', 'insight') === 'chart', '並排時隱藏解讀 → 只剩命盤');
check(togglePanel('insight', 'chart') === 'both', '只剩解讀時打開命盤 → 並排');
check(togglePanel('insight', 'insight') === 'insight', '只剩解讀時不能再隱藏解讀');
check(togglePanel('chart', 'chart') === 'chart', '只剩命盤時不能再隱藏命盤');

// 4. --t-* 變數定義：淺色（:root）與深色（[data-theme="dark"]）都要有
const css = readFileSync('app/globals.css', 'utf8');
const definedIn = (selector: RegExp) => {
  const vars = new Set<string>();
  for (const block of css.matchAll(new RegExp(`${selector.source}\\s*\\{([^}]*)\\}`, 'g'))) {
    for (const m of block[1].matchAll(/(--t-[a-z0-9-]+)\s*:/g)) vars.add(m[1]);
  }
  return vars;
};
const themes = { light: definedIn(/:root/), dark: definedIn(/\[data-theme="dark"\]/) };
const used = new Set<string>();
for (const dir of ['components', 'app']) {
  const walk = (d: string) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(tsx|ts|css)$/.test(ent.name)) {
        for (const m of readFileSync(p, 'utf8').matchAll(/var\((--t-[a-z0-9-]+)/g)) used.add(m[1]);
      }
    }
  };
  walk(dir);
}
for (const [theme, defined] of Object.entries(themes)) {
  const missing = [...used].filter((v) => v !== '--t-fs' && !defined.has(v));
  check(missing.length === 0, `globals.css ${theme} 主題缺少顏色變數：${missing.join(', ')}`);
}

if (fails.length) {
  console.error(`✗ chart-ui-prefs：${fails.length} 項失敗`);
  for (const f of fails) console.error('  ' + f);
  process.exit(1);
}
console.log(`[chart-ui-prefs] 通過：送出鍵、${TOPICS.length} 領域題庫、偏好切換、${used.size} 個 --t-* 變數皆有定義`);
