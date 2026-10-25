// 案件儲存（server only）：JSON 檔案 + 原子寫入；單一 Next process 內以 promise chain 序列化。
// AI 對話另存一案一檔（case-chats/<id>.json），案件清單檔保持精簡。
import { promises as fs } from 'fs';
import path from 'path';

export interface CaseEntry {
  id: string;
  name: string;
  note: string;
  form: unknown; // BirthFormState（原樣保存，顯示層自行轉繁）
  createdAt: number;
  updatedAt: number;
  /** 已存的 AI 對話則數（不含系統提示） */
  chatCount?: number;
  chatUpdatedAt?: number;
}

export interface CaseChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** 內建提示詞（點領域／宮位送出的長指令），畫面不顯示 */
  hidden?: boolean;
}

const FILE = process.env.CASES_FILE || '/opt/fate-data/cases.json';
const MAX_CASES = 500;
const CHAT_DIR = path.join(path.dirname(FILE), 'case-chats');
/** 案件 id 格式（c + base36），先驗格式再組檔名，避免路徑穿越 */
const ID_RE = /^c[0-9a-z]{6,24}$/;
export const MAX_CHAT_MESSAGES = 80;
const MAX_CHAT_USER_CHARS = 1200;
const MAX_CHAT_ASSISTANT_CHARS = 6000;

export function isCaseId(id: string): boolean {
  return ID_RE.test(id);
}

/** 只留合法訊息、截長度、保留最後 MAX_CHAT_MESSAGES 則 */
export function sanitizeChat(raw: unknown): CaseChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: CaseChatMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const { role, content, hidden } = m as Record<string, unknown>;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string' || !content.trim()) continue;
    const max = role === 'user' ? MAX_CHAT_USER_CHARS : MAX_CHAT_ASSISTANT_CHARS;
    out.push({ role, content: content.slice(0, max), ...(hidden === true ? { hidden: true } : {}) });
  }
  return out.slice(-MAX_CHAT_MESSAGES);
}

const chatFile = (id: string) => path.join(/*turbopackIgnore: true*/ CHAT_DIR, `${id}.json`);

let chain: Promise<unknown> = Promise.resolve();
function lock<T>(fn: () => Promise<T>): Promise<T> {
  const res = chain.then(fn, fn);
  chain = res.then(
    () => undefined,
    () => undefined,
  );
  return res;
}

async function readAll(): Promise<CaseEntry[]> {
  try {
    const raw = await fs.readFile(/*turbopackIgnore: true*/ FILE, 'utf8');
    const j = JSON.parse(raw);
    return Array.isArray(j.cases) ? j.cases : [];
  } catch {
    return [];
  }
}

async function writeAll(cases: CaseEntry[]): Promise<void> {
  await fs.mkdir(/*turbopackIgnore: true*/ path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  await fs.writeFile(/*turbopackIgnore: true*/ tmp, JSON.stringify({ cases }, null, 2), 'utf8');
  await fs.rename(/*turbopackIgnore: true*/ tmp, /*turbopackIgnore: true*/ FILE);
}

export function listCases(): Promise<CaseEntry[]> {
  return lock(readAll);
}

export function saveCase(input: { id?: string; name: string; note?: string; form: unknown }): Promise<CaseEntry> {
  return lock(async () => {
    const cases = await readAll();
    const now = Date.now();
    let entry = input.id ? cases.find((c) => c.id === input.id) : undefined;
    if (entry) {
      entry.name = input.name;
      entry.note = input.note ?? entry.note;
      entry.form = input.form;
      entry.updatedAt = now;
    } else {
      entry = {
        id: `c${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        name: input.name,
        note: input.note || '',
        form: input.form,
        createdAt: now,
        updatedAt: now,
      };
      cases.unshift(entry);
    }
    // 超過上限淘汰最舊的案件時，連它的對話檔一起刪
    for (const old of cases.slice(MAX_CASES)) {
      if (isCaseId(old.id)) await fs.rm(/*turbopackIgnore: true*/ chatFile(old.id), { force: true });
    }
    await writeAll(cases.slice(0, MAX_CASES));
    return entry;
  });
}

export function deleteCase(id: string): Promise<CaseEntry[]> {
  return lock(async () => {
    const cases = await readAll();
    const filtered = cases.filter((c) => c.id !== id);
    await writeAll(filtered);
    if (isCaseId(id)) await fs.rm(/*turbopackIgnore: true*/ chatFile(id), { force: true });
    return filtered;
  });
}

export async function loadCaseChat(id: string): Promise<CaseChatMessage[]> {
  if (!isCaseId(id)) return [];
  if (!(await listCases()).some((c) => c.id === id)) return [];
  try {
    const raw = await fs.readFile(/*turbopackIgnore: true*/ chatFile(id), 'utf8');
    return sanitizeChat(JSON.parse(raw).messages);
  } catch {
    return [];
  }
}

/** 存某案件的 AI 對話（整段覆蓋；前端以佇列依序送最新內容）；案件不存在回 null */
export function saveCaseChat(id: string, raw: unknown): Promise<CaseEntry | null> {
  return lock(async () => {
    if (!isCaseId(id)) return null;
    const cases = await readAll();
    const entry = cases.find((c) => c.id === id);
    if (!entry) return null;
    const messages = sanitizeChat(raw);
    await fs.mkdir(/*turbopackIgnore: true*/ CHAT_DIR, { recursive: true });
    const tmp = chatFile(id) + '.tmp';
    await fs.writeFile(/*turbopackIgnore: true*/ tmp, JSON.stringify({ messages }), 'utf8');
    await fs.rename(/*turbopackIgnore: true*/ tmp, /*turbopackIgnore: true*/ chatFile(id));
    entry.chatCount = messages.filter((m) => !m.hidden).length;
    entry.chatUpdatedAt = Date.now();
    await writeAll(cases);
    return entry;
  });
}
