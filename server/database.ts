import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { databasePath, ensureAppDirs } from './paths'
import type {
  Asset,
  Character,
  CleanupStroke,
  Dialogue,
  FontAsset,
  LetteringDefaults,
  ModelCapability,
  ModelCapabilitySources,
  Page,
  PanelBox,
  Project,
  ProjectDetail,
  ProjectMode,
  ProjectSource,
  ProviderProfile,
  PixivBatchTask,
  PixivBatchTaskItem,
  PixivBatchTaskStatus,
  PixivBatchItemStatus,
  ReadingDirection,
  StoryBible,
} from '../src/shared/types'
import { letteringDefaultsSchema } from '../src/shared/schemas'
import { findDialogueCharacter } from '../src/shared/characters'
import {
  assetFromRow,
  characterFromRow,
  dialogueFromRow,
  fontFromRow,
  modelCapabilityFromRow,
  pageFromRow,
  projectFromRow,
  providerFromRow,
  pixivBatchTaskFromRow,
  pixivBatchTaskItemFromRow,
  type Row,
} from './databaseRows'
import { runMigrations } from './databaseSchema'
import { ensureSampleProject } from './sampleProject'

const modelCapabilityFlags = [
  'supportsVision',
  'supportsImageGeneration',
  'supportsStreaming',
  'supportsJsonSchema',
  'allowsAdultInput',
  'allowsAdultGeneration',
] as const

const PIXIV_REQUEST_COOLDOWN_KEY = 'pixiv-request-cooldown'

export class StudioDatabase {
  private db: DatabaseSync

