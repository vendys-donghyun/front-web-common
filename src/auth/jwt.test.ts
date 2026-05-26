import { describe, it, expect } from 'vitest';
import { isExpired } from './jwt';

const b64url = (obj: object): string =>
  btoa(JSON.stringify(obj))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const jwt = (payload: object) => `eyJhbGciOiJIUzI1NiJ9.${b64url(payload)}.sig`;

describe('isExpired', () => {
  it('exp가 미래면 false', () => {
    const token = jwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    expect(isExpired(token)).toBe(false);
  });

  it('exp가 과거면 true', () => {
    const token = jwt({ exp: Math.floor(Date.now() / 1000) - 60 });
    expect(isExpired(token)).toBe(true);
  });

  it('leewaySec 이내로 임박하면 true', () => {
    const token = jwt({ exp: Math.floor(Date.now() / 1000) + 20 });
    expect(isExpired(token, 30)).toBe(true);
    expect(isExpired(token, 10)).toBe(false);
  });

  it('exp가 없으면 false (만료 정보 없음)', () => {
    const token = jwt({});
    expect(isExpired(token)).toBe(false);
  });

  it('잘못된 토큰은 true (디코딩 실패 = 만료로 간주)', () => {
    expect(isExpired('not.a.jwt')).toBe(true);
    expect(isExpired('garbage')).toBe(true);
  });
});
