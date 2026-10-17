import fastify from 'fastify'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import open from 'open'
import { appDataDir } from './paths'
import { StudioDatabase } from './database'
import { SecretStore } from './secrets'
import { JobHub } from './jobs'
import {
  AiJsonOutputError,
  AiProviderHttpError,
  AiProviderRefusalError,
  analyzeStoryWithAi,
  describeAiTarget,
  generateDialoguesWithAi,
  regenerateDialogueTextWithAi,
} from './ai'
import { exportProjectBackup, exportRenderedPdf, exportRenderedZip } from './exporter'
import { importLocalImages, importPixivArtwork, importProjectBackup } from './importers'
import { registerProviderLabRoutes } from './providers'
import { registerContinuationRoutes } from './continuation'
import { registerDialogueRoutes } from './dialogues'
import { registerFontRoutes } from './fonts'
import { registerPageRoutes } from './pages'
import { registerPixivBatchRoutes } from './pixivBatch'
import { registerStudioErrorHandler } from './errorHandler'
import { readInstallInfo } from './update/install'
import { registerUpdateRoutes } from './update/routes'
import { UpdateManager } from './update/service'
import {
  analyzeStorySchema,
  createProjectSchema,
  exportPdfSchema,
  exportZipSchema,
  exportProjectBackupSchema,
  generatePageSchema,
  pixivImportSchema,
  regenerateDialogueSchema,
  secretUpdateSchema,
  storyBibleSchema,
  updateProjectSchema,
} from '../src/shared/schemas'

