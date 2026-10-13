/**
 * Picks a Node binary that can load native modules (better-sqlite3).
 *
 * The project's native addon is built for the Node ABI reported in
 * `.node-abi` metadata; on this machine Node 26 is the default shell binary but
 * the addon targets Node 20. Set RUNFORM_TEST_NODE to override.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const candidates = [
  process.env.RUNFORM_TEST_NODE,
  '/opt/homebrew/opt/node@20/bin/node',
  '/usr/local/opt/node@20/bin/node',
  process.execPath,
].filter(Boolean);

for (const candidate of candidates) {
  try {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    execFileSync(candidate, ['-e', "require('better-sqlite3')"], {
      cwd: path.resolve(new URL('..', import.meta.url).pathname),
      stdio: 'ignore',
    });
    process.stdout.write(candidate);
    process.exit(0);
  } catch {
    // try the next candidate
  }
}

console.error('No Node binary found that can load better-sqlite3. Set RUNFORM_TEST_NODE.');
process.exit(1);
