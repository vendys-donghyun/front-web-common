import { describe, it, expect, vi } from 'vitest';
import { createRefreshSingleton } from './refreshSingleton';

describe('createRefreshSingleton', () => {
  it('동시 run() 호출은 동일 promise 공유(dedup)', async () => {
    let calls = 0;
    let resolveFn!: (v: { accessToken: string; refreshToken?: string }) => void;
    const refresh = vi.fn(() => {
      calls += 1;
      return new Promise<{ accessToken: string; refreshToken?: string }>((res) => {
        resolveFn = res;
      });
    });
    const singleton = createRefreshSingleton({ refresh });

    const p1 = singleton.run();
    const p2 = singleton.run();
    const p3 = singleton.run();

    expect(calls).toBe(1);

    resolveFn({ accessToken: 'a1', refreshToken: 'r1' });
    const [t1, t2, t3] = await Promise.all([p1, p2, p3]);
    expect(t1).toBe('a1');
    expect(t2).toBe('a1');
    expect(t3).toBe('a1');
  });

  it('성공 후 다음 run()은 새 refresh 실행', async () => {
    let n = 0;
    const refresh = vi.fn(async () => ({ accessToken: `a${++n}`, refreshToken: 'r' }));
    const singleton = createRefreshSingleton({ refresh });

    expect(await singleton.run()).toBe('a1');
    expect(await singleton.run()).toBe('a2');
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('실패 시 거부 전파 + 다음 run()으로 재시도 가능', async () => {
    let attempts = 0;
    const refresh = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('boom');
      return { accessToken: 'recovered', refreshToken: 'r' };
    });
    const singleton = createRefreshSingleton({ refresh });

    await expect(singleton.run()).rejects.toThrow('boom');
    expect(await singleton.run()).toBe('recovered');
  });

  it('onSuccess 콜백이 TokenPair로 호출', async () => {
    const onSuccess = vi.fn();
    const refresh = vi.fn(async () => ({ accessToken: 'A', refreshToken: 'R' }));
    const singleton = createRefreshSingleton({ refresh, onSuccess });

    await singleton.run();
    expect(onSuccess).toHaveBeenCalledWith({ accessToken: 'A', refreshToken: 'R' });
  });
});
