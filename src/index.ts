import { cleanupSessions, getSettings, logEvent, saveSettings } from './db';
import { handleApi, runAutomation, type AppEnv } from './api';
import { securityHeaders } from './security';

export default {
  async fetch(request: Request, env: AppEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/oauth/')) return handleApi(request, env);
    const response = await env.ASSETS.fetch(request);
    const headers = securityHeaders(new Headers(response.headers));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },

  async scheduled(_controller: ScheduledController, env: AppEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      await cleanupSessions(env.DB);
      const settings = await getSettings(env.DB);
      if (settings.manualUntil && new Date(settings.manualUntil).getTime() <= Date.now()) {
        settings.mode = 'AUTO'; settings.manualUntil = null; await saveSettings(env.DB, settings);
        await logEvent(env.DB, 'automation', 'Zeitlich begrenzter manueller Modus beendet; zurück auf AUTO');
      }
      await runAutomation(env);
    })());
  }
} satisfies ExportedHandler<AppEnv>;
