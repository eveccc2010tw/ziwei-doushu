/**
 * AI 出題的載入器：同盤同領域同現況快取＋請求序號。
 * 只有「最後一次 load」的回應會更新畫面與寫入快取，換盤／換領域／改現況／🎲 重出時，
 * 晚回來的舊回應一律丟棄，不會覆蓋新結果。
 */
export interface SuggestState {
  key: string;
  questions: string[];
  loading: boolean;
}

export function createSuggestLoader<Req>(
  fetcher: (req: Req) => Promise<string[]>,
  onState: (state: SuggestState) => void,
) {
  const cache = new Map<string, string[]>();
  let seq = 0;
  return {
    async load(key: string, req: Req, force = false) {
      const mine = ++seq;
      const cached = cache.get(key);
      if (cached && !force) {
        onState({ key, questions: cached, loading: false });
        return;
      }
      onState({ key, questions: [], loading: true });
      let questions: string[] = [];
      try {
        questions = await fetcher(req);
      } catch { /* 出題失敗就只顯示通用題 */ }
      if (mine !== seq) return;
      if (questions.length) cache.set(key, questions);
      onState({ key, questions, loading: false });
    },
    /** 換盤時清快取，並讓進行中的請求失效 */
    reset() {
      cache.clear();
      seq++;
    },
  };
}
