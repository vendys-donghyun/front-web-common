import type { InternalAxiosRequestConfig } from 'axios';

// axios 0.x(plain object) / 1.x(AxiosHeaders) 양쪽 호환 헤더 설정
export function setHeader(
  headers: InternalAxiosRequestConfig['headers'],
  name: string,
  value: string,
): void {
  if (!headers) return;
  const h = headers as { set?: (n: string, v: string) => void } & Record<string, string>;
  if (typeof h.set === 'function') {
    h.set(name, value);
  } else {
    h[name] = value;
  }
}
