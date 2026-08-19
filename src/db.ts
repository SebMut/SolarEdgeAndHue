import { DEFAULT_SETTINGS } from './defaults';
import { decryptJson, encryptJson, sha256 } from './security';
import type { EvaluationResult, SecretSettings, Settings } from './types';

export async function getMeta(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setMeta(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare('INSERT INTO meta(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP').bind(key, value).run();
}

export async function getSettings(db: D1Database): Promise<Settings> {
  const raw = await getMeta(db, 'settings');
  if (!raw) return structuredClone(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
}

export async function saveSettings(db: D1Database, settings: Settings): Promise<void> {
  await setMeta(db, 'settings', JSON.stringify(settings));
}

export async function getSecrets(db: D1Database, encryptionKey: string): Promise<SecretSettings> {
  const raw = await getMeta(db, 'secrets');
  if (!raw) return {};
  return decryptJson<SecretSettings>(raw, encryptionKey);
}

export async function saveSecrets(db: D1Database, secrets: SecretSettings, encryptionKey: string): Promise<void> {
  await setMeta(db, 'secrets', await encryptJson(secrets, encryptionKey));
}

export async function isSetupComplete(db: D1Database): Promise<boolean> {
  return (await getMeta(db, 'admin_password_hash')) !== null;
}

export async function createSession(db: D1Database, token: string, csrfToken: string, expiresAt: string): Promise<void> {
  await db.prepare('INSERT INTO sessions(token_hash, csrf_token, expires_at) VALUES(?,?,?)').bind(await sha256(token), csrfToken, expiresAt).run();
}

export async function getSession(db: D1Database, token: string): Promise<{ csrfToken: string; expiresAt: string } | null> {
  const row = await db.prepare('SELECT csrf_token, expires_at FROM sessions WHERE token_hash = ?').bind(await sha256(token)).first<{ csrf_token: string; expires_at: string }>();
  if (!row || new Date(row.expires_at).getTime() <= Date.now()) return null;
  return { csrfToken: row.csrf_token, expiresAt: row.expires_at };
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
}

export async function cleanupSessions(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
}

export async function logEvent(db: D1Database, type: string, message: string, details: unknown = null): Promise<void> {
  await db.prepare('INSERT INTO events(type,message,details_json) VALUES(?,?,?)').bind(type, message, details === null ? null : JSON.stringify(details)).run();
}

export async function saveSnapshot(db: D1Database, kind: 'solar' | 'weather', payload: unknown): Promise<void> {
  await db.prepare('INSERT INTO snapshots(kind,payload_json) VALUES(?,?)').bind(kind, JSON.stringify(payload)).run();
}

export async function saveEvaluation(db: D1Database, result: EvaluationResult): Promise<void> {
  await setMeta(db, 'last_evaluation', JSON.stringify(result));
  await logEvent(db, 'automation', result.reason, result);
}

export async function getLastEvaluation(db: D1Database): Promise<EvaluationResult | null> {
  const raw = await getMeta(db, 'last_evaluation');
  return raw ? JSON.parse(raw) as EvaluationResult : null;
}

export async function getLatestSnapshot<T>(db: D1Database, kind: 'solar' | 'weather'): Promise<T | null> {
  const row = await db.prepare('SELECT payload_json FROM snapshots WHERE kind = ? ORDER BY id DESC LIMIT 1').bind(kind).first<{ payload_json: string }>();
  return row ? JSON.parse(row.payload_json) as T : null;
}

export async function listEvents(db: D1Database, limit = 100): Promise<Array<{ id: number; createdAt: string; type: string; message: string; details: unknown }>> {
  const result = await db.prepare('SELECT id, created_at, type, message, details_json FROM events ORDER BY id DESC LIMIT ?').bind(Math.max(1, Math.min(limit, 500))).all<{ id: number; created_at: string; type: string; message: string; details_json: string | null }>();
  return (result.results ?? []).map((row) => ({ id: row.id, createdAt: row.created_at, type: row.type, message: row.message, details: row.details_json ? JSON.parse(row.details_json) : null }));
}


export async function listSnapshots<T>(db: D1Database, kind: 'solar' | 'weather', sinceIso: string, limit = 1000): Promise<Array<{ createdAt: string; payload: T }>> {
  const result = await db.prepare('SELECT created_at, payload_json FROM snapshots WHERE kind = ? AND created_at >= ? ORDER BY id ASC LIMIT ?').bind(kind, sinceIso, Math.max(1, Math.min(limit, 2000))).all<{ created_at: string; payload_json: string }>();
  return (result.results ?? []).map((row) => ({ createdAt: row.created_at, payload: JSON.parse(row.payload_json) as T }));
}

export async function getActuatorState(db: D1Database): Promise<{ on: boolean | null; changedAt: string | null }> {
  const row = await db.prepare('SELECT is_on, created_at FROM actuator_events ORDER BY id DESC LIMIT 1').first<{ is_on: number; created_at: string }>();
  return row ? { on: row.is_on === 1, changedAt: row.created_at } : { on: null, changedAt: null };
}

export async function recordActuatorState(db: D1Database, on: boolean, source: string, reason: string): Promise<void> {
  await db.prepare('INSERT INTO actuator_events(is_on,source,reason) VALUES(?,?,?)').bind(on ? 1 : 0, source, reason).run();
}

export async function runtimeMinutesSince(db: D1Database, fromIso: string, now = new Date()): Promise<number> {
  const rows = await db.prepare('SELECT is_on, created_at FROM actuator_events WHERE created_at >= ? ORDER BY created_at ASC').bind(fromIso).all<{ is_on: number; created_at: string }>();
  let totalMs = 0;
  let onSince: number | null = null;
  for (const row of rows.results ?? []) {
    const time = new Date(row.created_at).getTime();
    if (row.is_on === 1 && onSince === null) onSince = time;
    if (row.is_on === 0 && onSince !== null) { totalMs += Math.max(0, time - onSince); onSince = null; }
  }
  if (onSince !== null) totalMs += Math.max(0, now.getTime() - onSince);
  return Math.floor(totalMs / 60_000);
}
