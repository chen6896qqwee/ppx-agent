// web/src/lib/api.ts - 皮皮虾 HTTP API 客户端
// 所有请求经 /api/*; 默认端口 8899 (可在 .env 改 PPX_API_BASE)
// 鉴权: 优先用 localStorage 里的 token (用户从控制台日志复制粘贴);
//       未设置则不发送 Authorization 头 (后端默认 auth_token="" 时无需鉴权)

const DEFAULT_BASE = "http://127.0.0.1:8899";

export function getApiBase(): string {
  if (typeof window !== "undefined") {
    const w = window as unknown as { __PPX_API_BASE__?: string };
    if (w.__PPX_API_BASE__) return w.__PPX_API_BASE__;
  }
  return DEFAULT_BASE;
}

export function getAuthToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("ppx_auth_token") || "";
}

export function setAuthToken(t: string) {
  if (typeof window === "undefined") return;
  if (t) localStorage.setItem("ppx_auth_token", t);
  else localStorage.removeItem("ppx_auth_token");
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const base = getApiBase();
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(opts.headers as Record<string, string>) };
  const tok = getAuthToken();
  if (tok) headers["Authorization"] = `Bearer ${tok}`;
  const r = await fetch(base + path, { ...opts, headers });
  const text = await r.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    const msg = (data && typeof data === "object" && "error" in data) ? String((data as { error: unknown }).error) : `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return data as T;
}

// ---- 提供方类型 ----
export type Provider = {
  id: string;
  backend?: string;
  base_url?: string;
  model?: string;
  vision?: boolean;
  timeout_ms?: number;
  api_key?: string;
  api_key_env?: string;
  api_key_set?: boolean;
  mjs?: string;
  session_key?: string;
  dsh_root?: string;
};

export type ProvidersResponse = {
  providers: Provider[];
  default_id: string | null;
};

export async function listProviders(): Promise<ProvidersResponse> {
  return request<ProvidersResponse>("/api/providers");
}

export async function addProvider(provider: Partial<Provider>): Promise<{ ok: boolean; provider: Provider }> {
  return request("/api/providers", { method: "POST", body: JSON.stringify({ provider }) });
}

export async function updateProvider(id: string, patch: Partial<Provider>): Promise<{ ok: boolean; provider: Provider }> {
  return request("/api/providers", { method: "PUT", body: JSON.stringify({ id, patch }) });
}

export async function deleteProvider(id: string): Promise<{ ok: boolean; provider: Provider }> {
  return request("/api/providers", { method: "DELETE", body: JSON.stringify({ id }) });
}

export async function testProvider(id: string): Promise<{ ok: boolean; healthy: boolean; detail: string; source: string }> {
  return request("/api/providers/test", { method: "POST", body: JSON.stringify({ id }) });
}

export async function reorderProviders(order: string[]): Promise<{ ok: boolean; providers: Provider[] }> {
  return request("/api/providers/reorder", { method: "POST", body: JSON.stringify({ order }) });
}

// ---- 健康检查 ----
export async function pingHealth(): Promise<{ status: string; agent: string }> {
  return request("/health");
}