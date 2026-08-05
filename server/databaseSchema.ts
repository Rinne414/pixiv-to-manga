import type { DatabaseSync } from 'node:sqlite'
import type { Row } from './databaseRows'

/** Creates all tables and applies additive column migrations (idempotent). */
export function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      mode TEXT NOT NULL,
      source TEXT NOT NULL,
      readingDirection TEXT NOT NULL DEFAULT 'rtl',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      storyBibleJson TEXT,
      letteringJson TEXT
    );
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      filePath TEXT NOT NULL,
      mimeType TEXT NOT NULL,
      sourceUrl TEXT,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      pageIndex INTEGER NOT NULL,
      originalAssetId TEXT NOT NULL REFERENCES assets(id),
      previewAssetId TEXT REFERENCES assets(id),
      status TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      panelsJson TEXT,
      cleanupJson TEXT
    );
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      voice TEXT NOT NULL,
      color TEXT NOT NULL,
      fontFamily TEXT,
      bubbleStyle TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dialogues (
      id TEXT PRIMARY KEY,
      pageId TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      characterId TEXT,
      characterName TEXT,
      text TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      scale REAL NOT NULL,
      rotation REAL NOT NULL,
      bubbleStyle TEXT NOT NULL,
      color TEXT NOT NULL,
      locked INTEGER NOT NULL,
      textDirection TEXT,
      fontFamily TEXT,
      rawJson TEXT
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      progress REAL NOT NULL,
      message TEXT NOT NULL,
      error TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      baseUrl TEXT NOT NULL,
      defaultModel TEXT NOT NULL,
      isLocal INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fonts (
      id TEXT PRIMARY KEY,
      familyName TEXT NOT NULL,
      fileName TEXT NOT NULL,
      filePath TEXT NOT NULL,
      format TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS model_capabilities (
      id TEXT PRIMARY KEY,
      providerId TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
      modelId TEXT NOT NULL,
      supportsVision INTEGER NOT NULL,
      supportsStreaming INTEGER NOT NULL,
      supportsJsonSchema INTEGER NOT NULL,
      allowsAdultInput INTEGER NOT NULL,
      allowsAdultGeneration INTEGER NOT NULL,
      supportsImageGeneration INTEGER NOT NULL DEFAULT 0,
      contextWindow INTEGER,
      notes TEXT NOT NULL,
      source TEXT NOT NULL,
      capabilitySourcesJson TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE(providerId, modelId)
    );
    CREATE TABLE IF NOT EXISTS pixiv_tasks (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      r18Enabled INTEGER NOT NULL,
      usePixivSession INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      totalItems INTEGER NOT NULL,
      completedItems INTEGER NOT NULL DEFAULT 0,
      failedItems INTEGER NOT NULL DEFAULT 0,
      requestDelayMs INTEGER NOT NULL,
      retryAt TEXT,
      pauseReason TEXT,
      error TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pixiv_task_items (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL REFERENCES pixiv_tasks(id) ON DELETE CASCADE,
      artworkId TEXT NOT NULL,
      pageIndex INTEGER NOT NULL,
      sourceUrl TEXT NOT NULL,
      fileName TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      assetId TEXT REFERENCES assets(id),
      pageId TEXT REFERENCES pages(id),
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE(taskId, artworkId, pageIndex, sourceUrl)
    );
    CREATE TABLE IF NOT EXISTS pixiv_import_records (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      artworkId TEXT NOT NULL,
      pageIndex INTEGER NOT NULL,
      sourceUrl TEXT NOT NULL,
      sourceRevision TEXT NOT NULL,
      fileName TEXT NOT NULL,
      assetId TEXT NOT NULL REFERENCES assets(id),
      pageId TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      createdAt TEXT NOT NULL,
      UNIQUE(projectId, artworkId, pageIndex, sourceRevision)
    );
    CREATE INDEX IF NOT EXISTS pixiv_task_items_status_idx ON pixiv_task_items(taskId, status);
    CREATE INDEX IF NOT EXISTS pixiv_import_records_lookup_idx ON pixiv_import_records(projectId, artworkId, pageIndex, sourceUrl);
  `)
  ensureColumn(db, 'model_capabilities', 'supportsImageGeneration', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'model_capabilities', 'capabilitySourcesJson', "TEXT NOT NULL DEFAULT '{}'")
  ensureColumn(db, 'dialogues', 'tailX', 'REAL')
  ensureColumn(db, 'dialogues', 'tailY', 'REAL')
  ensureColumn(db, 'dialogues', 'textDirection', 'TEXT')
  ensureColumn(db, 'dialogues', 'fontFamily', 'TEXT')
  ensureColumn(db, 'pages', 'panelsJson', 'TEXT')
  ensureColumn(db, 'pages', 'cleanupJson', 'TEXT')
  ensureColumn(db, 'projects', 'readingDirection', "TEXT NOT NULL DEFAULT 'rtl'")
  ensureColumn(db, 'projects', 'letteringJson', 'TEXT')
  ensureColumn(db, 'pixiv_tasks', 'usePixivSession', 'INTEGER NOT NULL DEFAULT 0')
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  // SQLite cannot bind identifiers, so restrict interpolation to literal-safe names.
  const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/
  if (!identifier.test(table) || !identifier.test(column)) {
    throw new Error('ensureColumn requires plain identifier names')
  }
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Row[]
  if (rows.some((row) => row.name === column)) {
    return
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`)
}
