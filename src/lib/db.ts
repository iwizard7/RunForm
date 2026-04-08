import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'workouts.db');

fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

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

export default db;
