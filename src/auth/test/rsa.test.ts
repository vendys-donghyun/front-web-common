import { describe, it, expect } from 'vitest';
import { encryptPasswordRSA } from '../rsa';
import { AuthError } from '../errors';

describe('rsa encrypt', () => {
  it('produces a non-empty base64 cipher for valid public key', () => {
    // 테스트용 RSA-2048 공개키 DER base64 (jsencrypt generate로 만든 고정값 사용)
    // node REPL에서 jsencrypt로 생성 후 derToPem 라운드트립 검증 완료
    const validDerBase64 =
      'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAx04d7GYoj25m8b+/abiMekvhrG0hHDv3bObQ+cHV5Dt/t1Yh+cI9L8qe3dQzJd7mtU224rJLc9q4N6KW7a5ZLdptErfjmW0FisEj1Y/jKkKizFH3RGs/9zLGt5kbIduKo27Rg4+S4a/IeYvzthzNP2fHEdvUKIkaQ90+obJ6JBKczFZ8edbf2zrO56F6OjMBYvVix04UHl2wSpG0TAzS+NlYXodJ75M7Bjn0GdTVvgXR8n4aONpN+AgClEbYV7WPlrik0luwKbSwAGN7oHNk0KeBQTkENWbacdJQJek7ys70P2/SdMg9/ceWEIFsP0Ud7qnX/+OOr3gqCDA1olXInQIDAQAB';

    const cipher = encryptPasswordRSA('mypassword', validDerBase64);
    expect(typeof cipher).toBe('string');
    expect(cipher.length).toBeGreaterThan(0);
  });

  it('throws AuthError-like on invalid key format', () => {
    expect(() => encryptPasswordRSA('pw', 'not-a-valid-key')).toThrow(AuthError);
  });
});
