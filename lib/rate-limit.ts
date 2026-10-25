/**
 * AI 端點的頻率限制（server 端，記憶體內滑動視窗；服務重啟即歸零）。
 *
 * 「每個人」的認定：CF Access 登入者用 email；辦公室 IP 免登入的人沒有 email，改用瀏覽器 cookie（fate_uid）。
 * 另以來源 IP 當安全網（上限為個人的 IP_FACTOR 倍，因辦公室共用對外 IP），擋掉不帶 cookie 的大量呼叫。
 * 狀態掛在 globalThis，讓各 API route 共用同一份計數。
 */
import type { NextRequest } from 'next/server';
import { LIMIT_WINDOW_MIN } from './ask-limits';

const WINDOW_MS = LIMIT_WINDOW_MIN * 60_000;
const IP_FACTOR = 10;
/** 記憶體硬上限：超過先清過期，仍超過就從最舊的刪 */
export const MAX_KEYS = 10_000;
const UID_COOKIE = 'fate_uid';
const UID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Store = Map<string, number[]>;
const g = globalThis as typeof globalThis & { __fateRateLimit?: Store };
const store: Store = (g.__fateRateLimit ??= new Map());

export interface Caller {
  person: string;
  ip: string;
  /** 新發的 cookie，回應時要帶上 */
  setCookie?: string;
}

export function identifyCaller(req: NextRequest): Caller {
  const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
  const email = req.headers.get('cf-access-authenticated-user-email');
  if (email) return { person: `email:${email.toLowerCase()}`, ip };
  const uid = req.cookies.get(UID_COOKIE)?.value;
  if (uid && UID_RE.test(uid)) return { person: `uid:${uid}`, ip };
  const fresh = crypto.randomUUID();
  const https = req.headers.get('x-forwarded-proto') === 'https' || req.nextUrl.protocol === 'https:';
  return {
    person: `uid:${fresh}`,
    ip,
    setCookie: `${UID_COOKIE}=${fresh}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${https ? '; Secure' : ''}`,
  };
}

/** 視窗內的呼叫時間；只讀，不替沒紀錄的人建空項目（被擋時不會讓記憶體長大） */
function recent(key: string, now: number): number[] {
  return (store.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
}

function enforceCap(now: number) {
  if (store.size <= MAX_KEYS) return;
  for (const [k, arr] of store) if (!arr.some((t) => now - t < WINDOW_MS)) store.delete(k);
  for (const k of store.keys()) {
    if (store.size <= MAX_KEYS) break;
    store.delete(k);
  }
}

/** 目前記錄的項目數（測試用） */
export function rateLimitKeyCount(): number {
  return store.size;
}

/**
 * 記一次呼叫；超過上限時不記、回傳要等幾秒（>0），沒超過回 0。
 * 個人與 IP 兩個計數都沒超過才一起記，避免被擋的那次也吃掉額度。
 */
export function checkRate(bucket: 'ask' | 'suggest', caller: Caller, limit: number, now = Date.now()): number {
  const keys: Array<[string, number]> = [
    [`${bucket}:${caller.person}`, limit],
    [`${bucket}:ip:${caller.ip}`, limit * IP_FACTOR],
  ];
  let retryAfter = 0;
  const windows = keys.map(([key, lim]) => {
    const arr = recent(key, now);
    if (arr.length >= lim) retryAfter = Math.max(retryAfter, Math.ceil((arr[0] + WINDOW_MS - now) / 1000));
    return [key, arr] as const;
  });
  if (retryAfter) return retryAfter;
  for (const [key, arr] of windows) {
    store.delete(key); // 重新插入，讓 Map 順序＝最近使用，硬上限時先刪最久沒用的
    store.set(key, [...arr, now]);
  }
  enforceCap(now);
  return 0;
}

/** 回應帶上新發的 cookie（有的話） */
export function withCaller<T extends Response>(res: T, caller: Caller): T {
  if (caller.setCookie) res.headers.append('Set-Cookie', caller.setCookie);
  return res;
}

/** 429 回應：JSON 帶 retryAfterSec，client 用來顯示要等幾分鐘 */
export function tooMany(caller: Caller, retryAfterSec: number, extra: Record<string, unknown> = {}): Response {
  return withCaller(
    Response.json({ error: 'rate_limited', retryAfterSec, ...extra }, { status: 429, headers: { 'Retry-After': String(retryAfterSec) } }),
    caller,
  );
}
