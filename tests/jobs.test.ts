import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StudioDatabase } from '../server/database'
import { JobHub } from '../server/jobs'

function createHub(): { db: StudioDatabase; hub: JobHub } {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ptm-jobs-test-'))
  process.env.PTM_DATA_DIR = dataDir
  const db = new StudioDatabase(path.join(dataDir, 'studio.sqlite'), false)
  return { db, hub: new JobHub(db) }
}

describe('JobHub', () => {
  afterEach(() => {
    delete process.env.PTM_DATA_DIR
  })

  it('replays stored events to listeners that connect after completion', async () => {
    const { hub } = createHub()
    const jobId = hub.create('story.analyze', 'Queued')
    hub.progress(jobId, 0.5, 'Running')
    hub.complete(jobId, 'Done', { result: true })

    const events = await new Promise<string[]>((resolve) => {
      const types: string[] = []
      hub.on(jobId, (event) => {
        types.push(event.type)
        if (event.type === 'complete') {
          resolve(types)
        }
      })
    })

    expect(events).toEqual(['queued', 'progress', 'complete'])
  })

  it('replays history before live events registered in the same tick', () => {
    const { hub } = createHub()
    const jobId = hub.create('story.analyze', 'Queued')
    hub.progress(jobId, 0.5, 'Running')
    const events: string[] = []

    hub.on(jobId, (event) => {
      events.push(event.type)
    })
    hub.complete(jobId, 'Done')

    expect(events).toEqual(['queued', 'progress', 'complete'])
  })

  it('aborts and keeps the cancelled signal available for pending workers', () => {
    const { hub } = createHub()
    const jobId = hub.create('page.generate', 'Queued')
    const signal = hub.signal(jobId)

    hub.cancel(jobId)

    expect(signal?.aborted).toBe(true)
    expect(hub.signal(jobId)?.aborted).toBe(true)
    expect(hub.isCancelled(jobId)).toBe(true)
  })

  it('does not emit progress or completion after cancellation', () => {
    const { hub } = createHub()
    const jobId = hub.create('page.generate', 'Queued')
    const events: string[] = []
    hub.on(jobId, (event) => {
      events.push(event.type)
    })

    hub.cancel(jobId)
    hub.progress(jobId, 0.6, 'Should not run')
    hub.complete(jobId, 'Should not complete')

    expect(events).toEqual(['queued', 'cancelled'])
  })
})
