import type { SecretSettings } from './types';

export interface HueEnv {
  HUE_AUTH_URL: string;
  HUE_TOKEN_URL: string;
  HUE_API_BASE: string;
}

interface HueTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  username?: string;
}

function basicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

export function buildHueAuthorizationUrl(env: HueEnv, clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({ clientid: clientId, response_type: 'code', state, appid: clientId, deviceid: 'pool-energy-control' });
  // Hue Remote API uses the registered callback URL; redirectUri is kept in state/config for validation and diagnostics.
  params.set('redirect_uri', redirectUri);
  return `${env.HUE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeHueCode(env: HueEnv, code: string, redirectUri: string, clientId: string, clientSecret: string): Promise<SecretSettings> {
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  const response = await fetch(env.HUE_TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basicAuth(clientId, clientSecret), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`Hue OAuth HTTP ${response.status}: ${await response.text()}`);
  const token = await response.json() as HueTokenResponse;
  if (!token.access_token) throw new Error('Hue OAuth lieferte kein Access Token');
  return {
    hueAccessToken: token.access_token,
    hueRefreshToken: token.refresh_token,
    hueUsername: token.username,
    hueAccessTokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : undefined
  };
}

export async function refreshHueToken(env: HueEnv, refreshToken: string, clientId: string, clientSecret: string): Promise<SecretSettings> {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
  const response = await fetch(env.HUE_TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basicAuth(clientId, clientSecret), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`Hue Token Refresh HTTP ${response.status}`);
  const token = await response.json() as HueTokenResponse;
  return {
    hueAccessToken: token.access_token,
    hueRefreshToken: token.refresh_token ?? refreshToken,
    hueUsername: token.username,
    hueAccessTokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : undefined
  };
}

async function hueRequest(env: HueEnv, accessToken: string, path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${env.HUE_API_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error(`Hue Remote API HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

export async function listHueDevices(env: HueEnv, accessToken: string, username: string): Promise<Array<{ id: string; name: string; on: boolean | null; type: string }>> {
  const payload = await hueRequest(env, accessToken, `/api/${encodeURIComponent(username)}/lights`) as Record<string, { name?: string; state?: { on?: boolean }; type?: string }>;
  return Object.entries(payload).map(([id, light]) => ({ id, name: light.name ?? `Hue ${id}`, on: typeof light.state?.on === 'boolean' ? light.state.on : null, type: light.type ?? 'device' }));
}

export async function setHuePower(env: HueEnv, accessToken: string, username: string, resourceId: string, on: boolean): Promise<void> {
  const payload = await hueRequest(env, accessToken, `/api/${encodeURIComponent(username)}/lights/${encodeURIComponent(resourceId)}/state`, { method: 'PUT', body: JSON.stringify({ on }) });
  if (Array.isArray(payload) && payload.some((entry) => typeof entry === 'object' && entry !== null && 'error' in entry)) throw new Error('Hue hat den Schaltbefehl abgelehnt');
}
