import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import db from './db';

/**
 * Backup & restore for the local SQLite database.
 *
 * Backups live in `<dataDir>/backups/` as plain SQLite files created with the
 * online-backup API, so they are consistent snapshots even while the WAL has
 * uncheckpointed frames. Restoring never overwrites the file on disk: the
 * attached backup is copied table-by-table into the live database inside one
 * transaction, which keeps the server (and its open handle) alive and makes a
 * rejected restore a true no-op.
 */

export const BACKUP_DIR_NAME = 'backups';

const SQLITE_MAGIC = 'SQLite format 3\u0000';
// Only plain names inside the backups directory: no separators, no leading dot.
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.db$/;

export type BackupEntry = {
  fileName: string;
  sizeBytes: number;
  /** ISO timestamp of the file's last modification. */
  createdAt: string;
  /** Workout count inside the backup; -1 when the file cannot be read. */
  workouts: number;
};

export type DatabaseInfo = {
  path: string;
  sizeBytes: number;
  workouts: number;
  backups: number;
};

/**
 * Rejects anything that could escape the backups directory. Both path
 * separators and `..` are impossible under the allowed character set, and the
 * basename equality check is a second, independent guard.
 */
export function sanitizeBackupFileName(name: unknown): string | null {
  if (typeof name !== 'string' || name.length === 0 || name.length > 200) {
    return null;
  }
  if (name !== path.basename(name) || name.includes('..')) {
    return null;
  }
  if (!SAFE_FILE_NAME.test(name)) {
    return null;
  }
  return name;
}

/** Checks the 16-byte SQLite header, the only reliable format sniff. */
export function isSqliteBuffer(buffer: Uint8Array): boolean {
  return (
    buffer.length >= 16 &&
    Buffer.from(buffer.subarray(0, 16)).toString('latin1') === SQLITE_MAGIC
  );
}

export function backupsDir(dataDir: string): string {
  return path.join(dataDir, BACKUP_DIR_NAME);
}

/** Counts workouts in a closed database file; -1 when it cannot be opened. */
function countWorkoutsFile(fullPath: string): number {
  let handle: Database.Database | null = null;
  try {
    handle = new Database(fullPath, { readonly: true, fileMustExist: true });
    const row = handle.prepare('SELECT COUNT(*) AS count FROM workouts').get() as
      | { count: number }
      | undefined;
    return row?.count ?? 0;
  } catch {
    return -1;
  } finally {
    handle?.close();
  }
}

/**
 * Verifies that a file is a restorable RunForm backup: a readable SQLite
 * database that passes the integrity check and has the workouts table.
 */
export function validateBackupFile(fullPath: string): {
  valid: boolean;
  error?: string;
  workouts: number;
} {
  if (!fs.existsSync(fullPath)) {
    return { valid: false, error: 'Backup file not found', workouts: 0 };
  }

  let handle: Database.Database;
  try {
    handle = new Database(fullPath, { readonly: true, fileMustExist: true });
  } catch {
    return { valid: false, error: 'The file is not a readable SQLite database', workouts: 0 };
  }

  try {
    const integrity = handle.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') {
      return { valid: false, error: `Integrity check failed: ${String(integrity)}`, workouts: 0 };
    }
    const tables = handle
      .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'workouts'")
      .get() as { count: number };
    if (tables.count === 0) {
      return { valid: false, error: 'The file has no workouts table — not a RunForm backup', workouts: 0 };
    }
    const count = handle.prepare('SELECT COUNT(*) AS count FROM workouts').get() as { count: number };
    return { valid: true, workouts: count.count };
  } finally {
    handle.close();
  }
}

/** Builds a timestamped backup name, adding -2, -3, ... within one second. */
function uniqueBackupName(dir: string, tag: string): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const suffix = tag ? `-${tag}` : '';

  let name = `runform-backup-${date}T${time}${suffix}.db`;
  let attempt = 2;
  while (fs.existsSync(path.join(dir, name))) {
    name = `runform-backup-${date}T${time}${suffix}-${attempt}.db`;
    attempt += 1;
  }
  return name;
}

