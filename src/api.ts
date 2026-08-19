import { evaluateAutomation } from './automation';
import { DEFAULT_SETTINGS } from './defaults';
import {
  cleanupSessions, createSession, deleteSession, getActuatorState, getLastEvaluation, getLatestSnapshot, getMeta,
  getSecrets, getSession, getSettings, isSetupComplete, listEvents, listSnapshots, logEvent, recordActuatorState, runtimeMinutesSince,
  saveEvaluation, saveSecrets, saveSettings, saveSnapshot, setMeta
} from './db';
import { buildHueAuthorizationUrl, exchangeHueCode, listHueDevices, refreshHueToken, setHuePower, type HueEnv } from './hue';
import { fetchSolarEdge } from './solaredge';
import { hashPassword, randomToken, secureEqual, securityHeaders, sha256, verifyPassword } from './security';
import { partsInTimezone, startOfLocalDayIso } from './time';
import type { DashboardData, EvaluationResult, SecretSettings, Settings, SolarSnapshot, WeatherSnapshot } from './types';
import { fetchWeather } from './weather';

const COOKIE = 'pec_session';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

type AppEnv = Env & HueEnv;

function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = securityHeaders(new Headers(extraHeaders));
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data), { status, headers });
}

function getCookie(request: Request, name: string): string | null {
  const raw = request.headers.get('Cookie') ?? '';
  for (const part of raw.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

async function parseJson<T>(request: Request): Promise<T> {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 64_000) throw new Error('Request body too large');
  return await request.json() as T;
}

async function authSession(request: Request, env: AppEnv): Promise<{ token: string; csrfToken: string } | null> {
  const token = getCookie(request, COOKIE);
  if (!token) return null;
  const session = await getSession(env.DB, token);
  return session ? { token, csrfToken: session.csrfToken } : null;
}

async function requireAuth(request: Request, env: AppEnv, requireCsrf = false): Promise<{ token: string; csrfToken: string } | Response> {
  const session = await authSession(request, env);
  if (!session) return json({ error: 'Nicht angemeldet' }, 401);
  if (requireCsrf && request.headers.get('x-csrf-token') !== session.csrfToken) return json({ error: 'Ungültiger CSRF-Token' }, 403);
  return session;
}

function isResponse(value: unknown): value is Response { return value instanceof Response; }

function validateSettings(input: unknown, current: Settings): Settings {
  if (!input || typeof input !== 'object') throw new Error('Ungültige Einstellungen');
  const body = input as Partial<Settings>;
  const next: Settings = { ...current, ...body };
  if (!Number.isFinite(next.latitude) || next.latitude < -90 || next.latitude > 90) throw new Error('Ungültiger Breitengrad');
  if (!Number.isFinite(next.longitude) || next.longitude < -180 || next.longitude > 180) throw new Error('Ungültiger Längengrad');
  if (!/^([01]\d|2[0-3]):(00|15|30|45)$/.test(next.checkTime)) throw new Error('Prüfzeit muss auf 00/15/30/45 Minuten liegen');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(next.offAfterTime)) throw new Error('Ungültige Abschaltzeit');
  if (!['AUTO', 'MANUAL_ON', 'MANUAL_OFF'].includes(next.mode)) throw new Error('Ungültiger Modus');
  if (!['AND', 'OR'].includes(next.ruleJoiner)) throw new Error('Ungültige Regelverknüpfung');
  if (!Array.isArray(next.rules) || next.rules.length > 20) throw new Error('Ungültige Regeln');
  for (const rule of next.rules) {
    if (!rule.id || !rule.label || !['>', '>=', '<', '<='].includes(rule.operator) || !Number.isFinite(rule.threshold)) throw new Error('Ungültige Regel');
  }
  for (const value of [next.minRunMinutes, next.minOffMinutes, next.maxDailyRuntimeMinutes, next.offDelayMinutes]) {
    if (!Number.isFinite(value) || value < 0 || value > 24 * 60) throw new Error('Ungültige Laufzeit-Einstellung');
  }
  if (!Number.isFinite(next.panelKwp) || next.panelKwp < 0 || next.panelKwp > 1000) throw new Error('Ungültige Anlagenleistung');
  if (!Number.isFinite(next.panelTilt) || next.panelTilt < 0 || next.panelTilt > 90) throw new Error('Ungültige Dachneigung');
  if (!Number.isFinite(next.panelAzimuth) || next.panelAzimuth < -180 || next.panelAzimuth > 180) throw new Error('Ungültige Ausrichtung');
  if (!Number.isFinite(next.performanceRatio) || next.performanceRatio < 0.5 || next.performanceRatio > 1) throw new Error('Performance Ratio muss zwischen 0,5 und 1 liegen');
  return next;
}

