import { describe, it, expect, vi, beforeEach } from 'vitest';

// jsencrypt 모킹: 실제 RSA 연산 없이 통과
vi.mock('jsencrypt', () => {
  return {
    default: class {
      setPublicKey() {}
      encrypt() {
        return 'ENCRYPTED';
      }
    },
  };
});

// axios 모킹: instance per create() 호출. 모든 인스턴스 메서드는 vi.fn으로 외부에서 제어.
// 인스턴스는 callable (axios(config) 호출 가능 — 401 retry 시 사용)이며,
// 등록된 interceptor 핸들러는 인스턴스 자체에 _reqHandler / _resOnRejected로 캡처해
// 외부에서 직접 트리거할 수 있게 함.
const lastInstance = { current: null as any };
const allInstances: any[] = [];
vi.mock('axios', () => {
  const create = vi.fn(() => {
    const instance: any = vi.fn();
    instance.get = vi.fn();
    instance.post = vi.fn();
    instance.delete = vi.fn();
    instance._reqHandler = null;
    instance._resOnFulfilled = null;
    instance._resOnRejected = null;
    instance.interceptors = {
      request: {
        use: vi.fn((h: any) => { instance._reqHandler = h; return 1; }),
        eject: vi.fn(),
      },
      response: {
        use: vi.fn((onF: any, onR: any) => {
          instance._resOnFulfilled = onF;
          instance._resOnRejected = onR;
          return 2;
        }),
        eject: vi.fn(),
      },
    };
    lastInstance.current = instance;
    allInstances.push(instance);
    return instance;
  });
  return {
    default: { create },
    create,
  };
});

import { createAuth } from './createAuth';

const STORAGE_KEY = 'auth';

const seedStorage = (value: Record<string, unknown>) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
};

const baseOpts = () => ({
  clientId: 'C',
  clientSecret: 'S',
  xUserAgent: 'UA',
  kmsKeyId: 'kid',
  autoLogin: true as const, // localStorage
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  lastInstance.current = null;
  allInstances.length = 0;
});

describe('createAuth — 게터/저장', () => {
  it('저장된 토큰·account를 getAccessToken/getAccount/isAuthenticated이 반환', () => {
    seedStorage({
      accessToken: 'A',
      refreshToken: 'R',
      account: { guid: 'g', password: 'NONE', duplicated: false },
    });
    const auth = createAuth(baseOpts());
    expect(auth.getAccessToken()).toBe('A');
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.getAccount()).toEqual({ guid: 'g', password: 'NONE', duplicated: false });
  });

  it('저장이 없으면 게터들이 null/false', () => {
    const auth = createAuth(baseOpts());
    expect(auth.getAccessToken()).toBeNull();
    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.getAccount()).toBeNull();
  });
});

describe('createAuth.logout — 서버 폐기 + 클라이언트 정리', () => {
  it('토큰 있으면 DELETE /vendys/v1/token 호출 후 store.clear() + onLogout 실행', async () => {
    seedStorage({ accessToken: 'A', refreshToken: 'R' });
    const onLogout = vi.fn();
    const auth = createAuth({ ...baseOpts(), onLogout });

    // createAuth 내부에서 axios.create로 만든 마지막 인스턴스의 delete를 제어
    lastInstance.current.delete.mockResolvedValue({ data: {} });

    await auth.logout();

    expect(lastInstance.current.delete).toHaveBeenCalledWith(
      '/vendys/v1/token',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer A' }),
      }),
    );
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('토큰 없으면 DELETE 호출 생략, 정리·콜백만 수행', async () => {
    const onLogout = vi.fn();
    const auth = createAuth({ ...baseOpts(), onLogout });

    await auth.logout();

    expect(lastInstance.current.delete).not.toHaveBeenCalled();
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('DELETE 실패해도 store.clear() + onLogout 수행 (best-effort)', async () => {
    seedStorage({ accessToken: 'A', refreshToken: 'R' });
    const onLogout = vi.fn();
    const auth = createAuth({ ...baseOpts(), onLogout });

    lastInstance.current.delete.mockRejectedValue(new Error('network'));

    await auth.logout(); // throw 안 함

    expect(lastInstance.current.delete).toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});

describe('createAuth — refresh 흐름에서 account 보존 (Part 1 핵심 deliverable)', () => {
  it('refresh 응답이 토큰만 줘도 storage의 account가 그대로 유지됨', async () => {
    // 시드: 기존 토큰 + account
    seedStorage({
      accessToken: 'OLD',
      refreshToken: 'OLD_R',
      account: { guid: 'g1', password: 'NONE', duplicated: false },
    });

    const auth = createAuth(baseOpts());
    // allInstances[0] = 라이브러리 내부 authServerClient (login/refresh/logout용)
    const authServer = allInstances[0];

    // 별도 사용자 client 만들어 installAuth — allInstances[1]가 됨
    const axiosMod = await import('axios');
    const userClient: any = axiosMod.default.create({});
    auth.installAuth(userClient);

    // refresh 응답 모킹: 새 토큰만 반환 (account 없음 — 실제 백엔드 v1/refresh-token 동작 그대로)
    authServer.post.mockResolvedValue({
      data: { accessToken: 'NEW', refreshToken: 'NEW_R' },
    });

    // userClient의 응답 인터셉터에 401 에러 던지기 → 라이브러리가 refresh 트리거
    const originalConfig: any = { headers: {}, url: '/api/business' };
    userClient.mockResolvedValueOnce({ data: 'retried' });

    await userClient._resOnRejected({
      config: originalConfig,
      response: { status: 401 },
    });

    // 검증: storage에 새 토큰 + 기존 account 그대로
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.accessToken).toBe('NEW');
    expect(stored.refreshToken).toBe('NEW_R');
    expect(stored.account).toEqual({ guid: 'g1', password: 'NONE', duplicated: false });

    // 게터로도 확인
    expect(auth.getAccessToken()).toBe('NEW');
    expect(auth.getAccount()).toEqual({ guid: 'g1', password: 'NONE', duplicated: false });
  });

  it('setAccount로 account 갱신 후 refresh 일어나도 갱신된 account가 유지됨', async () => {
    // 시드: 강제 비번변경 상태로 시작
    seedStorage({
      accessToken: 'A',
      refreshToken: 'R',
      account: { guid: 'g1', password: 'FORCE', duplicated: false },
    });

    const auth = createAuth(baseOpts());
    const authServer = allInstances[0];

    // 비번 변경 완료 시뮬: password 'NONE'으로 갱신
    auth.setAccount({ guid: 'g1', password: 'NONE', duplicated: false });
    expect(auth.getAccount()).toEqual({ guid: 'g1', password: 'NONE', duplicated: false });

    // 이후 refresh 발생
    const axiosMod = await import('axios');
    const userClient: any = axiosMod.default.create({});
    auth.installAuth(userClient);

    authServer.post.mockResolvedValue({
      data: { accessToken: 'A2', refreshToken: 'R2' },
    });
    userClient.mockResolvedValueOnce({ data: 'retried' });

    await userClient._resOnRejected({
      config: { headers: {}, url: '/api/x' },
      response: { status: 401 },
    });

    // 갱신된 password='NONE'이 보존됨 (FORCE로 돌아가지 않음)
    expect(auth.getAccount()).toEqual({ guid: 'g1', password: 'NONE', duplicated: false });
  });
});
