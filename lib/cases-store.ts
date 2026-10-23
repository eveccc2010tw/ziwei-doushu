// 案件儲存（server only）：JSON 檔案 + 原子寫入；單一 Next process 內以 promise chain 序列化
import { promises as fs } from 'fs';
import path from 'path';

export interface CaseEntry {
  id: string;
  name: string;
  note: string;
  form: unknown; // BirthFormState（原樣保存，顯示層自行轉繁）
  createdAt: number;
  updatedAt: number;
}

const FILE = process.env.CASES_FILE || '/opt/fate-data/cases.json';
const MAX_CASES = 500;

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
    const raw = await fs.readFile(FILE, 'utf8');
    const j = JSON.parse(raw);
    return Array.isArray(j.cases) ? j.cases : [];
  } catch {
    return [];
  }
}

async function writeAll(cases: CaseEntry[]): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  await fs.writeFile(tmp, JSON.stringify({ cases }, null, 2), 'utf8');
  await fs.rename(tmp, FILE);
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
    await writeAll(cases.slice(0, MAX_CASES));
    return entry;
  });
}

export function deleteCase(id: string): Promise<void> {
  return lock(async () => {
    const cases = await readAll();
    await writeAll(cases.filter((c) => c.id !== id));
  });
}