async function checkLoginRateLimit(request: Request, env: AppEnv): Promise<{ allowed: boolean; ipHash: string }> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const ipHash = await sha256(`${env.SESSION_SECRET}:${ip}`);
  await env.DB.prepare("DELETE FROM login_attempts WHERE created_at < datetime('now','-15 minutes')").run();
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM login_attempts WHERE ip_hash = ? AND created_at >= datetime('now','-15 minutes')").bind(ipHash).first<{ count: number }>();
  return { allowed: (row?.count ?? 0) < 5, ipHash };
}

async function createLoggedInSession(env: AppEnv): Promise<{ token: string; csrf: string; cookie: string }> {
  const token = randomToken();
  const csrf = randomToken(24);
  const expires = new Date(Date.now() + SESSION_MS);
  await createSession(env.DB, token, csrf, expires.toISOString());
  return { token, csrf, cookie: `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(SESSION_MS / 1000)}` };
}

async function getFreshWeather(env: AppEnv, settings: Settings, force = false): Promise<WeatherSnapshot> {
  const latest = await getLatestSnapshot<WeatherSnapshot>(env.DB, 'weather');
  if (!force && latest && Date.now() - new Date(latest.fetchedAt).getTime() < 45 * 60_000) return latest;
  const weather = await fetchWeather(settings.latitude, settings.longitude, settings.timezone, settings.panelTilt, settings.panelAzimuth, settings.panelKwp, settings.performanceRatio);
  await saveSnapshot(env.DB, 'weather', weather);
  await setMeta(env.DB, 'health_weather', JSON.stringify({ ok: true, message: 'Wetterdienst erreichbar', updatedAt: weather.fetchedAt }));
  return weather;
}

async function getFreshSolar(env: AppEnv, settings: Settings, secrets: SecretSettings): Promise<SolarSnapshot | null> {
  if (!settings.solarEdgeSiteId || !secrets.solarEdgeApiKey) return null;
  const solar = await fetchSolarEdge(settings.solarEdgeSiteId, secrets.solarEdgeApiKey);
  await saveSnapshot(env.DB, 'solar', solar);
  await setMeta(env.DB, 'health_solar', JSON.stringify({ ok: true, message: 'SolarEdge erreichbar', updatedAt: solar.fetchedAt }));
  return solar;
}

async function ensureHueSecrets(env: AppEnv, secrets: SecretSettings): Promise<SecretSettings> {
  if (!secrets.hueAccessToken || !secrets.hueRefreshToken || !secrets.hueClientId || !secrets.hueClientSecret) return secrets;
  const expiresAt = secrets.hueAccessTokenExpiresAt ? new Date(secrets.hueAccessTokenExpiresAt).getTime() : Number.POSITIVE_INFINITY;
  if (expiresAt - Date.now() > 5 * 60_000) return secrets;
  const refreshed = await refreshHueToken(env, secrets.hueRefreshToken, secrets.hueClientId, secrets.hueClientSecret);
  const merged = { ...secrets, ...refreshed };
  await saveSecrets(env.DB, merged, env.APP_ENCRYPTION_KEY);
  return merged;
}

async function getHueState(env: AppEnv, settings: Settings, secretsInput: SecretSettings): Promise<{ on: boolean | null; connected: boolean; name: string; secrets: SecretSettings }> {
  const secrets = await ensureHueSecrets(env, secretsInput);
  if (!secrets.hueAccessToken || !secrets.hueUsername || !settings.hueResourceId) return { on: null, connected: false, name: settings.hueResourceName || 'Nicht eingerichtet', secrets };
  try {
    const devices = await listHueDevices(env, secrets.hueAccessToken, secrets.hueUsername);
    const selected = devices.find((device) => device.id === settings.hueResourceId);
    if (!selected) return { on: null, connected: false, name: settings.hueResourceName || 'Gerät nicht gefunden', secrets };
    await setMeta(env.DB, 'health_hue', JSON.stringify({ ok: true, message: 'Hue Remote API erreichbar', updatedAt: new Date().toISOString() }));
    return { on: selected.on, connected: true, name: selected.name, secrets };
  } catch (error) {
    await setMeta(env.DB, 'health_hue', JSON.stringify({ ok: false, message: error instanceof Error ? error.message : 'Hue-Fehler', updatedAt: new Date().toISOString() }));
    return { on: null, connected: false, name: settings.hueResourceName || 'Hue', secrets };
  }
}

