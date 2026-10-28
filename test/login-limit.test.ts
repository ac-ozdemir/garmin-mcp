import { describe, expect, it } from 'vitest';
import { decideLockout, GLOBAL_MAX_FAILURES, hashIp, PER_IP_MAX_FAILURES } from '../src/auth/login-limit.ts';

const NOW = new Date('2026-10-25T20:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const none = { count: 0, oldest: null };

describe('decideLockout', () => {
  it('allows attempts below the per-IP limit', () => {
    expect(decideLockout({ count: PER_IP_MAX_FAILURES - 1, oldest: minutesAgo(5) }, none, NOW)).toEqual({
      locked: false,
    });
  });

  it('locks an IP until its oldest failure leaves the 15-minute window', () => {
    expect(decideLockout({ count: PER_IP_MAX_FAILURES, oldest: minutesAgo(5) }, none, NOW)).toEqual({
      locked: true,
      scope: 'ip',
      retryAfterSeconds: 10 * 60,
    });
  });

  it('locks everyone when the global limit is hit, even from a fresh IP', () => {
    const lockout = decideLockout(none, { count: GLOBAL_MAX_FAILURES, oldest: minutesAgo(20) }, NOW);
    expect(lockout).toEqual({ locked: true, scope: 'global', retryAfterSeconds: 40 * 60 });
  });
});

describe('hashIp', () => {
  it('is stable for one secret and differs across secrets, never the raw IP', async () => {
    const a = await hashIp('203.0.113.7', 'secret-one-1234567');
    expect(a).toBe(await hashIp('203.0.113.7', 'secret-one-1234567'));
    expect(a).not.toBe(await hashIp('203.0.113.7', 'secret-two-1234567'));
    expect(a).not.toContain('203.0.113.7');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
