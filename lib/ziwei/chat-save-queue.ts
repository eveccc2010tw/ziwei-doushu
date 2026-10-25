/**
 * 案件 AI 對話的存檔佇列（前端）：所有存檔（手動存案件、每答完一題自動存）依序送出，不會亂序覆蓋。
 * 每筆真正送出時才取「該次起盤（session）最新的對話」，所以晚送的永遠是那張盤最新的內容：
 * 不靠時間戳排序，也不會因為換盤而把別張盤的對話、或同一張盤較舊的快照寫進案件。
 * 同一案件被兩台裝置同時編輯時，是最後送出的整段覆蓋（不合併）。
 */
export function createChatSaveQueue<M>(deps: {
  /** 某次起盤最新的對話 */
  latestFor: (session: number) => M[];
  save: (caseId: string, messages: M[]) => Promise<boolean>;
}) {
  let chain: Promise<unknown> = Promise.resolve();
  return function enqueue(caseId: string, session: number): Promise<boolean> {
    const job = chain.then(() => {
      const messages = deps.latestFor(session);
      return messages.length ? deps.save(caseId, messages) : true;
    }).catch(() => false);
    chain = job;
    return job;
  };
}