const PORT = Number(process.env.PTM_SERVER_PORT || 4174)
const db = new StudioDatabase()
const secrets = new SecretStore(db)
const jobs = new JobHub(db)
const updates = new UpdateManager({
  settings: db,
  install: readInstallInfo(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')),
  dataDir: appDataDir,
})

const server = fastify({
  logger: {
    redact: ['req.headers.authorization', 'req.body.apiKey', 'req.body.pixivCookie'],
  },
  bodyLimit: 40 * 1024 * 1024,
})

await server.register(multipart, {
  limits: {
    fileSize: 256 * 1024 * 1024,
    files: 200,
  },
})
await server.register(fastifyStatic, {
  root: appDataDir,
  prefix: '/assets/',
})

registerStudioErrorHandler(server)

server.get('/api/health', async () => ({ ok: true, dataDir: appDataDir }))

registerProviderLabRoutes(server, { db, secrets })
registerContinuationRoutes(server, { db, secrets })
registerDialogueRoutes(server, { db })
registerPageRoutes(server, { db })
registerFontRoutes(server, { db })
registerPixivBatchRoutes(server, { db, secrets })
registerUpdateRoutes(server, { updates })

server.get('/api/settings/secrets', async () => secrets.status())

server.get('/api/ai/active-target', async () => ({ target: await describeAiTarget({ secrets, db }) }))

server.put('/api/settings/secrets', async (request) => {
  const input = secretUpdateSchema.parse(request.body)
  return secrets.save(input)
})

server.get('/api/projects', async () => ({ projects: db.listProjects() }))

server.post('/api/projects', async (request) => {
  const input = createProjectSchema.parse(request.body)
  const project = db.createProject(input)
  return db.getProjectDetail(project.id)
})

server.get('/api/projects/:id', async (request) => {
  const { id } = request.params as { id: string }
  return db.getProjectDetail(id)
})

server.patch('/api/projects/:id', async (request) => {
  const { id } = request.params as { id: string }
  const input = updateProjectSchema.parse(request.body)
  db.updateProjectSettings(id, input)
  return db.getProjectDetail(id)
})

server.put('/api/projects/:id/story-bible', async (request) => {
  const { id } = request.params as { id: string }
  const storyBible = storyBibleSchema.parse(request.body)
  db.saveStoryBible(id, {
    ...storyBible,
    characters: storyBible.characters.map((character) => ({
      ...character,
      id: character.id || randomUUID(),
      projectId: id,
    })),
  })
  return db.getProjectDetail(id)
})

server.post('/api/import/local', async (request) => {
  const projectId = typeof request.headers['x-project-id'] === 'string' ? request.headers['x-project-id'] : undefined
  return importLocalImages(db, request.files(), { projectId })
})

server.post('/api/import/project-backup', async (request) => {
  const file = await request.file()
  if (!file) {
    throw new Error('Project backup ZIP is required')
  }
  return importProjectBackup(db, file)
})

server.post('/api/import/pixiv', async (request) => {
  const input = pixivImportSchema.parse(request.body)
  return importPixivArtwork(db, secrets, input)
})

server.post('/api/story/analyze', async (request) => {
  const input = analyzeStorySchema.parse(request.body)
  const jobId = jobs.create('story.analyze', 'Analyzing project story')
  const signal = jobs.signal(jobId)
  void (async () => {
    try {
      const detail = db.getProjectDetail(input.projectId)
      jobs.progress(jobId, 0.35, 'Building Story Bible')
      const onDelta = (accumulated: string) => jobs.progress(jobId, 0.6, 'Streaming model output', { streamText: accumulated })
      const result = await analyzeStoryWithAi({ secrets, db, signal, onDelta }, detail, input)
      if (jobs.isCancelled(jobId)) return
      db.saveStoryBible(input.projectId, result.storyBible)
      jobs.complete(jobId, result.usedMock ? 'Story Bible generated with mock engine' : 'Story Bible generated', {
        ...db.getProjectDetail(input.projectId),
        raw: result.raw,
        usedMock: result.usedMock,
      })
    } catch (error) {
      if (jobs.isCancelled(jobId)) return
      jobs.fail(jobId, error instanceof Error ? error.message : 'Story analysis failed', aiErrorPayload(error))
    }
  })()
  return { jobId }
})

server.post('/api/pages/:pageId/generate', async (request) => {
  const { pageId } = request.params as { pageId: string }
  const input = generatePageSchema.parse({ ...(request.body as object), pageId })
  const jobId = jobs.create('page.generate', 'Generating page dialogue')
  const signal = jobs.signal(jobId)
  void (async () => {
    let pageProjectId = ''
    try {
      const page = db.getPage(input.pageId)
      pageProjectId = page.projectId
      db.updatePageStatus(page.id, 'generating')
      const detail = db.getProjectDetail(page.projectId)
      jobs.progress(jobId, 0.45, `Generating Page ${page.index + 1}`)
      const onDelta = (accumulated: string) => jobs.progress(jobId, 0.65, 'Streaming model output', { streamText: accumulated })
      const result = await generateDialoguesWithAi({ secrets, db, signal, onDelta }, detail, page, input)
      if (jobs.isCancelled(jobId)) {
        db.updatePageStatus(page.id, 'ready')
        return
      }
      db.replaceGeneratedDialogues(page.id, result.dialogues)
      jobs.complete(jobId, result.usedMock ? 'Dialogue generated with mock engine' : 'Dialogue generated', {
        ...db.getProjectDetail(page.projectId),
        raw: result.raw,
        usedMock: result.usedMock,
      })
    } catch (error) {
      if (jobs.isCancelled(jobId)) {
        if (pageProjectId) {
          db.updatePageStatus(input.pageId, 'ready')
        }
        return
      }
      if (pageProjectId) {
        db.updatePageStatus(input.pageId, 'error')
      }
      jobs.fail(jobId, error instanceof Error ? error.message : 'Page generation failed', aiErrorPayload(error))
      if (pageProjectId) {
        server.log.error({ projectId: pageProjectId }, 'Page generation failed')
      }
    }
  })()
  return { jobId }
})

server.post('/api/dialogues/:id/regenerate', async (request) => {
  const { id } = request.params as { id: string }
  const input = regenerateDialogueSchema.parse(request.body ?? {})
  const jobId = jobs.create('dialogue.regenerate', 'Regenerating dialogue line')
  const signal = jobs.signal(jobId)
  void (async () => {
    try {
      const dialogue = db.getDialogue(id)
      const page = db.getPage(dialogue.pageId)
      const detail = db.getProjectDetail(page.projectId)
      jobs.progress(jobId, 0.4, 'Rewriting line')
      const onDelta = (accumulated: string) => jobs.progress(jobId, 0.6, 'Streaming model output', { streamText: accumulated })
      const result = await regenerateDialogueTextWithAi({ secrets, db, signal, onDelta }, detail, dialogue, input)
      if (jobs.isCancelled(jobId)) return
      db.updateDialogue(id, { text: result.text })
      jobs.complete(jobId, 'Dialogue line regenerated', {
        ...db.getProjectDetail(page.projectId),
        raw: result.raw,
        usedMock: result.usedMock,
      })
    } catch (error) {
      if (jobs.isCancelled(jobId)) return
      jobs.fail(jobId, error instanceof Error ? error.message : 'Line regeneration failed', aiErrorPayload(error))
    }
  })()
  return { jobId }
})

server.post('/api/export/zip', async (request) => {
  const input = exportZipSchema.parse(request.body)
  return exportRenderedZip(db, input)
})

server.post('/api/export/pdf', async (request) => {
  const input = exportPdfSchema.parse(request.body)
  return exportRenderedPdf(db, input)
})

server.post('/api/export/project-backup', async (request) => {
  const input = exportProjectBackupSchema.parse(request.body)
  return exportProjectBackup(db, input)
})

server.get('/api/jobs/:jobId/events', async (request, reply) => {
  const { jobId } = request.params as { jobId: string }
  reply.hijack()
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  const off = jobs.on(jobId, (event) => {
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
  })
  request.raw.on('close', off)
})

server.post('/api/jobs/:jobId/cancel', async (request) => {
  const { jobId } = request.params as { jobId: string }
  jobs.cancel(jobId)
  return { ok: true }
})

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(__dirname, '../dist')
const hasBuiltClient = existsSync(distDir)
if (hasBuiltClient) {
  await server.register(fastifyStatic, {
    root: distDir,
    prefix: '/',
    decorateReply: false,
  })
}

await server.listen({ port: PORT, host: '127.0.0.1' })
server.log.info(`Pixiv-to-Manga Studio server listening on http://127.0.0.1:${PORT}`)
void updates.autoCheckOnStart()

// `npm start` passes --open; the built client is served by this process, so open its own URL.
if (process.argv.includes('--open') || process.env.PTM_OPEN_BROWSER === '1') {
  await open(hasBuiltClient ? `http://127.0.0.1:${PORT}` : 'http://127.0.0.1:5173')
}

function aiErrorPayload(error: unknown): unknown {
  if (error instanceof AiProviderHttpError) {
    return {
      providerHttpError: {
        status: error.status,
        endpoint: error.endpoint,
        model: error.model,
        responseBody: error.responseBody,
      },
    }
  }
  if (!(error instanceof AiJsonOutputError) && !(error instanceof AiProviderRefusalError)) {
    return undefined
  }
  return {
    raw: error.raw,
    repairedRaw: error.repairedRaw,
    ...(error instanceof AiJsonOutputError ? { schemaHint: error.schemaHint } : {}),
  }
}
