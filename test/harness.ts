/**
 * Minimal assertion harness for RunForm logic tests.
 *
 * The suites are plain TypeScript files compiled to CommonJS by
 * `npm run test:logic` and executed with node. Each suite imports `group`,
 * `test` and `summarize` from here.
 *
 * `test` supports async test bodies: they are tracked in `pendingTests` and
 * awaited by `summarize`, so a rejected assertion can never be silently
 * swallowed as an unhandled promise rejection.
 */

export const pendingTests: Array<Promise<void>> = [];

type Session = Record<string, unknown>;
let sessionPromise: Promise<Session> | null = null;

let failures = 0;
let passed = 0;

export function group(name: string) {
  console.log(`\n${name}`);
}

/**
 * Registers an asynchronous session setup (database imports, fixtures, ...).
 *
 * `test` bodies call the returned accessor to await the prepared values. The
 * accessor returns the setup promise itself rather than `promise.then(() =>
 * promise)`: the extra `.then()` hop introduces an additional microtask, which
 * lets the next test body start before the previous one has finished.
 */
export function before<T extends Session>(setup: () => Promise<T>): () => Promise<T> {
  if (sessionPromise) {
    throw new Error('before() can only be called once per suite');
  }
  sessionPromise = setup() as Promise<Session>;
  // Surface setup failures through the first awaiting test instead of as an
  // unhandled rejection.
  sessionPromise.catch(() => {});
  return () => sessionPromise as Promise<T>;
}

export function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  const previous = pendingTests.length > 0 ? pendingTests[pendingTests.length - 1] : null;

  const promise = (previous ?? sessionPromise ?? Promise.resolve({}))
    .then(() => fn())
    .then(() => {
      passed += 1;
      console.log(`  ok   ${name}`);
    })
    .catch((error: unknown) => {
      failures += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  FAIL ${name}\n       ${message}`);
    });

  pendingTests.push(promise);
  return promise;
}

export function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }
}

export async function summarize(suiteName: string): Promise<never> {
  // The suite setup and test bodies may depend on asynchronous module loading
  // (dynamic imports compile to promises, and better-sqlite3 is loaded through
  // one). Without a referenced handle Node can drain the microtask queue and
  // exit before those tests ever run, so hold one interval for the whole run.
  const keepAlive = setInterval(() => {}, 25);

  try {
    // Await every test, including ones started while waiting.
    let awaited = 0;
    while (awaited < pendingTests.length) {
      const batch = pendingTests.slice(awaited);
      awaited = pendingTests.length;
      await Promise.all(batch);
    }
  } finally {
    clearInterval(keepAlive);
  }

  if (failures === 0) {
    console.log(`\n${suiteName}: ${passed} checks passed`);
    process.exit(0);
  }

  console.error(`\n${suiteName}: ${passed} passed, ${failures} FAILED`);
  process.exit(1);
}
