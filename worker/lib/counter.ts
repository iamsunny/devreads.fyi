export interface Env {
  VISIT_COUNTER: DurableObjectNamespace;
  COUNTER_MODE: "production" | "local" | "disabled";
  LOCAL_ORIGIN?: string;
}

export const OBJECT_NAME = "devreads.fyi";
const PRODUCTION_ORIGIN = "https://devreads.fyi";
const BOT = /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|facebot|headlesschrome|lighthouse|pagespeed|whatsapp|telegrambot|discordbot|twitterbot|linkedinbot|pinterest|uptimerobot|pingdom|monitoring/i;
const ASSET = /\.(?:avif|bmp|css|csv|eot|gif|ico|jpe?g|js|json|map|mjs|mp3|mp4|ogg|otf|pdf|png|rss|svg|txt|wasm|webm|webmanifest|webp|woff2?|xml|zip)$/i;

export function allowedOrigin(env: Env): string | null {
  if (env.COUNTER_MODE === "production") return PRODUCTION_ORIGIN;
  if (env.COUNTER_MODE !== "local" || !env.LOCAL_ORIGIN) return null;
  try {
    const url = new URL(env.LOCAL_ORIGIN);
    if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && url.origin === env.LOCAL_ORIGIN) return url.origin;
  } catch { /* Invalid local configuration disables the counter. */ }
  return null;
}

export function shouldCount(request: Request, response: Response, env: Env): boolean {
  const url = new URL(request.url);
  if (url.origin !== allowedOrigin(env) || request.method !== "GET" || response.status !== 200) return false;
  if (!/^text\/html(?:\s*;|\s*$)/i.test(response.headers.get("Content-Type") ?? "")) return false;
  let pathname: string;
  try { pathname = decodeURIComponent(url.pathname); } catch { return false; }
  if (/^\/api\/visits(?:\/|$)/i.test(pathname) || /^\/(?:_astro|assets)(?:\/|$)/i.test(pathname) || ASSET.test(pathname)) return false;
  if (["Purpose", "Sec-Purpose", "X-Purpose", "X-Moz"].some(key => /prefetch|prerender/i.test(request.headers.get(key) ?? ""))) return false;
  return !BOT.test(request.headers.get("User-Agent") ?? "");
}

export function stub(env: Env): DurableObjectStub {
  return env.VISIT_COUNTER.get(env.VISIT_COUNTER.idFromName(OBJECT_NAME));
}

export async function recordVisit(env: Env): Promise<void> {
  try {
    const result = await stub(env).fetch("https://counter.internal/increment", { method: "POST" });
    if (!result.ok) throw new Error("Counter returned " + result.status);
  } catch (error) {
    console.error("[visit-counter] recording failed", error);
  }
}

function reply(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { "Cache-Control": "no-store", Vary: "Origin, Sec-Fetch-Site", ...headers } });
}

export async function readEndpoint(request: Request, env: Env, websocket = false): Promise<Response> {
  if (request.method !== "GET") return reply(405, { Allow: "GET" });
  const origin = allowedOrigin(env);
  if (!origin || new URL(request.url).origin !== origin) return reply(404);
  const suppliedOrigin = request.headers.get("Origin");
  const site = request.headers.get("Sec-Fetch-Site");
  if (websocket) {
    if (suppliedOrigin !== origin || (site !== null && site !== "same-origin")) return reply(403);
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return reply(426, { Upgrade: "websocket" });
  } else if ((suppliedOrigin !== null && suppliedOrigin !== origin) || site !== "same-origin") {
    return reply(403);
  }
  try {
    const response = await stub(env).fetch(new Request("https://counter.internal/" + (websocket ? "ws" : "total"), {
      headers: websocket ? { Upgrade: "websocket", Origin: origin } : {},
    }));
    if (websocket && response.status === 101) return response;
    if (!response.ok || websocket) throw new Error("Counter returned " + response.status);
    const body = await response.json() as { total?: unknown };
    if (!Number.isSafeInteger(body.total) || (body.total as number) < 0) throw new Error("Invalid counter snapshot");
    return Response.json({ total: body.total }, { headers: { "Cache-Control": "no-store", Vary: "Origin, Sec-Fetch-Site" } });
  } catch (error) {
    console.error("[visit-counter] read failed", error);
    return reply(503, { "Retry-After": "30" });
  }
}
