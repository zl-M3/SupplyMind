/**
 * HTTP 客户端（真实后端）
 *
 * 后端：FastAPI，前缀 /api/v1，Bearer Token 认证。
 * 开发环境通过 Vite 代理把 /api 转发到 127.0.0.1:8000，因此同源、无 CORS 问题。
 */

const BASE = '/api/v1';
const TOKEN_KEY = 'sm_token';

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setToken(token: string) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 隐私模式下忽略 */
  }
}

export function clearToken() {
  setToken('');
}

export interface ApiError extends Error {
  status: number;
  code?: string;
}

function toError(status: number, code: string, message: string): ApiError {
  const err = new Error(message) as ApiError;
  err.status = status;
  err.code = code;
  return err;
}

interface RequestOptions {
  query?: Record<string, unknown>;
  body?: unknown;
  signal?: AbortSignal;
}

/* ---- 后端连通性事件：让界面能提示"看到的是旧数据"而不是悄悄失败 ---- */

const API_ERROR_EVENT = 'sm:api-error';
const API_OK_EVENT = 'sm:api-ok';

function emitApiError(message: string) {
  try {
    window.dispatchEvent(new CustomEvent(API_ERROR_EVENT, { detail: { message } }));
  } catch {
    /* 非浏览器环境忽略 */
  }
}

function emitApiOk() {
  try {
    window.dispatchEvent(new Event(API_OK_EVENT));
  } catch {
    /* 非浏览器环境忽略 */
  }
}

function buildUrl(path: string, query?: Record<string, unknown>) {
  const url = new URL(BASE + path, window.location.origin);
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v === undefined || v === null || v === '') return;
      if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, String(item)));
      else url.searchParams.set(k, String(v));
    });
  }
  return url.pathname + url.search;
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
      // 业务数据必须每次取最新的：禁止浏览器/代理缓存 GET 响应
      // （数据库里改了数据但页面不刷新，最常见的原因就是这里被缓存了）
      cache: 'no-store',
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    // 后端没起 / 端口不对 / 网络断开：明确告诉界面，避免一直显示旧数据
    emitApiError(e instanceof Error ? e.message : '网络异常');
    throw toError(
      0,
      'NETWORK_ERROR',
      `无法连接后端接口（${BASE}）。请确认 FastAPI 已在 127.0.0.1:8000 启动，当前页面显示的是上一次的数据。`,
    );
  }

  emitApiOk();

  if (res.status === 401) {
    clearToken();
  }

  if (!res.ok) {
    let code = String(res.status);
    let message = `请求失败（HTTP ${res.status}）`;
    try {
      const data = await res.json();
      if (data?.code) code = String(data.code);
      if (data?.message) message = String(data.message);
      else if (data?.detail) {
        message =
          typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail).slice(0, 200);
      }
    } catch {
      /* 响应体不是 JSON */
    }
    throw toError(res.status, code, message);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const http = {
  get: <T>(path: string, query?: Record<string, unknown>) => request<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown, query?: Record<string, unknown>) =>
    request<T>('POST', path, { body, query }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body?: unknown, query?: Record<string, unknown>) =>
    request<T>('PATCH', path, { body, query }),
  del: <T>(path: string, query?: Record<string, unknown>) => request<T>('DELETE', path, { query }),
};
