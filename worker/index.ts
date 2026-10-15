import { readEndpoint, recordVisit, shouldCount, type Env } from "./lib/counter.ts";
import { authEndpoint, AuthError, json, withCors, type AuthEnv } from './auth';
import { favoritesEndpoint } from './favorites';

export interface StaticEnv extends Env, AuthEnv {
  ASSETS: Fetcher;
}

/** Use assets.run_worker_first so navigation requests reach this handler. */
export default {
  async fetch(request: Request, env: StaticEnv, ctx: ExecutionContext): Promise<Response> {
    const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
    if (pathname.startsWith('/api/auth/') || pathname === '/api/auth' || pathname.startsWith('/api/favorites/') || pathname === '/api/favorites') {
      try {
        const response = pathname.startsWith('/api/auth') ? await authEndpoint(request, env) : await favoritesEndpoint(request, env);
        return withCors(response, request, env);
      } catch (error) {
        if (error instanceof AuthError) return withCors(json({error: error.message, code: error.code}, error.status), request, env);
        console.error('account_api_failed', { path: pathname });
        return withCors(json({ error: 'Account service is temporarily unavailable. Try again.' }, 503), request, env);
      }
    }
    if (pathname === '/saved') return Response.redirect(new URL('/favorites/' + new URL(request.url).search, request.url).href, 308);
    if (pathname === "/api/visits") return readEndpoint(request, env);
    if (pathname === "/api/visits/ws") return readEndpoint(request, env, true);
    if (pathname.startsWith("/api/visits/")) {
      return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    }

    const response = await env.ASSETS.fetch(request);
    if (shouldCount(request, response, env)) ctx.waitUntil(recordVisit(env));
    return response;
  },
  async scheduled(_event: ScheduledController, env: StaticEnv) {
    if (!env.AUTH_DB) return;
    const now = Date.now();
    await env.AUTH_DB.batch([
      env.AUTH_DB.prepare('DELETE FROM session WHERE expiresAt < ?').bind(now),
      env.AUTH_DB.prepare('DELETE FROM verification WHERE expiresAt < ?').bind(now),
      env.AUTH_DB.prepare('DELETE FROM firebase_deleted_user WHERE expiresAt < ?').bind(now),
    ]);
  },
} satisfies ExportedHandler<StaticEnv>;
