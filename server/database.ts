import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import {
  assetUrlFromRelativePath,
  databasePath,
  ensureAppDirs,
  getAppDataDir,
  projectAssetDir,
} from './paths'
import type {
  Asset,
  BubbleStyle,
  Character,
  Dialogue,
  ModelCapability,
  Page,
  Project,
  ProjectDetail,
  ProjectMode,
  ProjectSource,
  ProviderProfile,
  StoryBible,
} from '../src/shared/types'

interface Row {
  [key: string]: unknown
}

export class StudioDatabase {
  private db: DatabaseSync

  constructor(dbPath = databasePath, seedSampleProject = true) {
    ensureAppDirs()
    this.db = new DatabaseSync(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec('PRAGMA foreign_keys = ON;')
    this.migrate()
    if (seedSampleProject) {
      this.ensureSampleProject()
    }
  }

  listProjects(): Project[] {
    return this.db
      .prepare('SELECT * FROM projects ORDER BY updatedAt DESC')
      .all()
      .map((row) => projectFromRow(row as Row))
  }

  getProjectDetail(projectId: string): ProjectDetail {
    const project = this.getProject(projectId)
    const pages = this.listPages(projectId)
    const assets = this.listAssets(projectId)
    const characters = this.listCharacters(projectId)
    const dialogues = pages.flatMap((page) => this.listDialogues(page.id))
    return { project, pages, assets, characters, dialogues }
  }

  getProject(projectId: string): Project {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Row | undefined
    if (!row) throw new Error('Project not found')
    return projectFromRow(row)
  }

  createProject(input: { title: string; mode: ProjectMode; source: ProjectSource }): Project {
    const now = new Date().toISOString()
    const id = randomUUID()
    this.db
      .prepare(
        'INSERT INTO projects (id, title, mode, source, createdAt, updatedAt, storyBibleJson) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, input.title, input.mode, input.source, now, now, null)
    return this.getProject(id)
  }

  upsertSetting(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value)
  }

  getSetting(key: string, fallback = ''): string {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as Row | undefined
    return typeof row?.value === 'string' ? row.value : fallback
  }

  saveStoryBible(projectId: string, storyBible: StoryBible): void {
    const now = new Date().toISOString()
    this.db
      .prepare('UPDATE projects SET storyBibleJson = ?, updatedAt = ? WHERE id = ?')
      .run(JSON.stringify(storyBible), now, projectId)

    this.db.prepare('DELETE FROM characters WHERE projectId = ?').run(projectId)
    for (const character of storyBible.characters) {
      this.createCharacter(projectId, character)
    }
  }

  createAsset(input: {
    projectId: string
    kind: Asset['kind']
    relativePath: string
    mimeType: string
    sourceUrl?: string
    width?: number
    height?: number
  }): Asset {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.db
      .prepare(
        'INSERT INTO assets (id, projectId, kind, filePath, mimeType, sourceUrl, width, height, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        input.projectId,
        input.kind,
        input.relativePath,
        input.mimeType,
        input.sourceUrl || null,
        input.width || 1200,
        input.height || 1600,
        now,
      )
    return this.getAsset(id)
  }

  getAsset(assetId: string): Asset {
    const row = this.db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId) as Row | undefined
    if (!row) throw new Error('Asset not found')
    return assetFromRow(row)
  }

  listAssets(projectId: string): Asset[] {
    return this.db
      .prepare('SELECT * FROM assets WHERE projectId = ? ORDER BY createdAt ASC')
      .all(projectId)
      .map((row) => assetFromRow(row as Row))
  }

  createPage(input: {
    projectId: string
    index: number
    originalAssetId: string
    previewAssetId?: string
    width?: number
    height?: number
  }): Page {
    const id = randomUUID()
    this.db
      .prepare(
        'INSERT INTO pages (id, projectId, pageIndex, originalAssetId, previewAssetId, status, width, height) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        input.projectId,
        input.index,
        input.originalAssetId,
        input.previewAssetId || null,
        'ready',
        input.width || 1200,
        input.height || 1600,
      )
    return this.getPage(id)
  }

  getPage(pageId: string): Page {
    const row = this.db.prepare('SELECT * FROM pages WHERE id = ?').get(pageId) as Row | undefined
    if (!row) throw new Error('Page not found')
    return pageFromRow(row)
  }

  listPages(projectId: string): Page[] {
    return this.db
      .prepare('SELECT * FROM pages WHERE projectId = ? ORDER BY pageIndex ASC')
      .all(projectId)
      .map((row) => pageFromRow(row as Row))
  }

