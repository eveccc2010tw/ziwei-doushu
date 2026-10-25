/**
 * 對話框送出鍵：Ctrl+Enter（Mac 為 ⌘+Enter）。
 * 單按 Enter 一律換行；輸入法選字中的 Enter 不算送出。
 */
export function isSubmitShortcut(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'isComposing'>): boolean {
  return e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing;
}

export const SUBMIT_HINT = 'Ctrl / ⌘ + Enter 送出';
