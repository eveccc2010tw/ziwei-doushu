import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import type { TopicKey } from './ziwei/db-analysis';

const zstdDecompressSync = (zlib as unknown as {
  zstdDecompressSync: (buf: NodeJS.ArrayBufferView) => Buffer;
}).zstdDecompressSync;

export const DATASET_TOPICS: TopicKey[] = [
  'overview', 'personality', 'love', 'career', 'wealth', 'health',
  'family', 'children', 'move', 'friends', 'home', 'spirit', 'parents',
];

export type DatasetMode = 'auto' | 'sqlite' | 'zst-onfly';

export interface DatasetReadingRecord {
  k: string;
  y: number;
  m: number;
  d: number;
  h: number;
  g: 'male' | 'female';
  ms: string | null;
  t: Record<TopicKey, number>;
  c: Record<TopicKey, string>;
  _engine: {
    source: 'sqlite-zstd' | 'zst-onfly';
    elapsedMs: number;
    cacheHit: boolean;
  };
}

export interface DatasetKeyParts {
  k: string;
  y: number;
  m: number;
  d: number;
  h: number;
  g: 'male' | 'female';
}

const SLOTS_PER_MONTH = 31 * 24;
const HEADER_OFFSET_BYTES = (SLOTS_PER_MONTH + 1) * 4;

const DATA_DIR = process.env.ZIWEI_DATA_DIR || '/opt/fate-data/ziwei-interp-v4';
const DEFAULT_OPT_SQLITE = path.join(DATA_DIR, 'ziwei-v4.sqlite');
const LOCAL_DATA_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), 'data');
const LOCAL_SQLITE = path.join(/*turbopackIgnore: true*/ LOCAL_DATA_DIR, 'ziwei-v4.sqlite');

