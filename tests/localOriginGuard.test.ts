import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import { afterEach, describe, expect, it } from 'vitest'
import { registerLocalOriginGuard } from '../server/localOriginGuard'

const LOCAL = { host: '127.0.0.1:4174' }

let dataDir = ''
let server: FastifyInstance | null = null

async function createServer(strictWrites: boolean): Promise<FastifyInstance> {
  dataDir = mkdtempSync(path.join(os.tmpdir(), 'ptm-origin-guard-'))
  writeFileSync(path.join(dataDir, 'studio.sqlite'), 'database bytes')
  const instance = fastify()
  registerLocalOriginGuard(instance, { strictWrites })
  await instance.register(fastifyStatic, { root: dataDir, prefix: '/assets/' })
  instance.get('/api/providers', async () => ({ providers: [] }))
  instance.patch('/api/providers/:id', async () => ({ ok: true }))
  instance.get('/', async () => 'studio page')
  server = instance
  return instance
}

afterEach(async () => {
  await server?.close()
  server = null
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
  dataDir = ''
})

describe('local origin guard', () => {
  it('answers the Studio page on this computer', async () => {
    const app = await createServer(false)
    expect((await app.inject({ method: 'GET', url: '/api/providers', headers: LOCAL })).statusCode).toBe(200)
    const sameOrigin = { host: 'localhost:4174', origin: 'http://localhost:4174', 'sec-fetch-site': 'same-origin' }
    expect((await app.inject({ method: 'PATCH', url: '/api/providers/p1', headers: sameOrigin })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/assets/studio.sqlite', headers: LOCAL })).body).toBe('database bytes')
  })

  it('refuses a DNS-rebinding Host on the API and the data folder', async () => {
    const app = await createServer(false)
    const rebound = { host: 'evil.example:4174' }
    const patch = await app.inject({ method: 'PATCH', url: '/api/providers/p1', headers: rebound, payload: { baseUrl: 'https://evil.example/v1' } })
    expect(patch.statusCode).toBe(403)
    expect(patch.json()).toEqual({ error: 'Requests are only accepted from the Studio page on this computer.' })
    expect((await app.inject({ method: 'GET', url: '/api/providers', headers: rebound })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/assets/studio.sqlite', headers: rebound })).statusCode).toBe(403)
  })

  it('refuses foreign origins and cross-site requests', async () => {
    const app = await createServer(false)
    const foreign = { ...LOCAL, origin: 'https://evil.example' }
    expect((await app.inject({ method: 'PATCH', url: '/api/providers/p1', headers: foreign })).statusCode).toBe(403)
    const crossSite = { ...LOCAL, 'sec-fetch-site': 'cross-site' }
    expect((await app.inject({ method: 'GET', url: '/assets/studio.sqlite', headers: crossSite })).statusCode).toBe(403)
  })

  it('matches the routed path, so percent-encoding cannot skip the guard', async () => {
    const app = await createServer(false)
    const rebound = { host: 'evil.example:4174' }
    const encoded = await app.inject({ method: 'GET', url: '/%61ssets/studio.sqlite', headers: rebound })
    expect(encoded.body).not.toBe('database bytes')
  })

  it('keeps the Studio page itself reachable from a link on another site', async () => {
    const app = await createServer(false)
    const fromLink = { ...LOCAL, 'sec-fetch-site': 'cross-site' }
    expect((await app.inject({ method: 'GET', url: '/', headers: fromLink })).statusCode).toBe(200)
  })

  it('in a packaged build, requires writes to come from this very port', async () => {
    const otherPort = { ...LOCAL, origin: 'http://127.0.0.1:5173', 'sec-fetch-site': 'same-site' }
    const packaged = await createServer(true)
    expect((await packaged.inject({ method: 'PATCH', url: '/api/providers/p1', headers: otherPort })).statusCode).toBe(403)
    expect((await packaged.inject({ method: 'GET', url: '/api/providers', headers: otherPort })).statusCode).toBe(200)
    const samePort = { ...LOCAL, origin: 'http://127.0.0.1:4174' }
    expect((await packaged.inject({ method: 'PATCH', url: '/api/providers/p1', headers: samePort })).statusCode).toBe(200)
    await packaged.close()
    rmSync(dataDir, { recursive: true, force: true })

    // Source and dev runs: Vite's proxy serves the page from another loopback port.
    const source = await createServer(false)
    expect((await source.inject({ method: 'PATCH', url: '/api/providers/p1', headers: otherPort })).statusCode).toBe(200)
  })
})
