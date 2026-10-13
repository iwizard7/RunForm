/**
 * CommonJS resolution hook for the logic test suites.
 *
 * The suites are compiled to CommonJS by `tsc -p tsconfig.test.json`, which
 * preserves the `@/...` path aliases from the Next.js tsconfig. Node cannot
 * resolve those aliases by itself, so this hook maps them back to the compiled
 * output under `.test-build/src/`.
 *
 * `module.registerHooks` only exists in Node 22+, while the SQLite suite needs
 * the Node 20 binary that better-sqlite3 was compiled for, so this uses the
 * long-standing `Module._resolveFilename` hook instead. It is loaded with
 * `node --require`, which works on every Node version.
 */
const Module = require('node:module');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const buildRoot = path.join(projectRoot, '.test-build', 'src');

const originalResolveFilename = Module._resolveFilename;

Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  if (typeof request === 'string' && request.startsWith('@/')) {
    const mapped = path.join(buildRoot, request.slice(2));
    return originalResolveFilename.call(this, mapped, parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

// A rejected assertion must never be swallowed: fail the process loudly.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection in test run:', reason);
  process.exit(1);
});
