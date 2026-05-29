import { describe, it, expect, vi } from 'vitest';
import { setHeader } from '../headers';

describe('setHeader', () => {
  it('axios 0.x: plain object 헤더에 키-값 할당', () => {
    const headers = {} as any;
    setHeader(headers, 'Authorization', 'Bearer x');
    expect(headers.Authorization).toBe('Bearer x');
  });

  it('axios 1.x: AxiosHeaders 같은 인스턴스(.set)면 set() 호출', () => {
    const set = vi.fn();
    setHeader({ set } as any, 'Authorization', 'Bearer y');
    expect(set).toHaveBeenCalledWith('Authorization', 'Bearer y');
  });

  it('null/undefined headers는 무시(가드)', () => {
    expect(() => setHeader(null as any, 'X', 'v')).not.toThrow();
    expect(() => setHeader(undefined as any, 'X', 'v')).not.toThrow();
  });
});