async function sustainedOffConditionMinutes(env: AppEnv, settings: Settings, solar: SolarSnapshot | null, now: Date): Promise<number> {
  const gridTooHigh = settings.maxGridImportKw !== null && solar?.gridImportKw !== null && solar?.gridImportKw !== undefined && solar.gridImportKw > settings.maxGridImportKw;
  const surplusTooLow = settings.lowSurplusThresholdKw !== null && solar?.pvSurplusKw !== null && solar?.pvSurplusKw !== undefined && solar.pvSurplusKw < settings.lowSurplusThresholdKw;
  if (!gridTooHigh && !surplusTooLow) { await setMeta(env.DB, 'off_condition_since', ''); return 0; }
  let since = await getMeta(env.DB, 'off_condition_since');
  if (!since) { since = now.toISOString(); await setMeta(env.DB, 'off_condition_since', since); return 0; }
  return Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / 60_000));
}

export async function runAutomation(env: AppEnv, options: { simulation?: boolean; forceWeather?: boolean; simulationSolar?: SolarSnapshot | null; simulationWeather?: WeatherSnapshot | null } = {}): Promise<EvaluationResult> {
  const settings = await getSettings(env.DB);
  let secrets = await getSecrets(env.DB, env.APP_ENCRYPTION_KEY);
  const now = new Date();
  let weather: WeatherSnapshot | null = options.simulationWeather ?? null;
  let solar: SolarSnapshot | null = options.simulationSolar ?? null;
  if (!options.simulation) {
    try { weather = await getFreshWeather(env, settings, options.forceWeather ?? false); }
    catch (error) {
      await setMeta(env.DB, 'health_weather', JSON.stringify({ ok: false, message: error instanceof Error ? error.message : 'Wetterfehler', updatedAt: now.toISOString() }));
      await logEvent(env.DB, 'error', 'Wetterdaten konnten nicht geladen werden', { error: String(error) });
    }
    try { solar = await getFreshSolar(env, settings, secrets); }
    catch (error) {
      await setMeta(env.DB, 'health_solar', JSON.stringify({ ok: false, message: error instanceof Error ? error.message : 'SolarEdge-Fehler', updatedAt: now.toISOString() }));
      await logEvent(env.DB, 'error', 'SolarEdge-Daten konnten nicht geladen werden', { error: String(error) });
    }
  }

  const localDayStart = startOfLocalDayIso(now, settings.timezone);
  const dailyRuntimeMinutes = await runtimeMinutesSince(env.DB, localDayStart, now);
  let currentState = await getActuatorState(env.DB);
  if (!options.simulation) {
    const hue = await getHueState(env, settings, secrets);
    secrets = hue.secrets;
    if (hue.on !== null) currentState = { on: hue.on, changedAt: currentState.changedAt };
  }
  const offConditionMinutes = await sustainedOffConditionMinutes(env, settings, solar, now);
  let result = evaluateAutomation({ settings, solar, weather, currentOn: currentState.on, lastChangedAt: currentState.changedAt, dailyRuntimeMinutes, now, simulation: options.simulation, sustainedOffConditionMinutes: offConditionMinutes });

  if (!options.simulation && (result.action === 'ON' || result.action === 'OFF')) {
    if (!settings.hueResourceId || !secrets.hueAccessToken || !secrets.hueUsername) {
      result = { ...result, action: 'BLOCKED', reason: `${result.reason} Hue ist noch nicht vollständig eingerichtet; es wurde nicht geschaltet.` };
    } else {
      try {
        await setHuePower(env, secrets.hueAccessToken, secrets.hueUsername, settings.hueResourceId, result.action === 'ON');
        await recordActuatorState(env.DB, result.action === 'ON', 'automation', result.reason);
        await logEvent(env.DB, 'hue', `Wärmepumpe ${result.action === 'ON' ? 'EIN' : 'AUS'}`, { reason: result.reason });
      } catch (error) {
        result = { ...result, action: 'BLOCKED', reason: `${result.reason} Hue-Schaltbefehl ist fehlgeschlagen.` };
        await logEvent(env.DB, 'error', 'Hue-Schaltbefehl fehlgeschlagen', { error: String(error) });
      }
    }
  }
  await saveEvaluation(env.DB, result);
  return result;
}