export function resolveDefaultSqlitePath(): string {
  if (process.env.ZIWEI_SQLITE_PATH) return process.env.ZIWEI_SQLITE_PATH;
  if (fs.existsSync(/*turbopackIgnore: true*/ DEFAULT_OPT_SQLITE)) return DEFAULT_OPT_SQLITE;
  if (fs.existsSync(/*turbopackIgnore: true*/ LOCAL_SQLITE)) return LOCAL_SQLITE;

  // Auto-assemble from split chunks in ./data/ziwei-v4.sqlite.part-* on first use
  const firstPart = path.join(/*turbopackIgnore: true*/ LOCAL_DATA_DIR, 'ziwei-v4.sqlite.part-aa');
  if (fs.existsSync(/*turbopackIgnore: true*/ firstPart)) {
    const parts = fs
      .readdirSync(/*turbopackIgnore: true*/ LOCAL_DATA_DIR)
      .filter((f) => f.startsWith('ziwei-v4.sqlite.part-'))
      .sort();
    if (parts.length > 0) {
      const tmp = `${LOCAL_SQLITE}.tmp.${process.pid}`;
      const fd = fs.openSync(/*turbopackIgnore: true*/ tmp, 'w');
      try {
        for (const p of parts) {
          const buf = fs.readFileSync(/*turbopackIgnore: true*/ path.join(LOCAL_DATA_DIR, p));
          fs.writeFileSync(fd, buf);
        }
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(/*turbopackIgnore: true*/ tmp, /*turbopackIgnore: true*/ LOCAL_SQLITE);
      return LOCAL_SQLITE;
    }
  }
  return DEFAULT_OPT_SQLITE;
}

// LRU Caches
const yearDictCache = new Map<number, string[]>();
const monthBlockCache = new Map<string, Buffer>();
const onFlyChartCache = new Map<string, Omit<DatasetReadingRecord, '_engine'>>();

const MAX_YEAR_CACHE = 6;
const MAX_MONTH_CACHE = 16;
const MAX_ONFLY_CACHE = 64;

function lruSet<K, V>(map: Map<K, V>, key: K, val: V, max: number) {
  if (map.has(key)) map.delete(key);
  map.set(key, val);
  if (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

export function parseDatasetKey(input: string): DatasetKeyParts | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})-(\d{1,2})-(male|female)$/.exec(input.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const month = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(m[4]);
  const g = m[5] as 'male' | 'female';
  if (y < 1950 || y > 2026 || month < 1 || month > 12 || d < 1 || d > 31 || h < 0 || h > 11) {
    return null;
  }
  return {
    k: `${y}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}-${h}-${g}`,
    y,
    m: month,
    d,
    h,
    g,
  };
}

export function formatDatasetKey(y: number, m: number, d: number, h: number, g: 'male' | 'female'): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}-${h}-${g}`;
}

let cachedDb: DatabaseSync | null = null;
let cachedDbMtime = 0;

function getSqliteDb(customPath?: string): DatabaseSync | null {
  const defaultPath = resolveDefaultSqlitePath();
  const target = customPath || defaultPath;
  if (!fs.existsSync(/*turbopackIgnore: true*/ target)) return null;
  if (customPath && customPath !== defaultPath) {
    return new DatabaseSync(target, { readOnly: true });
  }
  const stat = fs.statSync(/*turbopackIgnore: true*/ target);
  if (!cachedDb || stat.mtimeMs !== cachedDbMtime) {
    try { cachedDb?.close(); } catch { /* ignore */ }
    cachedDb = new DatabaseSync(target, { readOnly: true });
    cachedDbMtime = stat.mtimeMs;
    yearDictCache.clear();
    monthBlockCache.clear();
  }
  return cachedDb;
}

export function lookupFromSqlite(
  parts: DatasetKeyParts,
  options?: { sqlitePath?: string; bypassCache?: boolean }
): DatasetReadingRecord | null {
  const t0 = performance.now();
  const defaultPath = resolveDefaultSqlitePath();
  const isCustomDb = Boolean(options?.sqlitePath && options.sqlitePath !== defaultPath);
  const db = getSqliteDb(options?.sqlitePath);
  if (!db) return null;

  const useCache = !isCustomDb && !options?.bypassCache;
  const monthKey = `${parts.y}-${String(parts.m).padStart(2, '0')}`;

  try {
    let dictLines = useCache ? yearDictCache.get(parts.y) : undefined;
    let rawMonth = useCache ? monthBlockCache.get(monthKey) : undefined;
    const cacheHit = Boolean(dictLines && rawMonth);

    if (!dictLines) {
      const dictRow = db.prepare('SELECT dict_zst FROM year_dicts WHERE year = ?').get(parts.y) as { dict_zst: Uint8Array } | undefined;
      if (!dictRow) return null;
      dictLines = zstdDecompressSync(dictRow.dict_zst).toString('utf8').split('\n');
      if (useCache) lruSet(yearDictCache, parts.y, dictLines, MAX_YEAR_CACHE);
    }

    if (!rawMonth) {
      const monthRow = db.prepare('SELECT block_zst FROM month_blocks WHERE month = ?').get(monthKey) as { block_zst: Uint8Array } | undefined;
      if (!monthRow) return null;
      rawMonth = zstdDecompressSync(monthRow.block_zst);
      if (useCache) lruSet(monthBlockCache, monthKey, rawMonth, MAX_MONTH_CACHE);
    }

    const slot = (parts.d - 1) * 24 + parts.h * 2 + (parts.g === 'female' ? 1 : 0);
    if (slot < 0 || slot >= SLOTS_PER_MONTH) return null;

    const start = HEADER_OFFSET_BYTES + rawMonth.readUInt32LE(slot * 4);
    const end = HEADER_OFFSET_BYTES + rawMonth.readUInt32LE((slot + 1) * 4);
    if (start >= end) return null;

    const rec = rawMonth.subarray(start, end);
    const idBytes = rec.readUInt8(0);
    const metaLen = rec.readUInt16LE(1);
    const meta = JSON.parse(rec.subarray(7, 7 + metaLen).toString('utf8')) as {
      ms: string | null;
      t: Record<TopicKey, number>;
    };
    const chartBin = rec.subarray(7 + metaLen);

    let offset = 0;
    const c = {} as Record<TopicKey, string>;
    for (let t = 0; t < DATASET_TOPICS.length; t++) {
      const topic = DATASET_TOPICS[t];
      const count = idBytes === 2 ? chartBin.readUInt16LE(offset) : chartBin.readUInt32LE(offset);
      offset += idBytes;
      const lines = new Array<string>(count);
      if (idBytes === 2) {
        for (let i = 0; i < count; i++) {
          lines[i] = dictLines[chartBin.readUInt16LE(offset)];
          offset += 2;
        }
      } else {
        for (let i = 0; i < count; i++) {
          lines[i] = dictLines[chartBin.readUInt32LE(offset)];
          offset += 4;
        }
      }
      c[topic] = lines.join('\n');
    }

    const elapsedMs = Number((performance.now() - t0).toFixed(3));
    return {
      k: parts.k,
      y: parts.y,
      m: parts.m,
      d: parts.d,
      h: parts.h,
      g: parts.g,
      ms: meta.ms,
      t: meta.t,
      c,
      _engine: {
        source: 'sqlite-zstd',
        elapsedMs,
        cacheHit,
      },
    };
  } finally {
    if (isCustomDb) {
      try { db.close(); } catch { /* ignore */ }
    }
  }
}

export async function lookupFromZstOnFly(
  parts: DatasetKeyParts,
  options?: { dataDir?: string; bypassCache?: boolean }
): Promise<DatasetReadingRecord | null> {
  const t0 = performance.now();
  const useCache = !options?.dataDir && !options?.bypassCache;
  if (useCache) {
    const hit = onFlyChartCache.get(parts.k);
    if (hit) {
      return {
        ...hit,
        _engine: {
          source: 'zst-onfly',
          elapsedMs: Number((performance.now() - t0).toFixed(3)),
          cacheHit: true,
        },
      };
    }
  }

  const dir = options?.dataDir || DATA_DIR;
  const zstPath = path.join(/*turbopackIgnore: true*/ dir, `year-${parts.y}.jsonl.zst`);
  if (!fs.existsSync(/*turbopackIgnore: true*/ zstPath)) return null;

  const prefix = `{"k":"${parts.k}"`;
  const proc = spawn('zstd', ['-d', '--long=27', '-c', zstPath], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  const rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
  let matched: Omit<DatasetReadingRecord, '_engine'> | null = null;

  try {
    for await (const line of rl) {
      if (line.startsWith(prefix)) {
        matched = JSON.parse(line);
        proc.kill('SIGTERM');
        rl.close();
        break;
      }
    }
  } finally {
    try { proc.kill('SIGTERM'); } catch { /* ignore */ }
  }

  if (!matched) return null;
  if (useCache) lruSet(onFlyChartCache, parts.k, matched, MAX_ONFLY_CACHE);

  return {
    ...matched,
    _engine: {
      source: 'zst-onfly',
      elapsedMs: Number((performance.now() - t0).toFixed(3)),
      cacheHit: false,
    },
  };
}

export async function getDatasetReading(
  keyOrParts: string | DatasetKeyParts,
  mode: DatasetMode = 'auto',
  options?: { sqlitePath?: string; dataDir?: string; bypassCache?: boolean }
): Promise<DatasetReadingRecord | null> {
  const parts = typeof keyOrParts === 'string' ? parseDatasetKey(keyOrParts) : keyOrParts;
  if (!parts) return null;

  if (mode === 'sqlite' || mode === 'auto') {
    const sqliteHit = lookupFromSqlite(parts, options);
    if (sqliteHit || mode === 'sqlite') return sqliteHit;
  }

  return lookupFromZstOnFly(parts, options);
}

export function getDatasetStats(customSqlitePath?: string) {
  const sqliteTarget = customSqlitePath || resolveDefaultSqlitePath();
  const hasSqlite = fs.existsSync(/*turbopackIgnore: true*/ sqliteTarget);
  let sqliteSizeMB = 0;
  let indexedYears = 0;
  let totalCharts = 0;

  if (hasSqlite) {
    sqliteSizeMB = Number((fs.statSync(/*turbopackIgnore: true*/ sqliteTarget).size / 1e6).toFixed(2));
    const db = getSqliteDb(customSqlitePath);
    if (db) {
      try {
        const yRow = db.prepare('SELECT COUNT(*) AS cnt FROM year_dicts').get() as { cnt: number };
        const cRow = db.prepare('SELECT COALESCE(SUM(chart_count), 0) AS cnt FROM month_blocks').get() as { cnt: number };
        indexedYears = yRow?.cnt ?? 0;
        totalCharts = cRow?.cnt ?? 0;
      } finally {
        if (customSqlitePath) {
          try { db.close(); } catch { /* ignore */ }
        }
      }
    }
  }

  return {
    hasSqlite,
    sqlitePath: sqliteTarget,
    sqliteSizeMB,
    indexedYears,
    totalCharts,
  };
}