  constructor(dbPath = databasePath, seedSampleProject = true) {
    ensureAppDirs()
    this.db = new DatabaseSync(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec('PRAGMA foreign_keys = ON;')
    runMigrations(this.db)
    this.markPixivTasksPausedOnStartup()
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
        'INSERT INTO projects (id, title, mode, source, createdAt, updatedAt, storyBibleJson, letteringJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, input.title, input.mode, input.source, now, now, null, JSON.stringify(letteringDefaultsSchema.parse({})))
    return this.getProject(id)
  }

  updateProjectReadingDirection(projectId: string, readingDirection: ReadingDirection): Project {
    return this.updateProjectSettings(projectId, { readingDirection })
  }

  updateProjectSettings(
    projectId: string,
    input: {
      readingDirection?: ReadingDirection
      letteringDefaults?: LetteringDefaults
      applyLetteringToExisting?: boolean
      colorDialoguesByCharacter?: boolean
    },
  ): Project {
    const current = this.getProject(projectId)
    const nextDefaults = input.letteringDefaults ? letteringDefaultsSchema.parse(input.letteringDefaults) : current.letteringDefaults || letteringDefaultsSchema.parse({})
    if (input.readingDirection !== undefined) {
      this.db.prepare('UPDATE projects SET readingDirection = ? WHERE id = ?').run(input.readingDirection, projectId)
    }
    if (input.letteringDefaults !== undefined) {
      this.db.prepare('UPDATE projects SET letteringJson = ? WHERE id = ?').run(JSON.stringify(nextDefaults), projectId)
      if (input.applyLetteringToExisting) {
        this.applyLetteringDefaults(projectId, nextDefaults)
      }
    }
    if (input.colorDialoguesByCharacter) {
      this.applyCharacterColors(projectId)
    }
    this.touchProject(projectId)
    return this.getProject(projectId)
  }

  private applyLetteringDefaults(projectId: string, defaults: LetteringDefaults): void {
    this.db
      .prepare(
        'UPDATE dialogues SET scale = ?, color = ?, fontFamily = ? WHERE pageId IN (SELECT id FROM pages WHERE projectId = ?)',
      )
      .run(defaults.scale, defaults.color, defaults.fontFamily || null, projectId)
  }

  private applyCharacterColors(projectId: string): void {
    const characters = this.listCharacters(projectId)
    const dialogues = this.listDialoguesByProject(projectId)
    const update = this.db.prepare('UPDATE dialogues SET color = ? WHERE id = ?')
    for (const dialogue of dialogues) {
      const character = findDialogueCharacter(characters, dialogue)
      if (character) {
        update.run(character.color, dialogue.id)
      }
    }
  }

  private listDialoguesByProject(projectId: string): Dialogue[] {
    return this.db
      .prepare(
        'SELECT d.* FROM dialogues d JOIN pages p ON p.id = d.pageId WHERE p.projectId = ? ORDER BY p.pageIndex ASC, d.rowid ASC',
      )
      .all(projectId)
      .map((row) => dialogueFromRow(row as Row))
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

  getPixivRequestCooldown(): string | null {
    const retryAt = this.getSetting(PIXIV_REQUEST_COOLDOWN_KEY, '')
    const timestamp = Date.parse(retryAt)
    return Number.isFinite(timestamp) && timestamp > Date.now() ? new Date(timestamp).toISOString() : null
  }

  setPixivRequestCooldown(retryAt: string): string {
    const timestamp = Date.parse(retryAt)
    if (!Number.isFinite(timestamp)) throw new RangeError(`Invalid Pixiv cooldown timestamp: ${retryAt}`)
    const current = this.getPixivRequestCooldown()
    const effectiveTimestamp = Math.max(timestamp, current ? Date.parse(current) : 0)
    const effectiveRetryAt = new Date(effectiveTimestamp).toISOString()
    this.upsertSetting(PIXIV_REQUEST_COOLDOWN_KEY, effectiveRetryAt)
    return effectiveRetryAt
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
    this.db.prepare('DELETE FROM pixiv_import_records WHERE pageId = ?').run(pageId)
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
        'INSERT INTO dialogues (id, pageId, characterId, characterName, text, x, y, scale, rotation, bubbleStyle, color, locked, textDirection, fontFamily, tailX, tailY, rawJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
        input.textDirection ?? null,
        input.fontFamily ?? null,
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

  updatePagePanels(pageId: string, panels: PanelBox[]): Page {
    const page = this.getPage(pageId)
    this.db.prepare('UPDATE pages SET panelsJson = ? WHERE id = ?').run(panels.length ? JSON.stringify(panels) : null, pageId)
    this.touchProject(page.projectId)
    return this.getPage(pageId)
  }

  updatePageCleanup(pageId: string, cleanupStrokes: CleanupStroke[]): Page {
    const page = this.getPage(pageId)
    this.db.prepare('UPDATE pages SET cleanupJson = ? WHERE id = ?').run(cleanupStrokes.length ? JSON.stringify(cleanupStrokes) : null, pageId)
    this.touchProject(page.projectId)
    return this.getPage(pageId)
  }

  replaceGeneratedDialogues(pageId: string, dialogues: Dialogue[]): Dialogue[] {
    const page = this.getPage(pageId)
    const project = this.getProject(page.projectId)
    const characters = this.listCharacters(page.projectId)
    const defaults = project.letteringDefaults || letteringDefaultsSchema.parse({})
    this.db.prepare('DELETE FROM dialogues WHERE pageId = ?').run(pageId)
    for (const dialogue of dialogues) {
      const character = findDialogueCharacter(characters, dialogue)
      this.createDialogue(pageId, {
        ...dialogue,
        scale: dialogue.scale === 1 ? defaults.scale : dialogue.scale,
        color: dialogue.color === '#141414' ? character?.color || defaults.color : dialogue.color,
        fontFamily: dialogue.fontFamily || defaults.fontFamily,
      })
    }
    this.updatePageStatus(pageId, 'complete')
    return this.listDialogues(pageId)
  }

  getDialogue(id: string): Dialogue {
    const row = this.db.prepare('SELECT * FROM dialogues WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new Error('Dialogue not found')
    return dialogueFromRow(row)
  }

  updateDialogue(id: string, patch: Partial<Dialogue>): Dialogue {
    const current = this.db.prepare('SELECT * FROM dialogues WHERE id = ?').get(id) as Row | undefined
    if (!current) throw new Error('Dialogue not found')
    const merged = { ...dialogueFromRow(current), ...patch }
    this.db
      .prepare(
        'UPDATE dialogues SET text = ?, x = ?, y = ?, scale = ?, rotation = ?, bubbleStyle = ?, color = ?, locked = ?, textDirection = ?, fontFamily = ?, tailX = ?, tailY = ? WHERE id = ?',
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
        merged.textDirection ?? null,
        merged.fontFamily ?? null,
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

  createPixivBatchTask(input: {
    projectId: string
    title: string
    r18Enabled: boolean
    usePixivSession: boolean
    requestDelayMs: number
    pages: Array<{ artworkId: string; pageIndex: number; sourceUrl: string; fileName: string }>
  }): PixivBatchTask {
    this.getProject(input.projectId)
    if (input.pages.length < 1 || input.pages.length > 200) {
      throw new Error('Pixiv batch tasks must contain between 1 and 200 pages')
    }
    const taskId = randomUUID()
    const now = new Date().toISOString()
    this.db
      .prepare(
        'INSERT INTO pixiv_tasks (id, projectId, title, r18Enabled, usePixivSession, status, totalItems, completedItems, failedItems, requestDelayMs, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)',
      )
      .run(taskId, input.projectId, input.title, input.r18Enabled ? 1 : 0, input.usePixivSession ? 1 : 0, 'queued', input.pages.length, input.requestDelayMs, now, now)
    const insert = this.db.prepare(
      'INSERT INTO pixiv_task_items (id, taskId, artworkId, pageIndex, sourceUrl, fileName, status, attempts, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
    )
    for (const page of input.pages) {
      insert.run(randomUUID(), taskId, page.artworkId, page.pageIndex, page.sourceUrl, page.fileName, 'queued', now, now)
    }
    return this.getPixivBatchTask(taskId)
  }

  getPixivBatchTask(taskId: string): PixivBatchTask {
    const row = this.db.prepare('SELECT * FROM pixiv_tasks WHERE id = ?').get(taskId) as Row | undefined
    if (!row) throw new Error('Pixiv batch task not found')
    const items = this.db
      .prepare('SELECT * FROM pixiv_task_items WHERE taskId = ? ORDER BY rowid ASC')
      .all(taskId)
      .map((item) => pixivBatchTaskItemFromRow(item as Row))
    return pixivBatchTaskFromRow(row, items)
  }

  listRecoverablePixivBatchTasks(projectId: string): PixivBatchTask[] {
    return this.db
      .prepare("SELECT id FROM pixiv_tasks WHERE projectId = ? AND status IN ('queued', 'running', 'paused', 'failed') ORDER BY updatedAt DESC LIMIT 10")
      .all(projectId)
      .map((row) => this.getPixivBatchTask(String((row as Row).id)))
  }

  updatePixivBatchTask(
    taskId: string,
    patch: Partial<{
      status: PixivBatchTaskStatus
      completedItems: number
      failedItems: number
      retryAt: string | null
      pauseReason: string | null
      error: string | null
    }>,
  ): PixivBatchTask {
    const current = this.getPixivBatchTask(taskId)
    const next = {
      status: patch.status ?? current.status,
      completedItems: patch.completedItems ?? current.completedItems,
      failedItems: patch.failedItems ?? current.failedItems,
      retryAt: patch.retryAt === undefined ? current.retryAt ?? null : patch.retryAt,
      pauseReason: patch.pauseReason === undefined ? current.pauseReason ?? null : patch.pauseReason,
      error: patch.error === undefined ? current.error ?? null : patch.error,
    }
    this.db
      .prepare('UPDATE pixiv_tasks SET status = ?, completedItems = ?, failedItems = ?, retryAt = ?, pauseReason = ?, error = ?, updatedAt = ? WHERE id = ?')
      .run(next.status, next.completedItems, next.failedItems, next.retryAt, next.pauseReason, next.error, new Date().toISOString(), taskId)
    return this.getPixivBatchTask(taskId)
  }

  updatePixivBatchTaskItem(
    itemId: string,
    patch: Partial<{ status: PixivBatchItemStatus; attempts: number; error: string | null; assetId: string | null; pageId: string | null }>,
  ): PixivBatchTaskItem {
    const row = this.db.prepare('SELECT * FROM pixiv_task_items WHERE id = ?').get(itemId) as Row | undefined
    if (!row) throw new Error('Pixiv batch task item not found')
    const current = pixivBatchTaskItemFromRow(row)
    const next = {
      status: patch.status ?? current.status,
      attempts: patch.attempts ?? current.attempts,
      error: patch.error === undefined ? current.error ?? null : patch.error,
      assetId: patch.assetId === undefined ? current.assetId ?? null : patch.assetId,
      pageId: patch.pageId === undefined ? current.pageId ?? null : patch.pageId,
    }
    this.db
      .prepare('UPDATE pixiv_task_items SET status = ?, attempts = ?, error = ?, assetId = ?, pageId = ?, updatedAt = ? WHERE id = ?')
      .run(next.status, next.attempts, next.error, next.assetId, next.pageId, new Date().toISOString(), itemId)
    return this.getPixivBatchTaskItem(itemId)
  }

  getPixivBatchTaskItem(itemId: string): PixivBatchTaskItem {
    const row = this.db.prepare('SELECT * FROM pixiv_task_items WHERE id = ?').get(itemId) as Row | undefined
    if (!row) throw new Error('Pixiv batch task item not found')
    return pixivBatchTaskItemFromRow(row)
  }

  findPixivImportRecord(input: { projectId: string; artworkId: string; pageIndex: number; sourceRevision: string }): { assetId: string; pageId: string } | null {
    const row = this.db
      .prepare('SELECT assetId, pageId FROM pixiv_import_records WHERE projectId = ? AND artworkId = ? AND pageIndex = ? AND sourceRevision = ?')
      .get(input.projectId, input.artworkId, input.pageIndex, input.sourceRevision) as Row | undefined
    return row ? { assetId: String(row.assetId), pageId: String(row.pageId) } : null
  }

  createPixivImportedPage(input: {
    projectId: string
    artworkId: string
    pageIndex: number
    sourceUrl: string
    sourceRevision: string
    fileName: string
    relativePath: string
    mimeType: string
    width: number
    height: number
  }): { created: boolean; assetId: string; pageId: string } {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const duplicate = this.findPixivImportRecord(input)
      if (duplicate) {
        this.db.exec('COMMIT')
        return { created: false, ...duplicate }
      }
      const asset = this.createAsset({
        projectId: input.projectId,
        kind: 'original',
        relativePath: input.relativePath,
        mimeType: input.mimeType,
        sourceUrl: input.sourceUrl,
        width: input.width,
        height: input.height,
      })
      const page = this.createPage({
        projectId: input.projectId,
        index: this.listPages(input.projectId).length,
        originalAssetId: asset.id,
        width: asset.width,
        height: asset.height,
      })
      this.db
        .prepare('INSERT INTO pixiv_import_records (id, projectId, artworkId, pageIndex, sourceUrl, sourceRevision, fileName, assetId, pageId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), input.projectId, input.artworkId, input.pageIndex, input.sourceUrl, input.sourceRevision, input.fileName, asset.id, page.id, new Date().toISOString())
      this.touchProject(input.projectId)
      this.db.exec('COMMIT')
      return { created: true, assetId: asset.id, pageId: page.id }
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Pixiv page transaction and rollback both failed', { cause: rollbackError })
      }
      throw error
    }
  }

  savePixivImportRecord(input: {
    projectId: string
    artworkId: string
    pageIndex: number
    sourceUrl: string
    sourceRevision: string
    fileName: string
    assetId: string
    pageId: string
  }): void {
    this.db
      .prepare('INSERT INTO pixiv_import_records (id, projectId, artworkId, pageIndex, sourceUrl, sourceRevision, fileName, assetId, pageId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(projectId, artworkId, pageIndex, sourceRevision) DO NOTHING')
      .run(randomUUID(), input.projectId, input.artworkId, input.pageIndex, input.sourceUrl, input.sourceRevision, input.fileName, input.assetId, input.pageId, new Date().toISOString())
  }

  markPixivTasksPausedOnStartup(): void {
    this.db
      .prepare("UPDATE pixiv_task_items SET status = 'queued', updatedAt = ? WHERE status = 'downloading'")
      .run(new Date().toISOString())
    this.db
      .prepare("UPDATE pixiv_tasks SET status = 'paused', pauseReason = 'Task paused after application restart', updatedAt = ? WHERE status IN ('queued', 'running')")
      .run(new Date().toISOString())
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
      capabilitySources?: Partial<ModelCapabilitySources>
    },
  ): ModelCapability {
    const now = new Date().toISOString()
    const declaredEvidence = input.source === 'user' ? 'user' : input.source === 'tested' ? 'tested' : undefined
    const inferredSources = declaredEvidence
      ? Object.fromEntries(
          modelCapabilityFlags.flatMap((flag) => (input[flag] === undefined ? [] : [[flag, declaredEvidence]])),
        )
      : {}
    const capabilitySources = { ...inferredSources, ...input.capabilitySources }
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
        capabilitySources: { ...current.capabilitySources, ...capabilitySources },
      }
      this.db
        .prepare(
          `UPDATE model_capabilities
           SET supportsVision = ?, supportsStreaming = ?, supportsJsonSchema = ?, allowsAdultInput = ?,
               allowsAdultGeneration = ?, supportsImageGeneration = ?, contextWindow = ?, notes = ?, source = ?,
               capabilitySourcesJson = ?, updatedAt = ?
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
          JSON.stringify(merged.capabilitySources),
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
           allowsAdultGeneration, supportsImageGeneration, contextWindow, notes, source, capabilitySourcesJson, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        JSON.stringify(capabilitySources),
        now,
        now,
      )
    return this.getModelCapability(id)
  }

  updateModelCapability(
    id: string,
    patch: Partial<
      Omit<ModelCapability, 'id' | 'providerId' | 'modelId' | 'createdAt' | 'updatedAt' | 'capabilitySources'>
    > & { capabilitySources?: Partial<ModelCapabilitySources> },
  ): ModelCapability {
    const current = this.getModelCapability(id)
    const merged = {
      ...current,
      ...patch,
      capabilitySources: { ...current.capabilitySources, ...patch.capabilitySources },
    }
    this.db
      .prepare(
        `UPDATE model_capabilities
         SET supportsVision = ?, supportsStreaming = ?, supportsJsonSchema = ?, allowsAdultInput = ?,
             allowsAdultGeneration = ?, supportsImageGeneration = ?, contextWindow = ?, notes = ?, source = ?,
             capabilitySourcesJson = ?, updatedAt = ?
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
        JSON.stringify(merged.capabilitySources),
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
