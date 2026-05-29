import { describe, it, expect, vi } from 'vitest';
import { createKmsClient } from '../kms';

describe('kms client', () => {
  it('caches public key after first fetch', async () => {
    const axios = { get: vi.fn().mockResolvedValue({ data: { publicKey: 'PK_BASE64' } }) };
    const kms = createKmsClient({ axios: axios as any, keyIdResolver: () => 'KID' });

    const a = await kms.getPublicKey();
    const b = await kms.getPublicKey();

    expect(a).toBe('PK_BASE64');
    expect(b).toBe('PK_BASE64');
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent inflight requests', async () => {
    let resolve!: (v: { data: { publicKey: string } }) => void;
    const axios = {
      get: vi.fn().mockReturnValue(new Promise((r) => { resolve = r; }))
    };
    const kms = createKmsClient({ axios: axios as any, keyIdResolver: () => 'KID' });

    const p1 = kms.getPublicKey();
    const p2 = kms.getPublicKey();
    expect(axios.get).toHaveBeenCalledTimes(1);

    resolve({ data: { publicKey: 'PK' } });
    await Promise.all([p1, p2]);
  });
});
