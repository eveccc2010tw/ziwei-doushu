/**
 * 問 AI 的使用上限（對話框顯示與 server 檢查共用）。
 * 對話框（解讀追問、合盤追問）每題最多 MAX_QUESTION_CHARS 字；
 * 每人每 LIMIT_WINDOW_MIN 分鐘最多問 AI ASK_LIMIT 次（解讀＋合盤合計，含點宮位、完整分析等自動提問）。
 */
export const MAX_QUESTION_CHARS = 250;
export const ASK_LIMIT = 30;
/** AI 依本盤出題另計，切領域就會出題，給寬一點 */
export const SUGGEST_LIMIT = 60;
export const LIMIT_WINDOW_MIN = 10;

export function rateLimitText(retryAfterSec: number): string {
  const min = Math.max(1, Math.ceil(retryAfterSec / 60));
  return `⏳ 提問太頻繁：每 ${LIMIT_WINDOW_MIN} 分鐘最多問 AI ${ASK_LIMIT} 次，請約 ${min} 分鐘後再試。`;
}

export const QUESTION_TOO_LONG_TEXT = `問題太長了，請精簡到 ${MAX_QUESTION_CHARS} 字以內再問。`;