  updatePageStatus(pageId: string, status: Page['status']): void {
    this.db.prepare('UPDATE pages SET status = ? WHERE id = ?').run(status, pageId)
    const page = this.getPage(pageId)
    this.touchProject(page.projectId)
  }

  createCharacter(projectId: string, input: Partial<Character> & { name: string }): Character {
    const id = input.id || randomUUID()
    this.db
      .prepare(
        'INSERT INTO characters (id, projectId, name, description, voice, color, fontFamily, bubbleStyle) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        projectId,
        input.name,
        input.description || '',
        input.voice || '',
        input.color || '#141414',
        input.fontFamily || null,
        input.bubbleStyle || 'speech',
      )
    return this.listCharacters(projectId).find((character) => character.id === id)!
  }

  listCharacters(projectId: string): Character[] {
    return this.db
      .prepare('SELECT * FROM characters WHERE projectId = ? ORDER BY rowid ASC')
      .all(projectId)
      .map((row) => characterFromRow(row as Row))
  }

  replaceDialogues(pageId: string, dialogues: Dialogue[]): Dialogue[] {
    this.db.prepare('DELETE FROM dialogues WHERE pageId = ?').run(pageId)
    for (const dialogue of dialogues) {
      this.createDialogue(pageId, dialogue)
    }
    this.updatePageStatus(pageId, 'complete')
    return this.listDialogues(pageId)
  }

  createDialogue(pageId: string, input: Dialogue): Dialogue {
    const id = input.id || randomUUID()
    this.db
      .prepare(
        'INSERT INTO dialogues (id, pageId, characterId, characterName, text, x, y, scale, rotation, bubbleStyle, color, locked, rawJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        pageId,
        input.characterId || null,
        input.characterName || null,
        input.text,
        input.x,
        input.y,
        input.scale,
        input.rotation,
        input.bubbleStyle,
        input.color,
        input.locked ? 1 : 0,
        input.raw || null,
      )
    return this.listDialogues(pageId).find((dialogue) => dialogue.id === id)!
  }

  updateDialogue(id: string, patch: Partial<Dialogue>): Dialogue {
    const current = this.db.prepare('SELECT * FROM dialogues WHERE id = ?').get(id) as Row | undefined
    if (!current) throw new Error('Dialogue not found')
    const merged = { ...dialogueFromRow(current), ...patch }
    this.db
      .prepare(
        'UPDATE dialogues SET text = ?, x = ?, y = ?, scale = ?, rotation = ?, bubbleStyle = ?, color = ?, locked = ? WHERE id = ?',
      )
      .run(
        merged.text,
        merged.x,
        merged.y,
        merged.scale,
        merged.rotation,
        merged.bubbleStyle,
        merged.color,
        merged.locked ? 1 : 0,
        id,
      )
    return this.listDialogues(merged.pageId).find((dialogue) => dialogue.id === id)!
  }

  listDialogues(pageId: string): Dialogue[] {
    return this.db
      .prepare('SELECT * FROM dialogues WHERE pageId = ? ORDER BY rowid ASC')
      .all(pageId)
      .map((row) => dialogueFromRow(row as Row))
  }

  createJob(type: string, message: string): string {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.db
      .prepare(
        'INSERT INTO jobs (id, type, status, progress, message, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, type, 'queued', 0, message, now, now)
    return id
  }

  updateJob(id: string, status: string, progress: number, message: string, error?: string): void {
    this.db
      .prepare('UPDATE jobs SET status = ?, progress = ?, message = ?, error = ?, updatedAt = ? WHERE id = ?')
      .run(status, progress, message, error || null, new Date().toISOString(), id)
  }

  listProviders(hasApiKey: (providerId: string) => boolean = () => false): ProviderProfile[] {
    return this.db
      .prepare('SELECT * FROM providers ORDER BY updatedAt DESC')
      .all()
      .map((row) => providerFromRow(row as Row, hasApiKey(String((row as Row).id))))
  }

  getProvider(providerId: string, hasApiKey = false): ProviderProfile {
    const row = this.db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId) as Row | undefined
    if (!row) throw new Error('Provider not found')
    return providerFromRow(row, hasApiKey)
  }

