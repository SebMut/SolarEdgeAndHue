const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Cloudflare Workers Web Crypto currently caps PBKDF2 at 100,000 iterations.
// Keep the encoded work factor explicit so hashes remain self-describing.
const PBKDF2_ITERATIONS = 100_000;
const MAX_PBKDF2_ITERATIONS = 100_000;

function bytesToBase64(bytes: Uint8Array<ArrayBufferLike>): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return bytesToBase64(new Uint8Array(digest));
}

async function deriveAesKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptJson(value: unknown, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(secret);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(value)));
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function decryptJson<T>(value: string, secret: string): Promise<T> {
  const [ivText, dataText] = value.split('.');
  if (!ivText || !dataText) throw new Error('Invalid encrypted value');
  const key = await deriveAesKey(secret);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(ivText) }, key, base64ToBytes(dataText));
  return JSON.parse(decoder.decode(decrypted)) as T;
}

export async function hashPassword(password: string, salt?: string): Promise<string> {
  const actualSalt = salt ? base64ToBytes(salt) : crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: actualSalt, iterations: PBKDF2_ITERATIONS },
    material,
    256
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToBase64(actualSalt)}$${bytesToBase64(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const [, iterationsText, salt, expected] = parts;
  if (!iterationsText || !salt || !expected) return false;
  const iterations = Number(iterationsText);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_PBKDF2_ITERATIONS) return false;
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: base64ToBytes(salt), iterations }, material, 256);
  const actual = new Uint8Array(bits);
  const expectedBytes = base64ToBytes(expected);
  if (actual.length !== expectedBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) diff |= actual[i]! ^ expectedBytes[i]!;
  return diff === 0;
}

export async function secureEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  if (ha.length !== hb.length) return false;
  let diff = 0;
  for (let i = 0; i < ha.length; i += 1) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

export function randomToken(bytes = 32): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return bytesToBase64(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function securityHeaders(headers = new Headers()): Headers {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  return headers;
}
