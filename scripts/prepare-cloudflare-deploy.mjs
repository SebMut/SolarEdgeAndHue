import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const databaseName = 'solar-edge-hue';
const sourceConfig = 'wrangler.jsonc';
const deployConfig = 'wrangler.deploy.jsonc';

function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

function classifyError(text) {
  const value = text.toLowerCase();
  if (value.includes('authentication') || value.includes('invalid api token') || value.includes('10000')) return 'authentication';
  if (value.includes('permission') || value.includes('not authorized') || value.includes('unauthorized') || value.includes('forbidden') || value.includes('10001') || value.includes('9109')) return 'permissions';
  if ((value.includes('account') && value.includes('not found')) || value.includes('invalid account') || value.includes('account id')) return 'account';
  if (value.includes('json') || value.includes('unexpected token') || value.includes('unexpected end')) return 'json';
  if (value.includes('enotfound') || value.includes('etimedout') || value.includes('fetch failed') || value.includes('network')) return 'network';
  return 'unknown';
}

function errorText(error) {
  if (!error || typeof error !== 'object') return String(error);
  const parts = [];
  if ('message' in error && typeof error.message === 'string') parts.push(error.message);
  if ('stdout' in error && error.stdout) parts.push(String(error.stdout));
  if ('stderr' in error && error.stderr) parts.push(String(error.stderr));
  return parts.join('\n');
}

for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
  if (!process.env[name]) {
    setOutput('error_code', `environment-${name.toLowerCase()}`);
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

function wrangler(args) {
  return execFileSync('npx', ['wrangler', ...args], {
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function parseJsonOutput(output) {
  const trimmed = output.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return JSON.parse(trimmed);

  const startArray = output.indexOf('[');
  const startObject = output.indexOf('{');
  const candidates = [startArray, startObject].filter((index) => index >= 0);
  if (!candidates.length) throw new Error('Wrangler did not return JSON output');
  return JSON.parse(output.slice(Math.min(...candidates)));
}

function listDatabases() {
  const parsed = parseJsonOutput(wrangler(['d1', 'list', '--json']));
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.result)) return parsed.result;
  if (Array.isArray(parsed.databases)) return parsed.databases;
  return [];
}

function databaseId(database) {
  return database?.uuid ?? database?.database_id ?? database?.id ?? null;
}

let stage = 'list';
try {
  let database = listDatabases().find((item) => item?.name === databaseName);
  if (!database) {
    stage = 'create';
    console.log(`Creating D1 database '${databaseName}' in Western Europe...`);
    const createOutput = wrangler(['d1', 'create', databaseName, '--location', 'weur']);
    if (createOutput.trim()) console.log(createOutput.trim());
    stage = 'list-after-create';
    database = listDatabases().find((item) => item?.name === databaseName);
  }

  stage = 'resolve-id';
  const id = databaseId(database);
  if (!id || typeof id !== 'string') throw new Error(`Could not determine D1 database ID for '${databaseName}'`);

  stage = 'write-config';
  const config = JSON.parse(readFileSync(sourceConfig, 'utf8'));
  if (!Array.isArray(config.d1_databases)) throw new Error('wrangler.jsonc has no d1_databases configuration');
  const binding = config.d1_databases.find((item) => item?.binding === 'DB');
  if (!binding) throw new Error("D1 binding 'DB' is missing from wrangler.jsonc");
  binding.database_id = id;
  writeFileSync(deployConfig, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });

  setOutput('database_id', id);
  setOutput('database_name', databaseName);
  setOutput('error_code', '');

  console.log(`D1 ready: ${databaseName} (${id})`);
  console.log(`Generated ${deployConfig} for this deployment only.`);
} catch (error) {
  const category = classifyError(errorText(error));
  const code = `${stage}-${category}`;
  setOutput('error_code', code);
  console.error(`D1 preparation failed at '${stage}' (${category}).`);
  process.exitCode = 1;
}