async function getHealth(env: AppEnv): Promise<Record<string, { ok: boolean; message: string; updatedAt?: string }>> {
  const parse = async (key: string, fallback: { ok: boolean; message: string }) => {
    const raw = await getMeta(env.DB, key);
    return raw ? JSON.parse(raw) as { ok: boolean; message: string; updatedAt?: string } : fallback;
  };
  return {
    database: { ok: true, message: 'D1 verfügbar', updatedAt: new Date().toISOString() },
    scheduler: { ok: true, message: 'Cloudflare Cron alle 15 Minuten' },
    solarEdge: await parse('health_solar', { ok: false, message: 'Noch nicht geprüft' }),
    weather: await parse('health_weather', { ok: false, message: 'Noch nicht geprüft' }),
    hue: await parse('health_hue', { ok: false, message: 'Noch nicht geprüft' })
  };
}

async function dashboard(env: AppEnv, authenticated: boolean): Promise<DashboardData> {
  const setupComplete = await isSetupComplete(env.DB);
  if (!authenticated) return { setupComplete, authenticated: false };
  const settings = await getSettings(env.DB);
  const secrets = await getSecrets(env.DB, env.APP_ENCRYPTION_KEY);
  const hue = await getHueState(env, settings, secrets);
  return {
    setupComplete, authenticated: true, settings,
    solar: await getLatestSnapshot<SolarSnapshot>(env.DB, 'solar'),
    weather: await getLatestSnapshot<WeatherSnapshot>(env.DB, 'weather'),
    lastEvaluation: await getLastEvaluation(env.DB),
    hue: { connected: hue.connected, on: hue.on, name: hue.name },
    health: await getHealth(env),
    dailyRuntimeMinutes: await runtimeMinutesSince(env.DB, startOfLocalDayIso(new Date(), settings.timezone))
  };
}

async function manualSwitch(env: AppEnv, on: boolean, reason: string): Promise<void> {
  const settings = await getSettings(env.DB);
  let secrets = await getSecrets(env.DB, env.APP_ENCRYPTION_KEY);
  secrets = await ensureHueSecrets(env, secrets);
  if (!settings.hueResourceId || !secrets.hueAccessToken || !secrets.hueUsername) throw new Error('Hue ist nicht vollständig eingerichtet');
  await setHuePower(env, secrets.hueAccessToken, secrets.hueUsername, settings.hueResourceId, on);
  await recordActuatorState(env.DB, on, 'manual', reason);
  await logEvent(env.DB, 'manual', `Wärmepumpe manuell ${on ? 'EIN' : 'AUS'}`, { reason });
}

