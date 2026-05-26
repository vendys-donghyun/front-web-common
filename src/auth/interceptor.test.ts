import { describe, it, expect, vi } from 'vitest';
import { createAuthInterceptor } from './interceptor';

// 가짜 axios 인스턴스 — 인터셉터가 등록하는 핸들러를 캡처해서 외부에서 직접 트리거
function makeFakeAxios() {
  const handlers: { req?: any; resF?: any; resR?: any } = {};
  // axios(config) 호출 가능해야 함 (response 인터셉터 안에서 재시도 시 사용)
  const fake: any = vi.fn();
  fake.interceptors = {
    request: {
      use: vi.fn((h: any) => { handlers.req = h; return 100; }),
      eject: vi.fn(),
    },
    response: {
      use: vi.fn((onF: any, onR: any) => {
        handlers.resF = onF;
        handlers.resR = onR;
        return 200;
      }),
      eject: vi.fn(),
    },
  };
  return { axios: fake, handlers };
}

// 가짜 store — 필요한 메서드만 vi.fn으로 채움
function makeStore(overrides: Partial<{
  getAccessToken: () => string | null;
  getRefreshToken: () => string | null;
  setTokens: (t: any) => void;
  clear: () => void;
}> = {}) {
  return {
    getAccessToken: overrides.getAccessToken ?? (() => 'TOKEN'),
    getRefreshToken: overrides.getRefreshToken ?? (() => 'REFRESH'),
    setTokens: overrides.setTokens ?? vi.fn(),
    clear: overrides.clear ?? vi.fn(),
  };
}

// JWT 합성 — jwt.test.ts와 동일 패턴. 서명은 더미('sig')
function makeJwt(payload: object): string {
  const b64url = (obj: object): string =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `eyJhbGciOiJIUzI1NiJ9.${b64url(payload)}.sig`;
}

