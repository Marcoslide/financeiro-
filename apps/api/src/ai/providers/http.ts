/**
 * POST JSON para APIs externas de IA. Usa o fetch global do Node.
 * Se HTTPS_PROXY estiver definido (ambiente de execução com proxy de saída),
 * tenta rotear via undici ProxyAgent quando disponível; caso contrário faz a
 * chamada direta (egress direto em produção). Nunca loga o corpo (pode conter
 * a chave nos headers) nem o segredo.
 */
let proxyDispatcher: unknown = null;
let proxyResolved = false;

async function resolveProxyDispatcher(): Promise<unknown> {
  if (proxyResolved) return proxyDispatcher;
  proxyResolved = true;
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!proxy) return null;
  try {
    // undici é interno ao Node 22; import dinâmico opcional evita dependência dura.
    const dynImport = new Function('m', 'return import(m)') as (m: string) => Promise<{ ProxyAgent?: new (u: string) => unknown }>;
    const undici = await dynImport('undici');
    if (undici.ProxyAgent) proxyDispatcher = new undici.ProxyAgent(proxy);
  } catch {
    proxyDispatcher = null;
  }
  return proxyDispatcher;
}

export interface HttpJsonResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

export async function postJson(
  url: string,
  headers: Record<string, string>,
  payload: unknown,
  timeoutMs = 60_000,
): Promise<HttpJsonResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const dispatcher = await resolveProxyDispatcher();
    // `dispatcher` é aceito pelo fetch do Node (undici) mas não faz parte do lib.dom RequestInit.
    const init: Record<string, unknown> = {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(payload),
      signal: controller.signal,
    };
    if (dispatcher) init.dispatcher = dispatcher;
    const res = await fetch(url, init as RequestInit);
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* mantém texto cru */
    }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}
