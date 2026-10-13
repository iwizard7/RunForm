import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { backupsDir, isSqliteBuffer, sanitizeBackupFileName, validateBackupFile } from '@/lib/backup';
import { DB_DIR } from '@/lib/db';

/**
 * Backup file transfer for the Settings panel.
 *
 * GET  /api/backup?file=<name> — downloads a backup from the backups dir.
 * POST /api/backup (multipart field "file") — uploads a backup from another
 *      machine into the backups dir after SQLite header + integrity checks.
 *
 * Server actions are limited to small request bodies, which a multi-megabyte
 * database file would exceed, so the binary transfer lives in a route handler.
 */

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export async function GET(request: NextRequest) {
  const safe = sanitizeBackupFileName(request.nextUrl.searchParams.get('file'));
  if (!safe) {
    return NextResponse.json({ error: 'Invalid backup file name' }, { status: 400 });
  }

  const full = path.join(backupsDir(DB_DIR), safe);
  if (!fs.existsSync(full)) {
    return NextResponse.json({ error: 'Backup not found' }, { status: 404 });
  }

  return new Response(fs.readFileSync(full), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safe}"`,
      'Cache-Control': 'no-store',
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: 'The file is larger than 50 MB' }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!isSqliteBuffer(buffer)) {
      return NextResponse.json({ error: 'The file is not a SQLite database' }, { status: 400 });
    }

    const dir = backupsDir(DB_DIR);
    fs.mkdirSync(dir, { recursive: true });

    // Keep the uploaded name when it is safe, otherwise generate one; never
    // overwrite an existing backup.
    const base = sanitizeBackupFileName(file.name) ?? `runform-backup-upload-${Date.now()}.db`;
    let fileName = base;
    let full = path.join(dir, fileName);
    let attempt = 2;
    while (fs.existsSync(full)) {
      fileName = base.replace(/\.db$/, `-${attempt}.db`);
      full = path.join(dir, fileName);
      attempt += 1;
    }
    fs.writeFileSync(full, buffer);

    const validation = validateBackupFile(full);
    if (!validation.valid) {
      fs.rmSync(full, { force: true });
      return NextResponse.json({ error: validation.error ?? 'Invalid backup file' }, { status: 400 });
    }

    return NextResponse.json({ success: true, fileName, workouts: validation.workouts });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
