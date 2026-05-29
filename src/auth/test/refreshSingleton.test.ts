import { describe, it, expect, vi } from 'vitest';
import { createRefreshSingleton } from '../refreshSingleton';

describe('refresh singleton', () => {
  it('dedupes concurrent run() calls into one refresh', async () => {
    const refresh = vi.fn().mockResolvedValue({ accessToken: 'NEW' });
    const onSuccess = vi.fn();
    const s = createRefreshSingleton({ refresh, onSuccess });

    const [a, b] = await Promise.all([s.run(), s.run()]);

    expect(a).toBe('NEW');
    expect(b).toBe('NEW');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('allows new refresh after previous completes', async () => {
    const refresh = vi.fn().mockResolvedValue({ accessToken: 'T' });
    const s = createRefreshSingleton({ refresh, onSuccess: () => {} });

    await s.run();
    await s.run();

    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('clears inflight on refresh failure', async () => {
    const refresh = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce({ accessToken: 'OK' });
    const s = createRefreshSingleton({ refresh, onSuccess: () => {} });

    await expect(s.run()).rejects.toThrow('fail');
    const next = await s.run();
    expect(next).toBe('OK');
  });
});