  createProvider(input: { name: string; baseUrl: string; defaultModel: string; isLocal: boolean }): ProviderProfile {
    const now = new Date().toISOString()
    const id = randomUUID()
    this.db
      .prepare(
        'INSERT INTO providers (id, name, baseUrl, defaultModel, isLocal, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, input.name, input.baseUrl, input.defaultModel, input.isLocal ? 1 : 0, now, now)
    return this.getProvider(id)
  }

  updateProvider(
    providerId: string,
    patch: Partial<{ name: string; baseUrl: string; defaultModel: string; isLocal: boolean }>,
    hasApiKey = false,
  ): ProviderProfile {
    const current = this.getProvider(providerId, hasApiKey)
    const merged = { ...current, ...patch }
    const now = new Date().toISOString()
    this.db
      .prepare('UPDATE providers SET name = ?, baseUrl = ?, defaultModel = ?, isLocal = ?, updatedAt = ? WHERE id = ?')
      .run(merged.name, merged.baseUrl, merged.defaultModel, merged.isLocal ? 1 : 0, now, providerId)
    return this.getProvider(providerId, hasApiKey)
  }

  deleteProvider(providerId: string): void {
    this.db.prepare('DELETE FROM providers WHERE id = ?').run(providerId)
  }

  listModelCapabilities(providerId?: string): ModelCapability[] {
    const statement = providerId
      ? this.db.prepare('SELECT * FROM model_capabilities WHERE providerId = ? ORDER BY providerId ASC, modelId ASC')
      : this.db.prepare('SELECT * FROM model_capabilities ORDER BY providerId ASC, modelId ASC')
    const rows = providerId ? statement.all(providerId) : statement.all()
    return rows.map((row) => modelCapabilityFromRow(row as Row))
  }

  getModelCapability(id: string): ModelCapability {
    const row = this.db.prepare('SELECT * FROM model_capabilities WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new Error('Model capability not found')
    return modelCapabilityFromRow(row)
  }

  upsertModelCapability(
    input: {
      providerId: string
      modelId: string
      supportsVision?: boolean
      supportsImageGeneration?: boolean
      supportsStreaming?: boolean
      supportsJsonSchema?: boolean
      allowsAdultInput?: boolean
      allowsAdultGeneration?: boolean
      contextWindow?: number | null
      notes?: string
      source?: ModelCapability['source']
    },
  ): ModelCapability {
    const now = new Date().toISOString()
    const existing = this.db
      .prepare('SELECT * FROM model_capabilities WHERE providerId = ? AND modelId = ?')
      .get(input.providerId, input.modelId) as Row | undefined

    if (existing) {
      const current = modelCapabilityFromRow(existing)
      // Absent/undefined fields keep their stored value — an explicit undefined must not
      // reset a persisted flag to false.
      const definedInput = Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined),
      ) as typeof input
      const merged = {
        ...current,
        ...definedInput,
        contextWindow: input.contextWindow === undefined ? current.contextWindow : input.contextWindow || undefined,
        notes: input.notes ?? current.notes,
        source: input.source ?? current.source,
      }
      this.db
        .prepare(
          `UPDATE model_capabilities
           SET supportsVision = ?, supportsStreaming = ?, supportsJsonSchema = ?, allowsAdultInput = ?,
               allowsAdultGeneration = ?, supportsImageGeneration = ?, contextWindow = ?, notes = ?, source = ?, updatedAt = ?
           WHERE id = ?`,
        )
        .run(
          merged.supportsVision ? 1 : 0,
          merged.supportsStreaming ? 1 : 0,
          merged.supportsJsonSchema ? 1 : 0,
          merged.allowsAdultInput ? 1 : 0,
          merged.allowsAdultGeneration ? 1 : 0,
          merged.supportsImageGeneration ? 1 : 0,
          merged.contextWindow ?? null,
          merged.notes,
          merged.source,
          now,
          current.id,
        )
      return this.getModelCapability(current.id)
    }

    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO model_capabilities
          (id, providerId, modelId, supportsVision, supportsStreaming, supportsJsonSchema, allowsAdultInput,
           allowsAdultGeneration, supportsImageGeneration, contextWindow, notes, source, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.providerId,
        input.modelId,
        input.supportsVision ? 1 : 0,
        input.supportsStreaming ? 1 : 0,
        input.supportsJsonSchema ? 1 : 0,
        input.allowsAdultInput ? 1 : 0,
        input.allowsAdultGeneration ? 1 : 0,
        input.supportsImageGeneration ? 1 : 0,
        input.contextWindow ?? null,
        input.notes || '',
        input.source || 'discovered',
        now,
        now,
      )
    return this.getModelCapability(id)
  }

