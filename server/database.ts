import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { databasePath, ensureAppDirs } from './paths'
import type {
  Asset,
  Character,
  Dialogue,
  FontAsset,
  ModelCapability,
  Page,
  Project,
  ProjectDetail,
  ProjectMode,
  ProjectSource,
  ProviderProfile,
  ReadingDirection,
  StoryBible,
} from '../src/shared/types'
import {
  assetFromRow,
  characterFromRow,
  dialogueFromRow,
  fontFromRow,
  modelCapabilityFromRow,
  pageFromRow,
  projectFromRow,
  providerFromRow,
  type Row,
} from './databaseRows'
import { runMigrations } from './databaseSchema'
import { ensureSampleProject } from './sampleProject'

export class StudioDatabase {
  private db: DatabaseSync

  constructor(dbPath = databasePath, seedSampleProject = true) {
    ensureAppDirs()
    this.db = new DatabaseSync(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec('PRAGMA foreign_keys = ON;')
    runMigrations(this.db)
    if (seedSampleProject) {
      ensureSampleProject(this)
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

  updateProjectReadingDirection(projectId: string, readingDirection: ReadingDirection): Project {
    this.getProject(projectId)
    this.db.prepare('UPDATE projects SET readingDirection = ? WHERE id = ?').run(readingDirection, projectId)
    this.touchProject(projectId)
    return this.getProject(projectId)
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

  /** Swaps a page with its neighbor in reading order; no-op at the edges. Story-bible beats follow their pages. */
  movePage(pageId: string, offset: -1 | 1): void {
    const page = this.getPage(pageId)
    const pages = this.listPages(page.projectId)
    const currentPosition = pages.findIndex((item) => item.id === pageId)
    const targetPosition = currentPosition + offset
    if (targetPosition < 0 || targetPosition >= pages.length) {
      return
    }
    const neighbor = pages[targetPosition]
    this.db.prepare('UPDATE pages SET pageIndex = ? WHERE id = ?').run(neighbor.index, page.id)
    this.db.prepare('UPDATE pages SET pageIndex = ? WHERE id = ?').run(page.index, neighbor.id)
    this.swapStoryBibleBeats(page.projectId, page.index, neighbor.index)
    this.touchProject(page.projectId)
  }

  /** Deletes a page and its dialogues, closes the index gap, and shifts story-bible beats down. */
  deletePage(pageId: string): void {
    const page = this.getPage(pageId)
    this.db.prepare('DELETE FROM dialogues WHERE pageId = ?').run(pageId)
    this.db.prepare('DELETE FROM pages WHERE id = ?').run(pageId)
    this.db
      .prepare('UPDATE pages SET pageIndex = pageIndex - 1 WHERE projectId = ? AND pageIndex > ?')
      .run(page.projectId, page.index)
    this.removeStoryBibleBeat(page.projectId, page.index)
    this.touchProject(page.projectId)
  }

  private swapStoryBibleBeats(projectId: string, indexA: number, indexB: number): void {
    const bible = this.getProject(projectId).storyBible
    if (!bible) return
    const pageBeats = bible.pageBeats.map((beat) =>
      beat.pageIndex === indexA
        ? { ...beat, pageIndex: indexB }
        : beat.pageIndex === indexB
          ? { ...beat, pageIndex: indexA }
          : beat,
    )
    this.saveStoryBible(projectId, { ...bible, pageBeats })
  }

  private removeStoryBibleBeat(projectId: string, removedIndex: number): void {
    const bible = this.getProject(projectId).storyBible
    if (!bible) return
    const pageBeats = bible.pageBeats
      .filter((beat) => beat.pageIndex !== removedIndex)
      .map((beat) => (beat.pageIndex > removedIndex ? { ...beat, pageIndex: beat.pageIndex - 1 } : beat))
    // storyBibleSchema requires at least one beat; when the last one goes, keep the stale
    // bible untouched — the next Analyze Story rebuilds it.
    if (!pageBeats.length) return
    this.saveStoryBible(projectId, { ...bible, pageBeats })
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

  replaceDialogues(pageId: string, dialogues: Dialogue[], status: Page['status'] = 'complete'): Dialogue[] {
    this.db.prepare('DELETE FROM dialogues WHERE pageId = ?').run(pageId)
    for (const dialogue of dialogues) {
      this.createDialogue(pageId, dialogue)
    }
    this.updatePageStatus(pageId, status)
    return this.listDialogues(pageId)
  }

  createDialogue(pageId: string, input: Dialogue): Dialogue {
    const id = input.id || randomUUID()
    this.db
      .prepare(
        'INSERT INTO dialogues (id, pageId, characterId, characterName, text, x, y, scale, rotation, bubbleStyle, color, locked, tailX, tailY, rawJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
        input.tailX ?? null,
        input.tailY ?? null,
        input.raw || null,
      )
    return this.listDialogues(pageId).find((dialogue) => dialogue.id === id)!
  }

  deleteDialogue(id: string): void {
    const result = this.db.prepare('DELETE FROM dialogues WHERE id = ?').run(id)
    if (!result.changes) {
      throw new Error('Dialogue not found')
    }
  }

  updateDialogue(id: string, patch: Partial<Dialogue>): Dialogue {
    const current = this.db.prepare('SELECT * FROM dialogues WHERE id = ?').get(id) as Row | undefined
    if (!current) throw new Error('Dialogue not found')
    const merged = { ...dialogueFromRow(current), ...patch }
    this.db
      .prepare(
        'UPDATE dialogues SET text = ?, x = ?, y = ?, scale = ?, rotation = ?, bubbleStyle = ?, color = ?, locked = ?, tailX = ?, tailY = ? WHERE id = ?',
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
        merged.tailX ?? null,
        merged.tailY ?? null,
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

  createFont(input: { familyName: string; fileName: string; relativePath: string; format: string }): FontAsset {
    const id = randomUUID()
    this.db
      .prepare('INSERT INTO fonts (id, familyName, fileName, filePath, format, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, input.familyName, input.fileName, input.relativePath, input.format, new Date().toISOString())
    return this.getFont(id)
  }

  getFont(fontId: string): FontAsset {
    const row = this.db.prepare('SELECT * FROM fonts WHERE id = ?').get(fontId) as Row | undefined
    if (!row) throw new Error('Font not found')
    return fontFromRow(row)
  }

  listFonts(): FontAsset[] {
    return this.db
      .prepare('SELECT * FROM fonts ORDER BY createdAt ASC')
      .all()
      .map((row) => fontFromRow(row as Row))
  }

  /** Removes the DB row and returns the stored relative path so the caller can unlink the file. */
  deleteFont(fontId: string): string {
    const font = this.getFont(fontId)
    const relativePath = this.db.prepare('SELECT filePath FROM fonts WHERE id = ?').get(fontId) as Row
    this.db.prepare('DELETE FROM fonts WHERE id = ?').run(fontId)
    return String(relativePath.filePath ?? font.fileName)
  }

  private touchProject(projectId: string): void {
    this.db.prepare('UPDATE projects SET updatedAt = ? WHERE id = ?').run(new Date().toISOString(), projectId)
  }

}
