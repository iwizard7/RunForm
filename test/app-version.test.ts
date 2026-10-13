import { assert, assertEqual, group, summarize, test } from './harness';
import { APP_VERSION, formatVersionLabel } from '@/lib/app-version';

group('app version');

test('the version is not the empty fallback', () => {
  assert(APP_VERSION !== '0.0.0', 'NEXT_PUBLIC_APP_VERSION must be provided by the build');
});

test('the version looks like a semantic version', () => {
  assert(/^\d+\.\d+\.\d+/.test(APP_VERSION), `unexpected version: ${APP_VERSION}`);
});

test('the UI label is prefixed with v', () => {
  assertEqual(formatVersionLabel('1.2.3'), 'v1.2.3', 'label formatting');
});

summarize('app-version suite').catch((error) => {
  console.error(error);
  process.exit(1);
});
