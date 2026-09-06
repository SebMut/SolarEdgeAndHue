import type { MetricName, SolarSnapshot } from './types';

export interface SolarEdgeSite {
  id: string;
  name: string;
  status?: string;
}

export interface SolarEdgeOAuthConfig {
  authorizationUrl: string;
  tokenUrl: string;
}

export interface SolarEdgeTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  tokenUrl: string;
  authorizationUrl?: string;
}

interface OAuthDiscoveryDocument {
  authorization_endpoint?: string;
  token_endpoint?: string;
}

interface OAuthTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

const DISCOVERY_URLS = [
  'https://api.solaredge.com/.well-known/openid-configuration',
  'https://api.solaredge.com/.well-known/oauth-authorization-server',
  'https://login.solaredge.com/.well-known/openid-configuration'
];

const TOKEN_URLS = [
  'https://api.solaredge.com/oauth2/token',
  'https://api.solaredge.com/v2/oauth2/token'
];

const AUTHORIZATION_URLS = [
  'https://api.solaredge.com/oauth2/authorize',
  'https://api.solaredge.com/v2/oauth2/authorize'
];

const API_BASE_URLS = ['https://api.solaredge.com'];

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

function safeApiError(status: number, text: string): string {
  const cleaned = text
    .replace(/access[_-]?token["'=:\s]+[^\s,"'}]+/gi, 'access_token=[redacted]')
    .replace(/client[_-]?secret["'=:\s]+[^\s,"'}]+/gi, 'client_secret=[redacted]')
    .replace(/refresh[_-]?token["'=:\s]+[^\s,"'}]+/gi, 'refresh_token=[redacted]')
    .slice(0, 280);
  return cleaned ? `HTTP ${status}: ${cleaned}` : `HTTP ${status}`;
}

async function fetchJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(safeApiError(response.status, await response.text()));
  return response.json();
}

export async function discoverSolarEdgeOAuth(preferredTokenUrl?: string, preferredAuthorizationUrl?: string): Promise<SolarEdgeOAuthConfig> {
  if (preferredTokenUrl && preferredAuthorizationUrl) return { tokenUrl: preferredTokenUrl, authorizationUrl: preferredAuthorizationUrl };

  for (const url of DISCOVERY_URLS) {
    try {
      const document = await fetchJson(url, { headers: { Accept: 'application/json' } }) as OAuthDiscoveryDocument;
      if (document.token_endpoint) {
        return {
          tokenUrl: preferredTokenUrl ?? document.token_endpoint,
          authorizationUrl: preferredAuthorizationUrl ?? document.authorization_endpoint ?? AUTHORIZATION_URLS[0]!
        };
      }
    } catch {
      // Discovery is optional. The public SolarEdge API gateway fallbacks below are tried next.
    }
  }

  return {
    tokenUrl: preferredTokenUrl ?? TOKEN_URLS[0]!,
    authorizationUrl: preferredAuthorizationUrl ?? AUTHORIZATION_URLS[0]!
  };
}

async function requestTokenAtUrl(tokenUrl: string, params: URLSearchParams, clientId: string, clientSecret: string): Promise<OAuthTokenResponse> {
  const headers = { Authorization: basicAuth(clientId, clientSecret), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  let response = await fetch(tokenUrl, { method: 'POST', headers, body: params, signal: AbortSignal.timeout(15_000) });

  // Some OAuth servers require client credentials in the form body rather than HTTP Basic.
  if (!response.ok && (response.status === 400 || response.status === 401)) {
    const body = new URLSearchParams(params);
    body.set('client_id', clientId);
    body.set('client_secret', clientSecret);
    response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
      signal: AbortSignal.timeout(15_000)
    });
  }

  if (!response.ok) throw new Error(safeApiError(response.status, await response.text()));
  const token = await response.json() as OAuthTokenResponse;
  if (!token.access_token) throw new Error('SolarEdge OAuth lieferte kein Access Token');
  return token;
}

async function requestTokenWithFallback(params: URLSearchParams, clientId: string, clientSecret: string, preferredTokenUrl?: string): Promise<{ token: OAuthTokenResponse; tokenUrl: string }> {
  const discovered = await discoverSolarEdgeOAuth(preferredTokenUrl);
  const candidates = unique([preferredTokenUrl, discovered.tokenUrl, ...TOKEN_URLS]);
  let lastError = 'kein Token-Endpunkt erreichbar';
  for (const tokenUrl of candidates) {
    try {
      return { token: await requestTokenAtUrl(tokenUrl, params, clientId, clientSecret), tokenUrl };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`SolarEdge OAuth fehlgeschlagen (${lastError})`);
}

function tokenSet(token: OAuthTokenResponse, tokenUrl: string, authorizationUrl?: string, previousRefreshToken?: string): SolarEdgeTokenSet {
  return {
    accessToken: token.access_token!,
    refreshToken: token.refresh_token ?? previousRefreshToken,
    expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : undefined,
    tokenUrl,
    authorizationUrl
  };
}

export async function acquireSolarEdgeClientToken(clientId: string, clientSecret: string, preferredTokenUrl?: string): Promise<SolarEdgeTokenSet> {
  const config = await discoverSolarEdgeOAuth(preferredTokenUrl);
  const { token, tokenUrl } = await requestTokenWithFallback(new URLSearchParams({ grant_type: 'client_credentials' }), clientId, clientSecret, preferredTokenUrl ?? config.tokenUrl);
  return tokenSet(token, tokenUrl, config.authorizationUrl);
}

export async function exchangeSolarEdgeCode(code: string, redirectUri: string, clientId: string, clientSecret: string, preferredTokenUrl?: string, preferredAuthorizationUrl?: string): Promise<SolarEdgeTokenSet> {
  const config = await discoverSolarEdgeOAuth(preferredTokenUrl, preferredAuthorizationUrl);
  const params = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  const { token, tokenUrl } = await requestTokenWithFallback(params, clientId, clientSecret, config.tokenUrl);
  return tokenSet(token, tokenUrl, config.authorizationUrl);
}

export async function refreshSolarEdgeToken(refreshToken: string, clientId: string, clientSecret: string, preferredTokenUrl?: string, preferredAuthorizationUrl?: string): Promise<SolarEdgeTokenSet> {
  const config = await discoverSolarEdgeOAuth(preferredTokenUrl, preferredAuthorizationUrl);
  const params = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
  const { token, tokenUrl } = await requestTokenWithFallback(params, clientId, clientSecret, config.tokenUrl);
  return tokenSet(token, tokenUrl, config.authorizationUrl, refreshToken);
}

export function buildSolarEdgeAuthorizationUrl(config: SolarEdgeOAuthConfig, clientId: string | undefined, redirectUri: string, state: string): string {
  if (!clientId) throw new Error('SolarEdge Client ID fehlt');
  const params = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state });
  return `${config.authorizationUrl}?${params.toString()}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function siteArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const root = asRecord(payload);
  if (!root) return [];
  for (const key of ['sites', 'items', 'data', 'results']) {
    const value = root[key];
    if (Array.isArray(value)) return value;
    const nested = asRecord(value);
    if (nested) {
      for (const nestedKey of ['sites', 'items', 'list', 'results']) {
        if (Array.isArray(nested[nestedKey])) return nested[nestedKey] as unknown[];
      }
    }
  }
  return [];
}

export function parseSolarEdgeSites(payload: unknown): SolarEdgeSite[] {
  const seen = new Set<string>();
  const sites: SolarEdgeSite[] = [];
  for (const item of siteArray(payload)) {
    const site = asRecord(item);
    if (!site) continue;
    const idValue = site.siteId ?? site.site_id ?? site.id ?? site.siteID;
    const id = typeof idValue === 'number' || typeof idValue === 'string' ? String(idValue) : '';
    if (!id || seen.has(id)) continue;
    const nameValue = site.name ?? site.siteName ?? site.site_name ?? site.displayName;
    const statusValue = site.status ?? site.siteStatus;
    sites.push({ id, name: typeof nameValue === 'string' && nameValue.trim() ? nameValue : `SolarEdge Anlage ${id}`, status: typeof statusValue === 'string' ? statusValue : undefined });
    seen.add(id);
  }
  return sites;
}

async function apiGet(accessToken: string, path: string, preferredBaseUrl?: string): Promise<{ payload: unknown; apiBaseUrl: string }> {
  const candidates = unique([preferredBaseUrl, ...API_BASE_URLS]);
  let lastError = 'API nicht erreichbar';
  for (const base of candidates) {
    try {
      const payload = await fetchJson(`${base}${path}`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
      return { payload, apiBaseUrl: base };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`SolarEdge ONE API V2: ${lastError}`);
}

export async function listSolarEdgeSites(accessToken: string, preferredBaseUrl?: string): Promise<{ sites: SolarEdgeSite[]; apiBaseUrl: string }> {
  const response = await apiGet(accessToken, '/v2/sites', preferredBaseUrl);
  const sites = parseSolarEdgeSites(response.payload);
  if (!sites.length) throw new Error('SolarEdge ONE hat keine freigegebenen Anlagen geliefert. Bitte die eigene Anlage/Fleet im Developer-Portal für diese Anwendung autorisieren.');
  return { sites, apiBaseUrl: response.apiBaseUrl };
}

type NumericEntry = { path: string; key: string; value: number; unit: string | null };

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function valueFromNode(value: unknown): number | null {
  const direct = finiteNumber(value);
  if (direct !== null) return direct;
  const record = asRecord(value);
  if (!record) return null;
  for (const key of ['value', 'power', 'currentPower', 'amount', 'energy', 'percentage', 'percent']) {
    const candidate = finiteNumber(record[key]);
    if (candidate !== null) return candidate;
  }
  return null;
}

function unitFromNode(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return null;
  const unit = record.unit ?? record.units ?? record.uom;
  return typeof unit === 'string' ? unit : null;
}

function collectNumbers(value: unknown, path: string[] = [], output: NumericEntry[] = [], inheritedUnit: string | null = null): NumericEntry[] {
  const record = asRecord(value);
  if (!record) return output;
  const localUnit = unitFromNode(record) ?? inheritedUnit;
  for (const [key, child] of Object.entries(record)) {
    const childPath = [...path, key];
    const numeric = valueFromNode(child);
    if (numeric !== null) output.push({ path: childPath.map(normalizeKey).join('.'), key: normalizeKey(key), value: numeric, unit: unitFromNode(child) ?? localUnit });
    if (child && typeof child === 'object') collectNumbers(child, childPath, output, unitFromNode(child) ?? localUnit);
  }
  return output;
}

function pathHas(entry: NumericEntry, terms: string[]): boolean {
  return terms.some((term) => entry.path.includes(normalizeKey(term)));
}

function powerToKw(value: number, unit: string | null): number {
  const normalized = normalizeKey(unit ?? '');
  if (normalized === 'w' || normalized === 'watt' || normalized === 'watts') return value / 1000;
  if (normalized === 'mw') return value * 1000;
  return value;
}

function energyToKwh(value: number, unit: string | null): number {
  const normalized = normalizeKey(unit ?? '');
  if (normalized === 'wh') return value / 1000;
  if (normalized === 'mwh') return value * 1000;
  return value;
}

function pick(entries: NumericEntry[], include: string[], preferredKeys: string[] = []): NumericEntry | null {
  const matching = entries.filter((entry) => pathHas(entry, include));
  for (const key of preferredKeys.map(normalizeKey)) {
    const exact = matching.find((entry) => entry.key === key || entry.path.endsWith(`.${key}`));
    if (exact) return exact;
  }
  return matching[0] ?? null;
}

function firstPower(entries: NumericEntry[], concepts: string[]): number | null {
  const entry = pick(entries, concepts, ['power', 'currentPower', 'value']);
  return entry ? powerToKw(entry.value, entry.unit) : null;
}

function firstPercent(entries: NumericEntry[], concepts: string[]): number | null {
  const entry = pick(entries, concepts, ['soc', 'stateOfCharge', 'chargeLevel', 'percentage', 'percent']);
  if (!entry) return null;
  return entry.value >= 0 && entry.value <= 1 ? entry.value * 100 : entry.value;
}

export function normalizeSolarEdgeV2(livePayload: unknown, energyPayload?: unknown): SolarSnapshot {
  const live = collectNumbers(livePayload);
  const energy = collectNumbers(energyPayload ?? {});

  const pvCurrentKw = firstPower(live, ['production', 'pv', 'photovoltaic', 'generation']);
  const consumptionKw = firstPower(live, ['consumption', 'load']);
  let gridImportKw = firstPower(live.filter((entry) => pathHas(entry, ['grid'])), ['import', 'purchased', 'consumption']);
  let feedInKw = firstPower(live.filter((entry) => pathHas(entry, ['grid'])), ['export', 'feedin', 'feed-in', 'injection']);
  const batterySoc = firstPercent(live.filter((entry) => pathHas(entry, ['battery', 'storage'])), ['soc', 'stateofcharge', 'chargelevel', 'percentage', 'percent']);

  // Some responses expose a signed or directional grid object rather than separate import/export keys.
  const gridEntries = live.filter((entry) => pathHas(entry, ['grid']));
  const gridDirection = JSON.stringify(livePayload).toLowerCase();
  if (gridImportKw === null && gridDirection.includes('import')) {
    const gridPower = pick(gridEntries, ['grid'], ['power', 'currentPower', 'value']);
    if (gridPower) gridImportKw = Math.abs(powerToKw(gridPower.value, gridPower.unit));
  }
  if (feedInKw === null && (gridDirection.includes('export') || gridDirection.includes('feed'))) {
    const gridPower = pick(gridEntries, ['grid'], ['power', 'currentPower', 'value']);
    if (gridPower) feedInKw = Math.abs(powerToKw(gridPower.value, gridPower.unit));
  }

  const dailyEntry = pick(energy, ['production', 'pv', 'generation', 'energy'], ['energy', 'value', 'amount']);
  const dailyEnergyKwh = dailyEntry ? energyToKwh(dailyEntry.value, dailyEntry.unit) : null;
  const pvSurplusKw = pvCurrentKw !== null && consumptionKw !== null ? Math.max(0, pvCurrentKw - consumptionKw) : feedInKw;

  const metricValues: Partial<Record<MetricName, number | null>> = { pvCurrentKw, dailyEnergyKwh, consumptionKw, gridImportKw, feedInKw, batterySoc, pvSurplusKw };
  const availableMetrics = (Object.entries(metricValues) as Array<[MetricName, number | null]>).filter(([, value]) => value !== null).map(([metric]) => metric);

  return {
    fetchedAt: new Date().toISOString(),
    pvCurrentKw,
    dailyEnergyKwh,
    consumptionKw,
    gridImportKw,
    feedInKw,
    batterySoc,
    pvSurplusKw,
    availableMetrics
  };
}

/** Legacy normalizer retained for tests/migration only; new network calls use API V2. */
export function normalizeSolarEdge(overviewResponse: unknown, powerFlowResponse: unknown): SolarSnapshot {
  return normalizeSolarEdgeV2(powerFlowResponse, overviewResponse);
}

async function fetchEnergyForToday(accessToken: string, siteId: string, apiBaseUrl: string): Promise<unknown | null> {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const encoded = encodeURIComponent(siteId);
  const variants = [
    `/v2/sites/${encoded}/energy?from=${today}&to=${today}&resolution=DAY`,
    `/v2/sites/${encoded}/energy?startDate=${today}&endDate=${today}&resolution=DAY`,
    `/v2/sites/${encoded}/energy?date=${today}&resolution=DAY`
  ];
  for (const path of variants) {
    try { return (await apiGet(accessToken, path, apiBaseUrl)).payload; } catch { /* optional metric */ }
  }
  return null;
}

export async function fetchSolarEdge(siteId: string, accessToken: string, preferredBaseUrl?: string): Promise<{ solar: SolarSnapshot; apiBaseUrl: string }> {
  if (!siteId.trim()) throw new Error('SolarEdge Site-ID fehlt');
  const live = await apiGet(accessToken, `/v2/sites/${encodeURIComponent(siteId)}/power/live`, preferredBaseUrl);
  const energy = await fetchEnergyForToday(accessToken, siteId, live.apiBaseUrl);
  return { solar: normalizeSolarEdgeV2(live.payload, energy), apiBaseUrl: live.apiBaseUrl };
}
