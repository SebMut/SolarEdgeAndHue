import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const root=new URL('..',import.meta.url).pathname;const skip=new Set(['node_modules','dist','.git','.wrangler']);
const risky=[/api[_-]?key\s*[=:]\s*["']?[A-Za-z0-9_-]{20,}/i,/client[_-]?secret\s*[=:]\s*["']?[A-Za-z0-9_-]{16,}/i,/BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/];
let failed=false;
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){if(skip.has(e.name))continue;const p=join(dir,e.name);if(e.isDirectory())await walk(p);else if(!e.name.endsWith('.lock')){const t=await readFile(p,'utf8').catch(()=>null);if(t&&risky.some(r=>r.test(t))){console.error(`Potential secret pattern: ${p}`);failed=true}}}}
await walk(root);if(failed)process.exit(1);console.log('No obvious committed secrets found.');