export async function handleApi(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (url.pathname === '/api/bootstrap' && request.method === 'GET') {
      const session = await authSession(request, env);
      return json({ ...(await dashboard(env, Boolean(session))), csrfToken: session?.csrfToken ?? null });
    }

    if (url.pathname === '/api/setup' && request.method === 'POST') {
      if (await isSetupComplete(env.DB)) return json({ error: 'Setup bereits abgeschlossen' }, 409);
      const body = await parseJson<{ setupToken?: string; password?: string }>(request);
      if (!body.setupToken || !(await secureEqual(body.setupToken, env.SETUP_TOKEN))) return json({ error: 'Ungültiger Setup-Token' }, 403);
      if (!body.password || body.password.length < 10) return json({ error: 'Passwort muss mindestens 10 Zeichen lang sein' }, 400);
      await setMeta(env.DB, 'admin_password_hash', await hashPassword(body.password));
      await saveSettings(env.DB, DEFAULT_SETTINGS);
      await logEvent(env.DB, 'security', 'Ersteinrichtung abgeschlossen');
      const session = await createLoggedInSession(env);
      return json({ ok: true, csrfToken: session.csrf }, 201, { 'Set-Cookie': session.cookie });
    }

    if (url.pathname === '/api/login' && request.method === 'POST') {
      const rate = await checkLoginRateLimit(request, env);
      if (!rate.allowed) return json({ error: 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.' }, 429);
      const body = await parseJson<{ password?: string }>(request);
      const hash = await getMeta(env.DB, 'admin_password_hash');
      const valid = Boolean(hash && body.password && await verifyPassword(body.password, hash));
      if (!valid) {
        await env.DB.prepare('INSERT INTO login_attempts(ip_hash) VALUES(?)').bind(rate.ipHash).run();
        return json({ error: 'Anmeldung fehlgeschlagen' }, 401);
      }
      await env.DB.prepare('DELETE FROM login_attempts WHERE ip_hash = ?').bind(rate.ipHash).run();
      const session = await createLoggedInSession(env);
      return json({ ok: true, csrfToken: session.csrf }, 200, { 'Set-Cookie': session.cookie });
    }

    if (url.pathname === '/api/logout' && request.method === 'POST') {
      const auth = await requireAuth(request, env, true); if (isResponse(auth)) return auth;
      await deleteSession(env.DB, auth.token);
      return json({ ok: true }, 200, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
    }

    if (url.pathname === '/oauth/hue/callback' && request.method === 'GET') {
      const auth = await requireAuth(request, env, false); if (isResponse(auth)) return auth;
      const state = url.searchParams.get('state'); const code = url.searchParams.get('code');
      const storedRaw = await getMeta(env.DB, 'hue_oauth_state');
      const stored = storedRaw ? JSON.parse(storedRaw) as { state: string; sessionHash: string; expiresAt: string; redirectUri: string } : null;
      if (!state || !code || !stored || new Date(stored.expiresAt).getTime() < Date.now() || !(await secureEqual(state, stored.state)) || !(await secureEqual(await sha256(auth.token), stored.sessionHash))) return json({ error: 'Ungültiger oder abgelaufener Hue OAuth-Callback' }, 400);
      const secrets = await getSecrets(env.DB, env.APP_ENCRYPTION_KEY);
      if (!secrets.hueClientId || !secrets.hueClientSecret) return json({ error: 'Hue Client-Zugangsdaten fehlen' }, 400);
      const tokens = await exchangeHueCode(env, code, stored.redirectUri, secrets.hueClientId, secrets.hueClientSecret);
      await saveSecrets(env.DB, { ...secrets, ...tokens }, env.APP_ENCRYPTION_KEY);
      await setMeta(env.DB, 'hue_oauth_state', '');
      await logEvent(env.DB, 'hue', 'Hue Remote API verbunden');
      return Response.redirect(new URL('/?hue=connected', request.url).toString(), 302);
    }

    const auth = await requireAuth(request, env, ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method));
    if (isResponse(auth)) return auth;

    if (url.pathname === '/api/dashboard' && request.method === 'GET') return json(await dashboard(env, true));
    if (url.pathname === '/api/history' && request.method === 'GET') return json({ events: await listEvents(env.DB, Number(url.searchParams.get('limit') ?? 100)) });
    if (url.pathname === '/api/charts' && request.method === 'GET') {
      const days = Math.max(1, Math.min(Number(url.searchParams.get('days') ?? 1), 30));
      const since = new Date(Date.now() - days * 24 * 60 * 60_000).toISOString();
      return json({ solar: await listSnapshots<SolarSnapshot>(env.DB, 'solar', since), weather: await listSnapshots<WeatherSnapshot>(env.DB, 'weather', since) });
    }
    if (url.pathname === '/api/settings' && request.method === 'GET') return json({ settings: await getSettings(env.DB) });

    if (url.pathname === '/api/settings' && request.method === 'PUT') {
      const current = await getSettings(env.DB);
      const body = await parseJson<{ settings?: unknown; secrets?: { solarEdgeApiKey?: string; hueClientId?: string; hueClientSecret?: string } }>(request);
      const next = validateSettings(body.settings, current);
      await saveSettings(env.DB, next);
      if (body.secrets) {
        const stored = await getSecrets(env.DB, env.APP_ENCRYPTION_KEY);
        const merged: SecretSettings = { ...stored };
        if (body.secrets.solarEdgeApiKey !== undefined && body.secrets.solarEdgeApiKey !== '') merged.solarEdgeApiKey = body.secrets.solarEdgeApiKey;
        if (body.secrets.hueClientId !== undefined && body.secrets.hueClientId !== '') merged.hueClientId = body.secrets.hueClientId;
        if (body.secrets.hueClientSecret !== undefined && body.secrets.hueClientSecret !== '') merged.hueClientSecret = body.secrets.hueClientSecret;
        await saveSecrets(env.DB, merged, env.APP_ENCRYPTION_KEY);
      }
      await logEvent(env.DB, 'settings', 'Einstellungen geändert');
      return json({ ok: true, settings: next });
    }

    if (url.pathname === '/api/test/solaredge' && request.method === 'POST') {
      const settings = await getSettings(env.DB); const secrets = await getSecrets(env.DB, env.APP_ENCRYPTION_KEY);
      if (!secrets.solarEdgeApiKey || !settings.solarEdgeSiteId) return json({ error: 'Site-ID oder API-Key fehlt' }, 400);
      const solar = await getFreshSolar(env, settings, secrets); return json({ ok: true, solar });
    }

    if (url.pathname === '/api/test/weather' && request.method === 'POST') {
      const settings = await getSettings(env.DB); const weather = await getFreshWeather(env, settings, true); return json({ ok: true, weather });
    }

    if (url.pathname === '/api/hue/oauth/start' && request.method === 'POST') {
      const secrets = await getSecrets(env.DB, env.APP_ENCRYPTION_KEY);
      if (!secrets.hueClientId || !secrets.hueClientSecret) return json({ error: 'Hue Client-ID und Client-Secret zuerst in Einstellungen speichern' }, 400);
      const state = randomToken(24); const redirectUri = `${url.origin}/oauth/hue/callback`;
      await setMeta(env.DB, 'hue_oauth_state', JSON.stringify({ state, sessionHash: await sha256(auth.token), expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), redirectUri }));
      return json({ authorizationUrl: buildHueAuthorizationUrl(env, secrets.hueClientId, redirectUri, state), redirectUri });
    }

    if (url.pathname === '/api/hue/devices' && request.method === 'GET') {
      let secrets = await getSecrets(env.DB, env.APP_ENCRYPTION_KEY); secrets = await ensureHueSecrets(env, secrets);
      if (!secrets.hueAccessToken || !secrets.hueUsername) return json({ error: 'Hue noch nicht verbunden' }, 400);
      return json({ devices: await listHueDevices(env, secrets.hueAccessToken, secrets.hueUsername) });
    }

    if (url.pathname === '/api/mode' && request.method === 'POST') {
      const body = await parseJson<{ mode?: Settings['mode']; manualMinutes?: number }>(request);
      if (!body.mode || !['AUTO', 'MANUAL_ON', 'MANUAL_OFF'].includes(body.mode)) return json({ error: 'Ungültiger Modus' }, 400);
      const settings = await getSettings(env.DB);
      settings.mode = body.mode;
      settings.manualUntil = body.mode === 'AUTO' || !body.manualMinutes ? null : new Date(Date.now() + Math.max(1, Math.min(body.manualMinutes, 1440)) * 60_000).toISOString();
      await saveSettings(env.DB, settings);
      if (body.mode === 'MANUAL_ON') await manualSwitch(env, true, 'Manueller Modus über Weboberfläche');
      if (body.mode === 'MANUAL_OFF') await manualSwitch(env, false, 'Manueller Modus über Weboberfläche');
      return json({ ok: true, settings });
    }

    if (url.pathname === '/api/automation/now' && request.method === 'POST') return json({ result: await runAutomation(env, { forceWeather: true }) });

    if (url.pathname === '/api/simulation' && request.method === 'POST') {
      const body = await parseJson<{ solar?: Partial<SolarSnapshot>; weather?: Partial<WeatherSnapshot> }>(request);
      const now = new Date().toISOString();
      const solar: SolarSnapshot = { fetchedAt: now, pvCurrentKw: 3.4, dailyEnergyKwh: 8.2, consumptionKw: 1.3, gridImportKw: 0, feedInKw: 2.1, batterySoc: 74, pvSurplusKw: 2.1, availableMetrics: ['pvCurrentKw','dailyEnergyKwh','consumptionKw','gridImportKw','feedInKw','batterySoc','pvSurplusKw'], ...body.solar };
      const weather: WeatherSnapshot = { fetchedAt: now, date: partsInTimezone(new Date(), 'Europe/Berlin').date, temperatureC: 24, weatherCode: 1, sunshineHours: 7, cloudCoverPct: 25, shortwaveRadiationMj: 18, tiltedIrradiationKwhM2: 5.3, sunrise: '06:05', sunset: '20:18', pvForecastKwh: 18, solarCondition: 'GOOD', ...body.weather };
      return json({ result: await runAutomation(env, { simulation: true, simulationSolar: solar, simulationWeather: weather }) });
    }

    return json({ error: 'API-Endpunkt nicht gefunden' }, 404);
  } catch (error) {
    await logEvent(env.DB, 'error', 'API-Fehler', { path: url.pathname, error: error instanceof Error ? error.message : String(error) });
    return json({ error: error instanceof Error ? error.message : 'Unbekannter Fehler' }, 500);
  }
}

export type { AppEnv };
