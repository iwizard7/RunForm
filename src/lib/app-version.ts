/**
 * Single source of truth for the version shown in the UI.
 *
 * `next.config.ts` reads `version` from package.json and exposes it through
 * `env.NEXT_PUBLIC_APP_VERSION`, so the UI always matches the released version
 * and never needs a manual edit in two places.
 */
export const APP_VERSION: string = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0';

export function formatVersionLabel(version: string = APP_VERSION): string {
  return `v${version}`;
}
