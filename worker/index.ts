import { readEndpoint, recordVisit, shouldCount, type Env } from "./lib/counter.ts";

export interface StaticEnv extends Env {
  ASSETS: Fetcher;
}

/** Use assets.run_worker_first so navigation requests reach this handler. */
export default {
  async fetch(request: Request, env: StaticEnv, ctx: ExecutionContext): Promise<Response> {
    const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
    if (pathname === "/api/visits") return readEndpoint(request, env);
    if (pathname === "/api/visits/ws") return readEndpoint(request, env, true);
    if (pathname.startsWith("/api/visits/")) {
      return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    }

    const response = await env.ASSETS.fetch(request);
    if (shouldCount(request, response, env)) ctx.waitUntil(recordVisit(env));
    return response;
  },
} satisfies ExportedHandler<StaticEnv>;
