import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { resolveDataDir } from './data-dir';

// The data directory resolution lives in ./data-dir.ts:
//   RUNFORM_DATA_DIR wins, then <cwd>/data, then a platform user-data folder
//   (needed for packaged builds where the bundle directory is read-only).
const resolvedDataDir = resolveDataDir();
export const DB_DIR = resolvedDataDir.dir;
const DB_PATH = path.join(DB_DIR, 'workouts.db');

console.log(`[RunForm] DB path: ${DB_PATH} (source: ${resolvedDataDir.source})`);

fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
// Referential integrity: workouts are referenced by personal_bests, shoes and
// routes, so orphaned rows must not be possible.
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const appliedVersions = new Set(
  (db.prepare('SELECT version FROM schema_migrations ORDER BY version ASC').all() as Array<{ version: number }>).map((row) => row.version),
);

const applyMigration = db.transaction((version: number, run: () => void) => {
  if (appliedVersions.has(version)) {
    return;
  }

  run();
  db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
  appliedVersions.add(version);
});

applyMigration(1, () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workouts (
      uuid TEXT PRIMARY KEY,
      name TEXT,
      activity_name TEXT,
      activity_type INTEGER,
      start_date TEXT,
      end_date TEXT,
      duration INTEGER,
      calories INTEGER,
      distance REAL,
      pace TEXT,
      avg_intensity INTEGER,
      min_intensity INTEGER,
      max_intensity INTEGER,
      average_mets REAL,
      avg_hr INTEGER,
      min_hr INTEGER,
      max_hr INTEGER,
      cadence INTEGER,
      steps INTEGER,
      location TEXT,
      source TEXT,
      weather_temp TEXT,
      weather_hum TEXT,
      zones_json TEXT,
      device_name TEXT,
      device_manufacturer TEXT,
      device_model TEXT,
      device_hw_version TEXT,
      device_sw_version TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

applyMigration(2, () => {
  const existingColumns = db.prepare('PRAGMA table_info(workouts)').all() as Array<{ name: string }>;
  const existingColumnNames = new Set(existingColumns.map((column) => column.name));

  const requiredColumns: Array<{ name: string; definition: string }> = [
    { name: 'activity_name', definition: 'TEXT' },
    { name: 'avg_intensity', definition: 'INTEGER DEFAULT 0' },
    { name: 'min_intensity', definition: 'INTEGER DEFAULT 0' },
    { name: 'max_intensity', definition: 'INTEGER DEFAULT 0' },
    { name: 'average_mets', definition: 'REAL DEFAULT 0' },
    { name: 'min_hr', definition: 'INTEGER DEFAULT 0' },
    { name: 'location', definition: "TEXT DEFAULT 'Unknown'" },
    { name: 'source', definition: "TEXT DEFAULT 'Unknown'" },
    { name: 'device_name', definition: "TEXT DEFAULT 'Unknown'" },
    { name: 'device_manufacturer', definition: "TEXT DEFAULT 'Unknown'" },
    { name: 'device_model', definition: "TEXT DEFAULT 'Unknown'" },
    { name: 'device_hw_version', definition: "TEXT DEFAULT 'Unknown'" },
    { name: 'device_sw_version', definition: "TEXT DEFAULT 'Unknown'" },
  ];

  for (const column of requiredColumns) {
    if (!existingColumnNames.has(column.name)) {
      db.exec(`ALTER TABLE workouts ADD COLUMN ${column.name} ${column.definition}`);
    }
  }
});

applyMigration(3, () => {
  db.exec('CREATE INDEX IF NOT EXISTS idx_workouts_start_date ON workouts(start_date DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_workouts_created_at ON workouts(created_at DESC)');
});

applyMigration(4, () => {
  const existingColumns = db.prepare('PRAGMA table_info(workouts)').all() as Array<{ name: string }>;
  const existingColumnNames = new Set(existingColumns.map((column) => column.name));

  if (!existingColumnNames.has('hrv')) {
    db.exec('ALTER TABLE workouts ADD COLUMN hrv INTEGER');
  }
  if (!existingColumnNames.has('pace_zones_json')) {
    db.exec('ALTER TABLE workouts ADD COLUMN pace_zones_json TEXT');
  }
});

applyMigration(5, () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shoes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      brand TEXT,
      model TEXT,
      max_distance REAL,
      distance_run REAL DEFAULT 0,
      is_active BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const existingColumns = db.prepare('PRAGMA table_info(workouts)').all() as Array<{ name: string }>;
  const existingColumnNames = new Set(existingColumns.map((column) => column.name));

  if (!existingColumnNames.has('shoe_id')) {
    db.exec('ALTER TABLE workouts ADD COLUMN shoe_id TEXT REFERENCES shoes(id)');
  }
  if (!existingColumnNames.has('tags_json')) {
    db.exec('ALTER TABLE workouts ADD COLUMN tags_json TEXT');
  }
  if (!existingColumnNames.has('route_json')) {
    db.exec('ALTER TABLE workouts ADD COLUMN route_json TEXT');
  }
});

applyMigration(6, () => {
  // 1. Training Plans
  db.exec(`
    CREATE TABLE IF NOT EXISTS training_plans (
      id TEXT PRIMARY KEY,
      goal TEXT NOT NULL,
      status TEXT DEFAULT 'active', -- active, completed, cancelled
      sessions_json TEXT,         -- Store the full plan as JSON
      start_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      end_date DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. Personal Bests
  db.exec(`
    CREATE TABLE IF NOT EXISTS personal_bests (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,         -- '1k', '5k', '10k', 'half', 'full'
      value REAL NOT NULL,        -- store as seconds or pace
      workout_uuid TEXT REFERENCES workouts(uuid),
      achieved_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(type)                -- Only one best for each type
    )
  `);

  // 3. Body Metrics
  db.exec(`
    CREATE TABLE IF NOT EXISTS body_metrics (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      weight REAL,
      muscle_mass REAL,
      fat_percentage REAL,
      soreness_level INTEGER,     -- 1-10
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 4. Routes (Route Intelligence)
  db.exec(`
    CREATE TABLE IF NOT EXISTS routes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      fingerprint TEXT UNIQUE,    -- Used to match route geometry
      distance REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const existingColumns = db.prepare('PRAGMA table_info(workouts)').all() as Array<{ name: string }>;
  const existingColumnNames = new Set(existingColumns.map((column) => column.name));

  if (!existingColumnNames.has('route_id')) {
    db.exec('ALTER TABLE workouts ADD COLUMN route_id TEXT REFERENCES routes(id)');
  }
});

applyMigration(7, () => {
  // Personal bests were previously stored as one row per distance with a
  // UNIQUE(type) constraint that made INSERT OR REPLACE delete the old row.
  // They are now stored per (distance, condition) — indoor efforts should not
  // overwrite outdoor records — and are written with plain UPDATE/INSERT.
  //
  // The old values were derived from the workout average pace, which made every
  // distance share the same number, so they are discarded instead of migrated.
  db.exec('DROP TABLE IF EXISTS personal_bests_legacy');
  db.exec('ALTER TABLE personal_bests RENAME TO personal_bests_legacy');

  db.exec(`
    CREATE TABLE personal_bests (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,                -- '1k', '5k', '10k', 'half', 'full'
      value REAL NOT NULL,               -- best estimated pace in minutes per km
      workout_uuid TEXT REFERENCES workouts(uuid) ON DELETE CASCADE,
      achieved_at DATETIME,
      condition TEXT NOT NULL DEFAULT 'outdoor',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(type, condition)
    )
  `);

  db.exec('DROP TABLE personal_bests_legacy');
  db.exec('CREATE INDEX IF NOT EXISTS idx_personal_bests_type ON personal_bests(type, condition)');
});

applyMigration(8, () => {
  // The AI coach chat keeps its history locally, in the same database as the
  // workouts, so conversations survive reloads.
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_chat_messages (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,          -- 'user' | 'assistant'
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_ai_chat_created ON ai_chat_messages(created_at)');
});

applyMigration(9, () => {
  // Segments are named slices of a course, anchored by two geographic points.
  // Efforts are computed per workout from its stored GPS track; a workout is
  // referenced by uuid (matching personal_bests) so deleting a workout cleans
  // up its efforts.
  db.exec(`
    CREATE TABLE IF NOT EXISTS segments (
      id TEXT PRIMARY KEY,
      route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      start_lat REAL NOT NULL,
      start_lng REAL NOT NULL,
      end_lat REAL NOT NULL,
      end_lng REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_segments_route ON segments(route_id)');
  db.exec(`
    CREATE TABLE IF NOT EXISTS segment_efforts (
      id TEXT PRIMARY KEY,
      segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
      workout_uuid TEXT NOT NULL REFERENCES workouts(uuid) ON DELETE CASCADE,
      seconds INTEGER NOT NULL,
      pace REAL NOT NULL,
      distance REAL NOT NULL,
      started_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(segment_id, workout_uuid)
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_segment_efforts ON segment_efforts(segment_id, seconds)');
});

export default db;
