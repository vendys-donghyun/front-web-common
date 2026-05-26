import { jwtDecode } from 'jwt-decode';
import type { JwtPayload } from './types';

// JWT 디코딩 (내부 전용 — isExpired만 사용)
function decodeJwt(token: string): JwtPayload {
  return jwtDecode<JwtPayload>(token);
}

// 토큰 만료 여부 — leewaySec(초)만큼 앞당겨 판단 (만료 임박 선제 갱신용)
export function isExpired(token: string, leewaySec = 0): boolean {
  try {
    const { exp } = decodeJwt(token);
    if (typeof exp !== 'number') return false;
    const now = Math.floor(Date.now() / 1000);
    return exp - leewaySec <= now;
  } catch {
    return true;  // 디코딩 실패 = 유효하지 않은 토큰으로 간주
  }
}
