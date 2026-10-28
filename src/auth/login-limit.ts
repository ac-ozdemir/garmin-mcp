// Brute-force lockout for the owner password: a per-IP limit, plus a global limit that also stops an
// attacker who rotates IPs. Counters live in D1 (strongly consistent), not KV (eventually consistent).

export const PER_IP_MAX_FAILURES = 5;
export const PER_IP_WINDOW_MS = 15 * 60 * 1000;
export const GLOBAL_MAX_FAILURES = 20;
export const GLOBAL_WINDOW_MS = 60 * 60 * 1000;
/** Rows older than this are never needed again. */
const RETENTION_MS = 24 * 60 * 60 * 1000;

export interface FailureWindow {
  count: number;
  /** Oldest failure inside the window (ISO), null when count is 0. */
  oldest: string | null;
}

export type Lockout = { locked: false } | { locked: true; scope: 'ip' | 'global'; retryAfterSeconds: number };

/**
 * Locked while a window holds at least `max` failures. The lock lifts when the oldest failure in the
 * window ages out, which brings the count below the limit (sliding window).
 */
export function decideLockout(ip: FailureWindow, global: FailureWindow, now: Date): Lockout {
  const check = (w: FailureWindow, max: number, windowMs: number) =>
    w.count >= max && w.oldest ? Math.ceil((Date.parse(w.oldest) + windowMs - now.getTime()) / 1000) : 0;
  const globalWait = check(global, GLOBAL_MAX_FAILURES, GLOBAL_WINDOW_MS);
  if (globalWait > 0) return { locked: true, scope: 'global', retryAfterSeconds: globalWait };
  const ipWait = check(ip, PER_IP_MAX_FAILURES, PER_IP_WINDOW_MS);
  if (ipWait > 0) return { locked: true, scope: 'ip', retryAfterSeconds: ipWait };
  return { locked: false };
}

/** Keyed hash, so the table does not hold raw IPs and the small IPv4 space cannot be brute-forced back. */
export async function hashIp(ip: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const since = (now: Date, ms: number) => new Date(now.getTime() - ms).toISOString();

export async function currentLockout(
  db: D1Database,
  ipHash: string,
  now: Date = new Date(),
): Promise<Lockout> {
  const [ip, global] = await db.batch<FailureWindow>([
    db
      .prepare(
        'SELECT COUNT(*) AS count, MIN(failed_at) AS oldest FROM login_failures WHERE ip_hash = ? AND failed_at > ?',
      )
      .bind(ipHash, since(now, PER_IP_WINDOW_MS)),
    db
      .prepare('SELECT COUNT(*) AS count, MIN(failed_at) AS oldest FROM login_failures WHERE failed_at > ?')
      .bind(since(now, GLOBAL_WINDOW_MS)),
  ]);
  const first = (r: D1Result<FailureWindow> | undefined): FailureWindow =>
    r?.results[0] ?? { count: 0, oldest: null };
  return decideLockout(first(ip), first(global), now);
}

export async function recordFailure(db: D1Database, ipHash: string, now: Date = new Date()): Promise<void> {
  await db.batch([
    db
      .prepare('INSERT INTO login_failures (ip_hash, failed_at) VALUES (?, ?)')
      .bind(ipHash, now.toISOString()),
    db.prepare('DELETE FROM login_failures WHERE failed_at < ?').bind(since(now, RETENTION_MS)),
  ]);
}

/** A correct password clears that IP's own failures; the global window is left to expire. */
export async function clearFailures(db: D1Database, ipHash: string): Promise<void> {
  await db.prepare('DELETE FROM login_failures WHERE ip_hash = ?').bind(ipHash).run();
}
