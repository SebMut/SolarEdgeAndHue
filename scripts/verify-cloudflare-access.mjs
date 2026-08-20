import { appendFileSync } from 'node:fs';

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function classifyHttp(status) {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status >= 500) return 'server-error';
  return `http-${status}`;
}

async function requestJson(url) {
  const response = await globalThis.fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  });
  let body;
  try { body = await response.json(); } catch { body = null; }
  return { response, body };
}

if (!accountId || !token) {
  setOutput('token_status', 'missing-environment');
  setOutput('d1_status', 'not-tested');
  process.exit(1);
}

let tokenStatus;
let d1Status = 'not-tested';

try {
  const verify = await requestJson(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/tokens/verify`);
  if (verify.response.ok && verify.body?.success === true && verify.body?.result?.status === 'active') {
    tokenStatus = 'active';
  } else if (verify.body?.result?.status === 'disabled') {
    tokenStatus = 'disabled';
  } else if (verify.body?.result?.status === 'expired') {
    tokenStatus = 'expired';
  } else {
    tokenStatus = classifyHttp(verify.response.status);
  }
} catch {
  tokenStatus = 'network-error';
}

if (tokenStatus === 'active') {
  try {
    const d1 = await requestJson(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database?page=1&per_page=1`);
    if (d1.response.ok && d1.body?.success === true) d1Status = 'allowed';
    else d1Status = classifyHttp(d1.response.status);
  } catch {
    d1Status = 'network-error';
  }
}

setOutput('token_status', tokenStatus);
setOutput('d1_status', d1Status);
console.log(`Cloudflare token preflight: ${tokenStatus}`);
console.log(`Cloudflare D1 preflight: ${d1Status}`);

if (tokenStatus !== 'active' || d1Status !== 'allowed') process.exitCode = 1;