describe('createAuthInterceptor — 요청 인터셉터 (선제 갱신)', () => {
  it('만료 임박 토큰은 요청 전에 refresh 후 새 토큰으로 헤더 갱신', async () => {
    const { axios, handlers } = makeFakeAxios();
    const expiredJwt = makeJwt({ exp: Math.floor(Date.now() / 1000) - 60 });
    const store = makeStore({ getAccessToken: () => expiredJwt });
    const refresher = { run: vi.fn(async () => 'NEW_TOKEN') };

    createAuthInterceptor({ axios, store, refresher, onLogout: vi.fn() });

    const config: any = { headers: {} };
    await handlers.req(config);

    expect(refresher.run).toHaveBeenCalledTimes(1);
    expect(config.headers.Authorization).toBe('Bearer NEW_TOKEN');
  });

  it('만료 임박 + refresh 실패 시 onLogout 호출 + 요청 거부', async () => {
    const { axios, handlers } = makeFakeAxios();
    const expiredJwt = makeJwt({ exp: Math.floor(Date.now() / 1000) - 60 });
    const store = makeStore({ getAccessToken: () => expiredJwt });
    const refresher = { run: vi.fn(async () => { throw new Error('refresh fail'); }) };
    const onLogout = vi.fn();

    createAuthInterceptor({ axios, store, refresher, onLogout });

    const config: any = { headers: {} };
    await expect(handlers.req(config)).rejects.toThrow('Token refresh failed');
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('유효한 토큰은 refresh 안 부르고 그대로 Authorization 헤더 주입', async () => {
    const { axios, handlers } = makeFakeAxios();
    const validJwt = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    const store = makeStore({ getAccessToken: () => validJwt });
    const refresher = { run: vi.fn() };

    createAuthInterceptor({ axios, store, refresher, onLogout: vi.fn() });

    const config: any = { headers: {} };
    await handlers.req(config);

    expect(refresher.run).not.toHaveBeenCalled();
    expect(config.headers.Authorization).toBe(`Bearer ${validJwt}`);
  });

  it('토큰 없으면 헤더 안 박고 통과', async () => {
    const { axios, handlers } = makeFakeAxios();
    const store = makeStore({ getAccessToken: () => null });
    const refresher = { run: vi.fn() };

    createAuthInterceptor({ axios, store, refresher, onLogout: vi.fn() });

    const config: any = { headers: {} };
    const result = await handlers.req(config);

    expect(refresher.run).not.toHaveBeenCalled();
    expect(result.headers.Authorization).toBeUndefined();
  });

  it('onBeforeRequest가 있으면 헤더 주입 후 호출', async () => {
    const { axios, handlers } = makeFakeAxios();
    const validJwt = makeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    const store = makeStore({ getAccessToken: () => validJwt });
    const onBeforeRequest = vi.fn(async (c: any) => {
      c.headers['X-Custom'] = 'CUSTOM';
      return c;
    });

    createAuthInterceptor({
      axios,
      store,
      refresher: { run: vi.fn() },
      onLogout: vi.fn(),
      onBeforeRequest,
    });

    const config: any = { headers: {} };
    const result = await handlers.req(config);

    expect(onBeforeRequest).toHaveBeenCalledTimes(1);
    expect(result.headers.Authorization).toBe(`Bearer ${validJwt}`);
    expect(result.headers['X-Custom']).toBe('CUSTOM');
  });
});

describe('createAuthInterceptor — 응답 인터셉터 (401 retry)', () => {
  it('401 응답 시 refresh 후 새 토큰으로 원요청 1회 재시도', async () => {
    const { axios, handlers } = makeFakeAxios();
    const refresher = { run: vi.fn(async () => 'NEW_TOKEN') };

    createAuthInterceptor({ axios, store: makeStore(), refresher, onLogout: vi.fn() });

    const originalConfig: any = { headers: {}, url: '/api/foo' };
    const error401 = { config: originalConfig, response: { status: 401 } };
    axios.mockResolvedValueOnce({ data: 'retried' });

    const result = await handlers.resR(error401);

    expect(refresher.run).toHaveBeenCalledTimes(1);
    expect(originalConfig.headers.Authorization).toBe('Bearer NEW_TOKEN');
    expect(originalConfig._retry).toBe(true);
    expect(axios).toHaveBeenCalledWith(originalConfig);
    expect(result.data).toBe('retried');
  });

  it('401 외 응답(예: 500)은 refresh 안 부르고 그냥 reject', async () => {
    const { axios, handlers } = makeFakeAxios();
    const refresher = { run: vi.fn() };

    createAuthInterceptor({ axios, store: makeStore(), refresher, onLogout: vi.fn() });

    const error500 = { config: { headers: {} }, response: { status: 500 } };

    await expect(handlers.resR(error500)).rejects.toBe(error500);
    expect(refresher.run).not.toHaveBeenCalled();
  });

  it('이미 _retry=true 인 요청은 다시 refresh 안 부름 (무한루프 방지)', async () => {
    const { axios, handlers } = makeFakeAxios();
    const refresher = { run: vi.fn() };

    createAuthInterceptor({ axios, store: makeStore(), refresher, onLogout: vi.fn() });

    const error401Retried = {
      config: { headers: {}, _retry: true },
      response: { status: 401 },
    };

    await expect(handlers.resR(error401Retried)).rejects.toBe(error401Retried);
    expect(refresher.run).not.toHaveBeenCalled();
  });

  it('config 자체가 없는 에러는 그냥 reject (방어)', async () => {
    const { axios, handlers } = makeFakeAxios();
    const refresher = { run: vi.fn() };

    createAuthInterceptor({ axios, store: makeStore(), refresher, onLogout: vi.fn() });

    const errorNoConfig = { response: { status: 401 } };

    await expect(handlers.resR(errorNoConfig)).rejects.toBe(errorNoConfig);
    expect(refresher.run).not.toHaveBeenCalled();
  });

  it('401 + refresh 실패 시 onLogout 호출 + 원 거부 사유 전파', async () => {
    const { axios, handlers } = makeFakeAxios();
    const refreshErr = new Error('refresh fail');
    const refresher = { run: vi.fn(async () => { throw refreshErr; }) };
    const onLogout = vi.fn();

    createAuthInterceptor({ axios, store: makeStore(), refresher, onLogout });

    const error401 = { config: { headers: {} }, response: { status: 401 } };

    await expect(handlers.resR(error401)).rejects.toBe(refreshErr);
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(axios).not.toHaveBeenCalled();
  });
});

describe('createAuthInterceptor — eject', () => {
  it('eject() 호출 시 등록한 두 인터셉터 모두 해제', () => {
    const { axios, handlers } = makeFakeAxios();
    const interceptor = createAuthInterceptor({
      axios,
      store: makeStore(),
      refresher: { run: vi.fn() },
      onLogout: vi.fn(),
    });

    interceptor.eject();

    expect(axios.interceptors.request.eject).toHaveBeenCalledTimes(1);
    expect(axios.interceptors.response.eject).toHaveBeenCalledTimes(1);
    // 사용하지 않는 handlers 변수 ESLint 회피
    void handlers;
  });
});