  updateModelCapability(id: string, patch: Partial<Omit<ModelCapability, 'id' | 'providerId' | 'modelId' | 'createdAt' | 'updatedAt'>>): ModelCapability {
    const current = this.getModelCapability(id)
    const merged = { ...current, ...patch }
    this.db
      .prepare(
        `UPDATE model_capabilities
         SET supportsVision = ?, supportsStreaming = ?, supportsJsonSchema = ?, allowsAdultInput = ?,
             allowsAdultGeneration = ?, supportsImageGeneration = ?, contextWindow = ?, notes = ?, source = ?, updatedAt = ?
         WHERE id = ?`,
      )
      .run(
        merged.supportsVision ? 1 : 0,
        merged.supportsStreaming ? 1 : 0,
        merged.supportsJsonSchema ? 1 : 0,
        merged.allowsAdultInput ? 1 : 0,
        merged.allowsAdultGeneration ? 1 : 0,
        merged.supportsImageGeneration ? 1 : 0,
        merged.contextWindow ?? null,
        merged.notes,
        merged.source,
        new Date().toISOString(),
        id,
      )
    return this.getModelCapability(id)
  }

  private touchProject(projectId: string): void {
    this.db.prepare('UPDATE projects SET updatedAt = ? WHERE id = ?').run(new Date().toISOString(), projectId)
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        mode TEXT NOT NULL,
        source TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        storyBibleJson TEXT
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
        height INTEGER NOT NULL
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
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        UNIQUE(providerId, modelId)
      );
    `)
    this.ensureColumn('model_capabilities', 'supportsImageGeneration', 'INTEGER NOT NULL DEFAULT 0')
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    // SQLite cannot bind identifiers, so restrict interpolation to literal-safe names.
    const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/
    if (!identifier.test(table) || !identifier.test(column)) {
      throw new Error('ensureColumn requires plain identifier names')
    }
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Row[]
    if (rows.some((row) => row.name === column)) {
      return
    }
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`)
  }

  private ensureSampleProject(): void {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM projects').get() as Row
    if (Number(row.count) > 0) {
      return
    }

    const project = this.createProject({
      title: '夏日邂逅的约定',
      mode: 'story',
      source: 'sample',
    })

    for (let index = 0; index < 3; index += 1) {
      const relativePath = path.join('projects', project.id, 'originals', `page-${index + 1}.svg`)
      const absolutePath = path.join(getAppDataDir(), relativePath)
      projectAssetDir(project.id, 'originals')
      writeFileSync(absolutePath, sampleMangaSvg(index), 'utf8')
      const asset = this.createAsset({
        projectId: project.id,
        kind: 'original',
        relativePath,
        mimeType: 'image/svg+xml',
        width: 1200,
        height: 1600,
      })
      this.createPage({
        projectId: project.id,
        index,
        originalAssetId: asset.id,
        width: 1200,
        height: 1600,
      })
    }

    if (!existsSync(path.join(getAppDataDir(), 'README.txt'))) {
      writeFileSync(path.join(getAppDataDir(), 'README.txt'), 'Pixiv-to-Manga Studio local project data.\n')
    }
  }
}

function projectFromRow(row: Row): Project {
  const storyBible = typeof row.storyBibleJson === 'string' ? (JSON.parse(row.storyBibleJson) as StoryBible) : undefined
  return {
    id: String(row.id),
    title: String(row.title),
    mode: row.mode as ProjectMode,
    source: row.source as ProjectSource,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    storyBible,
  }
}

function assetFromRow(row: Row): Asset {
  const filePath = String(row.filePath)
  return {
    id: String(row.id),
    projectId: String(row.projectId),
    kind: row.kind as Asset['kind'],
    url: assetUrlFromRelativePath(filePath),
    mimeType: String(row.mimeType),
    sourceUrl: typeof row.sourceUrl === 'string' ? row.sourceUrl : undefined,
    width: Number(row.width),
    height: Number(row.height),
  }
}

function pageFromRow(row: Row): Page {
  return {
    id: String(row.id),
    projectId: String(row.projectId),
    index: Number(row.pageIndex),
    originalAssetId: String(row.originalAssetId),
    previewAssetId: typeof row.previewAssetId === 'string' ? row.previewAssetId : undefined,
    status: row.status as Page['status'],
    width: Number(row.width),
    height: Number(row.height),
  }
}

function characterFromRow(row: Row): Character {
  return {
    id: String(row.id),
    projectId: String(row.projectId),
    name: String(row.name),
    description: String(row.description),
    voice: String(row.voice),
    color: String(row.color),
    fontFamily: typeof row.fontFamily === 'string' ? row.fontFamily : undefined,
    bubbleStyle: row.bubbleStyle as BubbleStyle,
  }
}

