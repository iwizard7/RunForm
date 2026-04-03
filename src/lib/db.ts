import Database from 'better-sqlite3';
import path from 'path';

// Using a persistent DB file in the data folder
const DB_PATH = path.join(process.cwd(), 'data', 'workouts.db');
const db = new Database(DB_PATH);

// Initialize Tables
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

const existingColumns = db.prepare(`PRAGMA table_info(workouts)`).all() as Array<{ name: string }>;
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

export default db;
