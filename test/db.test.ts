/**
 * Database and server-action integration suite.
 *
 * This file must be launched through `test/db-entry.cjs`, which points
 * RUNFORM_DATA_DIR at a throwaway directory before the database module is
 * loaded. Run it directly and it refuses to touch anything.
 *
 * The database and the server actions are imported statically so that all
 * module loading happens while the launcher's environment is in effect.
 */
import fs from 'fs';
import path from 'path';
import db from '@/lib/db';
import {
  addChatMessage,
  addShoe,
  assignShoeToWorkout,
  clearAllWorkouts,
  clearChatMessages,
  ensurePersonalBests,
  getAllWorkouts,
  getChatMessages,
  getShoes,
  matchAndAssignRoute,
  saveWorkout,
  updateWorkoutTags,
} from '@/lib/actions';
import { parseWorkoutJSON } from '@/lib/parser';
import {
  backupsDir,
  createBackup,
  listBackups,
  restoreBackup,
  sanitizeBackupFileName,
  validateBackupFile,
} from '@/lib/backup';
import { assert, assertEqual, group, summarize, test } from './harness';

/**
 * Runs the database suite. The launcher awaits this so that the process does
 * not finish before asynchronous checks have settled.
 */
export async function runDatabaseSuite(): Promise<void> {
  if (!process.env.RUNFORM_DATA_DIR) {
    console.error('Refusing to run the database suite without RUNFORM_DATA_DIR set.');
    process.exit(2);
  }

  const dataDir = process.env.RUNFORM_DATA_DIR as string;

  const baseWorkout = {
    uuid: 'test-workout-1',
    name: 'Running',
    startDate: '2026-05-01T10:00:00Z',
    endDate: '2026-05-01T10:50:00Z',
    duration: { value: 3000, unit: 'sec' },
    activeCalories: { value: 620, unit: 'kcal' },
    distance: { value: 10.4, unit: 'km' },
    pace: { value: "5'20\"", unit: 'min/km' },
    averageIntensity: { value: 4, unit: '' },
    minIntensity: { value: 2, unit: '' },
    maxIntensity: { value: 7, unit: '' },
    averageMETs: { value: 9, unit: '' },
    averageHeartRate: { value: 148, unit: 'bpm' },
    minHeartRate: { value: 100, unit: 'bpm' },
    maxHeartRate: { value: 178, unit: 'bpm' },
    cadence: { value: 160, unit: 'spm' },
    step: { value: 9100, unit: 'steps' },
    zones: {
      zone4: { name: 'CARDIO', rate: 0.4, time: { value: 1200, unit: 'sec' } },
      zone2: { name: 'FAT BURN', rate: 0.5, time: { value: 1500, unit: 'sec' } },
    },
    location: 'Outdoor',
    source: 'Test',
    weather: { temperature: '18C', humidity: '40%' },
    device: { name: 'Watch', manufacturer: 'Test', model: 'M', hardwareVersion: '1', softwareVersion: '1' },
    activity: { name: 'Running', type: 37 },
  };

  group('database: setup');

  test('the database is created inside RUNFORM_DATA_DIR', () => {
    assertEqual(fs.existsSync(path.join(dataDir, 'workouts.db')), true, 'db file exists');
  });

  test('foreign keys are enforced', async () => {
    const row = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    assertEqual(row.foreign_keys, 1, 'PRAGMA foreign_keys must be 1');
  });

  test('all migrations are recorded', async () => {
    const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>;
    assert(rows.length >= 7, `expected at least 7 migrations, got ${rows.length}`);
  });

  test('personal_bests has the condition column', async () => {
    const columns = db.prepare('PRAGMA table_info(personal_bests)').all() as Array<{ name: string }>;
    const names = columns.map((column) => column.name);
    assert(names.includes('condition'), `condition column missing (${names.join(',')})`);
  });

  test('a workout referencing a missing uuid is rejected', async () => {
    let rejected = false;
    try {
      db.prepare(
        'INSERT INTO personal_bests (id, type, value, workout_uuid, achieved_at, condition) VALUES (?,?,?,?,?,?)',
      ).run('bad-row', '1k', 6, 'does-not-exist', '2026-01-01', 'outdoor');
    } catch {
      rejected = true;
    }
    assertEqual(rejected, true, 'foreign key violation expected');
  });

  group('database: workout storage');

  test('a new workout is stored and not flagged as a duplicate', async () => {
    const result = await saveWorkout(parseWorkoutJSON(baseWorkout));
    assertEqual(result.success, true, 'save succeeded');
    assertEqual(result.duplicate, false, 'first import is not a duplicate');
  });

  test('the workout round-trips through the database', async () => {
    const all = await getAllWorkouts();
    assertEqual(all.length, 1, 'one workout stored');
    assertEqual(all[0].distance, 10.4, 'distance preserved');
    assertEqual(all[0].tags?.length, 0, 'tags default to an empty array');
  });

  test('re-importing the same uuid reports a duplicate', async () => {
    const second = await saveWorkout(parseWorkoutJSON(baseWorkout));
    assertEqual(second.duplicate, true, 'duplicate flagged');
  });

  test('the duplicate replaced the previous row instead of duplicating it', async () => {
    const all = await getAllWorkouts();
    assertEqual(all.length, 1, 'still one workout');
  });

  group('database: personal bests');

  test('records were stored for every covered distance', async () => {
    const rows = db.prepare('SELECT type, value, condition FROM personal_bests ORDER BY type').all() as Array<{
      type: string;
      value: number;
      condition: string;
    }>;
    const types = rows.map((row) => row.type).sort();
    assertEqual(types.join(','), '10k,1k,5k', 'three distinct records');
    const distinct = new Set(rows.map((row) => row.value));
    assertEqual(distinct.size, 3, 'each distance has its own value');
    assert(rows.every((row) => row.condition === 'outdoor'), 'condition recorded as outdoor');
  });

  test('slower workouts do not overwrite records', async () => {
    const slower = parseWorkoutJSON({
      ...baseWorkout,
      uuid: 'test-workout-slow',
      startDate: '2026-05-02T10:00:00Z',
      pace: { value: "6'30\"", unit: 'min/km' },
      distance: { value: 10.4, unit: 'km' },
    });
    await saveWorkout(slower);
    const rows = db.prepare('SELECT value FROM personal_bests WHERE type = ? AND condition = ?').all('5k', 'outdoor') as Array<{
      value: number;
    }>;
    assertEqual(rows.length, 1, 'one 5k record');
    assert(rows[0].value < 5.5, `record should stay fast, got ${rows[0].value}`);
  });

  test('a faster workout replaces the record', async () => {
    const faster = parseWorkoutJSON({
      ...baseWorkout,
      uuid: 'test-workout-fast',
      startDate: '2026-05-03T10:00:00Z',
      pace: { value: "4'45\"", unit: 'min/km' },
      distance: { value: 10.4, unit: 'km' },
    });
    await saveWorkout(faster);
    const row = db.prepare('SELECT value, workout_uuid FROM personal_bests WHERE type = ? AND condition = ?').get(
      '5k',
      'outdoor',
    ) as { value: number; workout_uuid: string };
    assert(row !== undefined, 'a 5k record exists');
    assert(row.value < 4.75, `record should improve, got ${row.value}`);
    assertEqual(row.workout_uuid, 'test-workout-fast', 'record points at the fast workout');
  });

  test('indoor and outdoor records are kept separately', async () => {
    const indoor = parseWorkoutJSON({
      ...baseWorkout,
      uuid: 'test-workout-indoor',
      startDate: '2026-05-04T10:00:00Z',
      location: 'Indoor',
      pace: { value: "7'30\"", unit: 'min/km' },
    });
    await saveWorkout(indoor);
    const rows = db.prepare('SELECT condition, value FROM personal_bests WHERE type = ?').all('5k') as Array<{
      condition: string;
      value: number;
    }>;
    assertEqual(rows.length, 2, 'one record per condition');
    const outdoor = rows.find((row) => row.condition === 'outdoor');
    assert(outdoor !== undefined && outdoor.value < 4.75, 'slower indoor run did not touch the outdoor record');
  });

  test('clearing workouts removes dependent records', async () => {
    await clearAllWorkouts();
    const remaining = db.prepare('SELECT COUNT(*) AS count FROM personal_bests').get() as { count: number };
    assertEqual(remaining.count, 0, 'records cascade-deleted');
    const workouts = db.prepare('SELECT COUNT(*) AS count FROM workouts').get() as { count: number };
    assertEqual(workouts.count, 0, 'workouts cleared');
  });

  group('database: equipment');

  test('adding a shoe and assigning it updates the distance', async () => {
    const shoe = await addShoe({ name: 'Test Shoe', brand: 'Brand', model: 'Model', maxDistance: 800 });
    assertEqual(shoe.success, true, 'shoe created');
    await saveWorkout(parseWorkoutJSON(baseWorkout));
    await assignShoeToWorkout('test-workout-1', shoe.id);
    const shoes = await getShoes();
    const stored = shoes.find((item) => item.id === shoe.id);
    assert(stored !== undefined, 'shoe found');
    assertEqual(stored!.distanceRun, 10.4, 'distance accumulated');
  });

  test('assigning an unknown shoe is rejected by the foreign key', async () => {
    let rejected = false;
    try {
      await assignShoeToWorkout('test-workout-1', 'missing-shoe');
    } catch {
      rejected = true;
    }
    assertEqual(rejected, true, 'foreign key violation expected');
  });

  group('database: routes');

  test('a GPS track is stored and matched to a route', async () => {
    const route = Array.from({ length: 30 }, (_, index) => ({
      lat: 55.75 + index * 0.0004,
      lng: 37.62 + index * 0.0004,
    }));
    const withRoute = await saveWorkout(parseWorkoutJSON({ ...baseWorkout, uuid: 'test-workout-route', route }));
    assertEqual(withRoute.success, true, 'workout with route saved');
    const row = db.prepare('SELECT route_id FROM workouts WHERE uuid = ?').get('test-workout-route') as {
      route_id: string | null;
    };
    assert(row.route_id !== null, 'route assigned');
    const routes = db.prepare('SELECT id, name FROM routes').all() as Array<{ id: string; name: string }>;
    assertEqual(routes.length, 1, 'one route created');
    assertEqual(routes[0].name, 'Route 1', 'route got a generated name');
  });

  test('a second run on the same course reuses the route', async () => {
    const route = Array.from({ length: 30 }, (_, index) => ({
      lat: 55.75 + index * 0.0004,
      lng: 37.62 + index * 0.0004,
    }));
    const result = await matchAndAssignRoute('test-workout-1', JSON.stringify(route));
    assertEqual(result.success, true, 'matching succeeded');
    const routes = db.prepare('SELECT id FROM routes').all() as Array<{ id: string }>;
    assertEqual(routes.length, 1, 'route reused, not duplicated');
  });

  test('a workout without GPS gets no route', async () => {
    await saveWorkout(parseWorkoutJSON({ ...baseWorkout, uuid: 'test-workout-nogps' }));
    const row = db.prepare('SELECT route_id FROM workouts WHERE uuid = ?').get('test-workout-nogps') as {
      route_id: string | null;
    };
    assertEqual(row.route_id, null, 'no route assigned');
  });

  test('a too-short track is rejected instead of creating a route', async () => {
    await saveWorkout(parseWorkoutJSON({ ...baseWorkout, uuid: 'test-workout-short' }));
    const result = await matchAndAssignRoute('test-workout-short', JSON.stringify([{ lat: 1, lng: 1 }]));
    assertEqual(result.success, false, 'short track rejected');
    const routes = db.prepare('SELECT COUNT(*) AS count FROM routes').get() as { count: number };
    assertEqual(routes.count, 1, 'no extra route created');
  });

  group('database: re-import safety');

  test('re-importing a workout keeps user edits and personal bests', async () => {
    const shoe = await addShoe({ name: 'Reimport Shoe', brand: 'Brand', model: 'Model', maxDistance: 500 });
    await saveWorkout(parseWorkoutJSON({ ...baseWorkout, uuid: 'test-workout-reimport' }));
    await assignShoeToWorkout('test-workout-reimport', shoe.id);
    await updateWorkoutTags('test-workout-reimport', ['race']);

    const before = db.prepare('SELECT COUNT(*) AS count FROM personal_bests').get() as { count: number };

    // The old INSERT OR REPLACE deleted the row, which cascade-deleted the
    // personal bests pointing at it and wiped the shoe/tags edits.
    const result = await saveWorkout(parseWorkoutJSON({ ...baseWorkout, uuid: 'test-workout-reimport' }));
    assertEqual(result.duplicate, true, 're-import flagged as duplicate');

    const row = db.prepare('SELECT shoe_id, tags_json FROM workouts WHERE uuid = ?').get('test-workout-reimport') as {
      shoe_id: string | null;
      tags_json: string | null;
    };
    assertEqual(row.shoe_id, shoe.id, 'shoe assignment survives re-import');
    assertEqual(row.tags_json, '["race"]', 'tags survive re-import');

    const after = db.prepare('SELECT COUNT(*) AS count FROM personal_bests').get() as { count: number };
    assert(after.count >= before.count, `personal bests survive re-import (${before.count} -> ${after.count})`);
  });

  test('ensurePersonalBests rebuilds only when the table is empty', async () => {
    const populated = await ensurePersonalBests();
    assertEqual(populated.rebuilt, false, 'no rebuild while records exist');

    db.prepare('DELETE FROM personal_bests').run();
    const rebuilt = await ensurePersonalBests();
    assertEqual(rebuilt.rebuilt, true, 'rebuild triggered on empty table');
    assert(rebuilt.records > 0, 'records restored from history');
  });

  group('database: ai chat');

  test('chat messages round-trip in chronological order', async () => {
    await clearChatMessages();
    const first = await addChatMessage('user', 'How was my week?');
    const second = await addChatMessage('assistant', 'Solid week, 32 km total.');
    assertEqual(first.success, true, 'user message stored');
    assertEqual(second.success, true, 'assistant message stored');

    const messages = await getChatMessages();
    assertEqual(messages.length, 2, 'both messages returned');
    assertEqual(messages[0].role, 'user', 'oldest message first');
    assertEqual(messages[0].content, 'How was my week?', 'user content preserved');
    assertEqual(messages[1].role, 'assistant', 'assistant message second');
  });

  test('empty chat messages are rejected', async () => {
    const result = await addChatMessage('user', '   ');
    assertEqual(result.success, false, 'blank message rejected');
    const messages = await getChatMessages();
    assertEqual(messages.length, 2, 'chat unchanged');
  });

  test('clearChatMessages empties the conversation', async () => {
    await clearChatMessages();
    const messages = await getChatMessages();
    assertEqual(messages.length, 0, 'chat cleared');
  });

  group('database: backups');

  test('backup file names cannot escape the backups directory', () => {
    assertEqual(
      sanitizeBackupFileName('runform-backup-2026-10-13T210000.db'),
      'runform-backup-2026-10-13T210000.db',
      'plain backup name accepted',
    );
    assertEqual(sanitizeBackupFileName('../escape.db'), null, 'parent traversal rejected');
    assertEqual(sanitizeBackupFileName('sub/dir.db'), null, 'nested path rejected');
    assertEqual(sanitizeBackupFileName('evil.exe'), null, 'non-db extension rejected');
    assertEqual(sanitizeBackupFileName('.hidden.db'), null, 'hidden file rejected');
    assertEqual(sanitizeBackupFileName(''), null, 'empty name rejected');
    assertEqual(sanitizeBackupFileName(null), null, 'non-string rejected');
  });

  test('createBackup writes a verifiable snapshot', async () => {
    const before = db.prepare('SELECT COUNT(*) AS count FROM workouts').get() as { count: number };

    const entry = await createBackup(dataDir);
    assert(entry.fileName.endsWith('.db'), 'backup file has a .db extension');
    assert(entry.sizeBytes > 0, 'backup file is not empty');

    const listed = listBackups(dataDir).some((item) => item.fileName === entry.fileName);
    assertEqual(listed, true, 'backup shows up in the listing');

    const validation = validateBackupFile(path.join(backupsDir(dataDir), entry.fileName));
    assertEqual(validation.valid, true, 'backup passes the integrity check');
    assertEqual(validation.workouts, before.count, 'snapshot keeps the workout count');
  });

  test('restoreBackup brings back replaced data and saves a safety copy', async () => {
    const before = db.prepare('SELECT COUNT(*) AS count FROM workouts').get() as { count: number };

    await saveWorkout(parseWorkoutJSON({ ...baseWorkout, uuid: 'test-backup-extra' }));
    const backup = await createBackup(dataDir);

    await clearAllWorkouts();
    const cleared = db.prepare('SELECT COUNT(*) AS count FROM workouts').get() as { count: number };
    assertEqual(cleared.count, 0, 'database emptied before the restore');

    const result = await restoreBackup(dataDir, backup.fileName);
    assertEqual(result.restoredWorkouts, before.count + 1, 'workout count restored');

    const restored = db
      .prepare('SELECT COUNT(*) AS count FROM workouts WHERE uuid = ?')
      .get('test-backup-extra') as { count: number };
    assertEqual(restored.count, 1, 'the extra workout is back after the restore');

    const names = listBackups(dataDir).map((entry) => entry.fileName);
    assert(
      names.some((name) => name.includes('prerestore')),
      'a safety copy of the pre-restore state was created',
    );
  });

  test('restoreBackup refuses files that are not RunForm databases', async () => {
    fs.mkdirSync(backupsDir(dataDir), { recursive: true });
    const garbage = path.join(backupsDir(dataDir), 'garbage.db');
    fs.writeFileSync(garbage, 'not a database at all');
    const before = db.prepare('SELECT COUNT(*) AS count FROM workouts').get() as { count: number };

    let threw = false;
    try {
      await restoreBackup(dataDir, 'garbage.db');
    } catch {
      threw = true;
    }
    assertEqual(threw, true, 'invalid backup rejected');

    const after = db.prepare('SELECT COUNT(*) AS count FROM workouts').get() as { count: number };
    assertEqual(after.count, before.count, 'database untouched after the rejected restore');
    fs.rmSync(garbage, { force: true });
  });

  test('restoreBackup rejects traversal names even when the file exists', async () => {
    let threw = false;
    try {
      await restoreBackup(dataDir, '../workouts.db');
    } catch {
      threw = true;
    }
    assertEqual(threw, true, 'path traversal name rejected');
  });

  return summarize('database/actions suite');
}