function dialogueFromRow(row: Row): Dialogue {
  return {
    id: String(row.id),
    pageId: String(row.pageId),
    characterId: typeof row.characterId === 'string' ? row.characterId : undefined,
    characterName: typeof row.characterName === 'string' ? row.characterName : undefined,
    text: String(row.text),
    x: Number(row.x),
    y: Number(row.y),
    scale: Number(row.scale),
    rotation: Number(row.rotation),
    bubbleStyle: row.bubbleStyle as BubbleStyle,
    color: String(row.color),
    locked: Number(row.locked) === 1,
    raw: typeof row.rawJson === 'string' ? row.rawJson : undefined,
  }
}

function providerFromRow(row: Row, hasApiKey: boolean): ProviderProfile {
  return {
    id: String(row.id),
    name: String(row.name),
    baseUrl: String(row.baseUrl),
    defaultModel: String(row.defaultModel),
    isLocal: Number(row.isLocal) === 1,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    hasApiKey,
  }
}

function modelCapabilityFromRow(row: Row): ModelCapability {
  return {
    id: String(row.id),
    providerId: String(row.providerId),
    modelId: String(row.modelId),
    supportsVision: Number(row.supportsVision) === 1,
    supportsImageGeneration: Number(row.supportsImageGeneration) === 1,
    supportsStreaming: Number(row.supportsStreaming) === 1,
    supportsJsonSchema: Number(row.supportsJsonSchema) === 1,
    allowsAdultInput: Number(row.allowsAdultInput) === 1,
    allowsAdultGeneration: Number(row.allowsAdultGeneration) === 1,
    contextWindow: typeof row.contextWindow === 'number' ? Number(row.contextWindow) : undefined,
    notes: String(row.notes),
    source: row.source as ModelCapability['source'],
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  }
}

function sampleMangaSvg(index: number): string {
  const variants = [
    ['夏天特别蓝。', '我们在车站遇见，一切都刚刚好。', '#f7fbff'],
    ['你也是去海边吗？', '嗯！好久没去了。', '#fffafa'],
    ['要一起去吗？', '好啊，那就出发吧！', '#fbfff7'],
  ][index]

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600">
  <defs>
    <pattern id="tone" width="8" height="8" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1" fill="#d8d8d8"/>
    </pattern>
  </defs>
  <rect width="1200" height="1600" fill="${variants[2]}"/>
  <rect x="60" y="60" width="1080" height="580" fill="url(#tone)" stroke="#111" stroke-width="8"/>
  <rect x="60" y="690" width="510" height="360" fill="#fff" stroke="#111" stroke-width="8"/>
  <rect x="630" y="690" width="510" height="360" fill="#fff" stroke="#111" stroke-width="8"/>
  <rect x="60" y="1100" width="1080" height="440" fill="#fff" stroke="#111" stroke-width="8"/>
  <path d="M120 530 C240 350 420 270 580 350 S880 460 1060 300" fill="none" stroke="#333" stroke-width="10"/>
  <circle cx="470" cy="430" r="115" fill="#f4f4f4" stroke="#111" stroke-width="6"/>
  <path d="M390 380 C460 300 560 330 575 430 C540 360 450 365 390 380Z" fill="#111"/>
  <path d="M460 545 L430 630 L530 630 L505 545Z" fill="#111"/>
  <circle cx="350" cy="850" r="85" fill="#f4f4f4" stroke="#111" stroke-width="6"/>
  <path d="M285 815 C340 760 425 785 435 865 C390 810 335 810 285 815Z" fill="#111"/>
  <circle cx="870" cy="840" r="88" fill="#f4f4f4" stroke="#111" stroke-width="6"/>
  <path d="M800 800 C875 730 950 775 955 855 C910 790 850 790 800 800Z" fill="#111"/>
  <path d="M390 1320 C520 1180 700 1180 840 1320" fill="none" stroke="#111" stroke-width="10"/>
  <circle cx="460" cy="1280" r="76" fill="#f4f4f4" stroke="#111" stroke-width="6"/>
  <circle cx="740" cy="1280" r="76" fill="#f4f4f4" stroke="#111" stroke-width="6"/>
  <rect x="84" y="96" width="132" height="322" rx="4" fill="#fff" stroke="#111" stroke-width="5"/>
  <text x="164" y="145" writing-mode="vertical-rl" font-family="serif" font-size="38" font-weight="700" fill="#111">${variants[0]}</text>
  <ellipse cx="1000" cy="360" rx="92" ry="150" fill="#fff" stroke="#111" stroke-width="5"/>
  <text x="1030" y="245" writing-mode="vertical-rl" font-family="serif" font-size="34" font-weight="700" fill="#111">${variants[1]}</text>
</svg>`
}
