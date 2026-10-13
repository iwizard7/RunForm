import os from 'os';
import path from 'path';
import fs from 'fs';

/**
 * Resolves the directory that holds the local SQLite database.
 *
 * Precedence:
 *   1. `RUNFORM_DATA_DIR` (explicit override, always wins)
 *   2. `<cwd>/data` when it already exists or can be created
 *   3. a platform user-data directory as a safe fallback
 *
 * The fallback matters for packaged builds, where the working directory can be
 * a read-only bundle location and writing `<cwd>/data` would fail.
 */

export type DataDirSource = 'env' | 'cwd' | 'userData';
export type DataDirPlatform = NodeJS.Platform;

export type DataDirFileSystem = {
  existsSync: (target: string) => boolean;
  accessSync: (target: string, mode?: number) => void;
  mkdirSync: (target: string, options?: { recursive?: boolean }) => void;
};

export type ResolveDataDirOptions = {
  env?: Record<string, string | undefined>;
  cwd?: string;
  platform?: DataDirPlatform;
  home?: string;
  fs?: DataDirFileSystem;
};

export type ResolvedDataDir = {
  dir: string;
  source: DataDirSource;
};

const defaultFs: DataDirFileSystem = {
  existsSync: fs.existsSync,
  accessSync: (target, mode) => fs.accessSync(target, mode),
  mkdirSync: (target, options) => {
    fs.mkdirSync(target, options);
  },
};

export function getUserDataDir(platform: DataDirPlatform, home: string): string {
  switch (platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'RunForm');
    case 'win32': {
      const appData = process.env.APPDATA;
      return appData ? path.join(appData, 'RunForm') : path.join(home, 'AppData', 'Roaming', 'RunForm');
    }
    default:
      return path.join(home, '.local', 'share', 'runform');
  }
}

export function isDirectoryWritable(target: string, fileSystem: DataDirFileSystem = defaultFs): boolean {
  try {
    if (!fileSystem.existsSync(target)) {
      return false;
    }
    fileSystem.accessSync(target, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveDataDir(options: ResolveDataDirOptions = {}): ResolvedDataDir {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const platform = options.platform ?? process.platform;
  const home = options.home ?? os.homedir();
  const fileSystem = options.fs ?? defaultFs;

  const override = env.RUNFORM_DATA_DIR;
  if (override && override.trim().length > 0) {
    return { dir: path.resolve(cwd, override.trim()), source: 'env' };
  }

  const cwdCandidate = path.join(cwd, 'data');
  try {
    if (!fileSystem.existsSync(cwdCandidate)) {
      fileSystem.mkdirSync(cwdCandidate, { recursive: true });
    }
    if (isDirectoryWritable(cwdCandidate, fileSystem)) {
      return { dir: cwdCandidate, source: 'cwd' };
    }
  } catch {
    // fall through to the user-data directory
  }

  return { dir: getUserDataDir(platform, home), source: 'userData' };
}