/** Lists backups newest first; unreadable files stay listed with workouts = -1. */
export function listBackups(dataDir: string): BackupEntry[] {
  const dir = backupsDir(dataDir);
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries: BackupEntry[] = [];
  for (const fileName of fs.readdirSync(dir)) {
    if (!fileName.endsWith('.db')) continue;
    const full = path.join(dir, fileName);
    const stat = fs.statSync(full);
    if (!stat.isFile()) continue;
    entries.push({
      fileName,
      sizeBytes: stat.size,
      createdAt: stat.mtime.toISOString(),
      workouts: countWorkoutsFile(full),
    });
  }
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Takes a consistent snapshot of the live database into the backups dir. */
export async function createBackup(dataDir: string, tag = ''): Promise<BackupEntry> {
  const dir = backupsDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });

  const fileName = uniqueBackupName(dir, tag);
  const full = path.join(dir, fileName);
  await db.backup(full);

  // The snapshot is complete once backup() returns, but SQLite may leave
  // WAL/SHM scratch files next to it. Normalizing the journal keeps every
  // backup a single self-contained file that can simply be copied around.
  const handle = new Database(full);
  try {
    handle.pragma('wal_checkpoint(TRUNCATE)');
    handle.pragma('journal_mode = DELETE');
  } finally {
    handle.close();
  }

  const stat = fs.statSync(full);
  return {
    fileName,
    sizeBytes: stat.size,
    createdAt: stat.mtime.toISOString(),
    workouts: countWorkoutsFile(full),
  };
}

/** Quotes a string as a SQLite literal for use inside EXEC statements. */
function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Replaces the contents of the live database with the backup's data.
 *
 * A safety snapshot of the current state is taken first, so every restore is
 * undoable. Tables that only exist in one of the two schemas (a backup from a
 * newer app version, or the migrations table) are skipped; for shared tables
 * only common columns are copied, so an older backup stays restorable.
 */
export async function restoreBackup(
  dataDir: string,
  fileName: string,
): Promise<{ restoredWorkouts: number; safetyBackup: string }> {
  const safe = sanitizeBackupFileName(fileName);
  if (!safe) {
    throw new Error('Invalid backup file name.');
  }

  const full = path.join(backupsDir(dataDir), safe);
  const validation = validateBackupFile(full);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'The backup file did not pass validation.');
  }

  const safety = await createBackup(dataDir, 'prerestore');

  // Foreign keys must stay off for the whole swap: with them on, SQLite checks
  // every inserted row immediately and cross-table ordering would matter.
  db.pragma('foreign_keys = OFF');
  let attached = false;
  try {
    db.exec(`ATTACH DATABASE ${quoteLiteral(full)} AS restore_src`);
    attached = true;

    const srcTables = (
      db
        .prepare("SELECT name FROM restore_src.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>
    ).map((row) => row.name);

    const mainTables = new Set(
      (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
          .all() as Array<{ name: string }>
      ).map((row) => row.name),
    );

    // schema_migrations tracks the live schema version, not the backup's.
    const copyable = srcTables.filter((table) => mainTables.has(table) && table !== 'schema_migrations');

    db.transaction(() => {
      for (const table of copyable) {
        db.exec(`DELETE FROM main.${quoteIdentifier(table)}`);
      }
      for (const table of copyable) {
        const srcColumns = (
          db.prepare(`PRAGMA restore_src.table_info(${quoteIdentifier(table)})`).all() as Array<{ name: string }>
        ).map((column) => column.name);
        const dstColumns = new Set(
          (
            db.prepare(`PRAGMA main.table_info(${quoteIdentifier(table)})`).all() as Array<{ name: string }>
          ).map((column) => column.name),
        );
        const common = srcColumns.filter((column) => dstColumns.has(column));
        if (common.length === 0) continue;
        const columnList = common.map(quoteIdentifier).join(', ');
        db.exec(
          `INSERT INTO main.${quoteIdentifier(table)} (${columnList}) ` +
            `SELECT ${columnList} FROM restore_src.${quoteIdentifier(table)}`,
        );
      }
    })();
  } finally {
    if (attached) {
      try {
        db.exec('DETACH DATABASE restore_src');
      } catch {
        // The transaction rolled back and the connection is closing anyway.
      }
    }
    db.pragma('foreign_keys = ON');
  }

  const count = db.prepare('SELECT COUNT(*) AS count FROM workouts').get() as { count: number };
  return { restoredWorkouts: count.count, safetyBackup: safety.fileName };
}

/** Snapshot of the live database for the Settings panel. */
export function getDatabaseInfo(dataDir: string): DatabaseInfo {
  const dbPath = path.join(dataDir, 'workouts.db');
  let sizeBytes = 0;
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      sizeBytes += fs.statSync(dbPath + suffix).size;
    } catch {
      // A missing WAL/SHM sidecar is normal right after a checkpoint.
    }
  }

  const count = db.prepare('SELECT COUNT(*) AS count FROM workouts').get() as { count: number };
  const dir = backupsDir(dataDir);
  const backups = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((name) => name.endsWith('.db')).length
    : 0;

  return { path: dbPath, sizeBytes, workouts: count.count, backups };
}
