import { EventEmitter } from 'node:events'
import type { JobEvent } from '../src/shared/types'
import type { StudioDatabase } from './database'

export class JobHub {
  private emitter = new EventEmitter()
  private cancelled = new Set<string>()
  private db: StudioDatabase

  constructor(db: StudioDatabase) {
    this.db = db
    this.emitter.setMaxListeners(100)
  }

  create(type: string, message: string): string {
    const jobId = this.db.createJob(type, message)
    this.emit({ jobId, type: 'queued', progress: 0, message })
    return jobId
  }

  progress(jobId: string, progress: number, message: string, payload?: unknown): void {
    this.db.updateJob(jobId, 'running', progress, message)
    this.emit({ jobId, type: 'progress', progress, message, payload })
  }

  complete(jobId: string, message: string, payload?: unknown): void {
    this.db.updateJob(jobId, 'complete', 1, message)
    this.emit({ jobId, type: 'complete', progress: 1, message, payload })
  }

  fail(jobId: string, error: string): void {
    this.db.updateJob(jobId, 'error', 1, 'Failed', error)
    this.emit({ jobId, type: 'error', progress: 1, message: 'Failed', error })
  }

  cancel(jobId: string): void {
    this.cancelled.add(jobId)
    this.db.updateJob(jobId, 'cancelled', 1, 'Cancelled')
    this.emit({ jobId, type: 'cancelled', progress: 1, message: 'Cancelled' })
  }

  isCancelled(jobId: string): boolean {
    return this.cancelled.has(jobId)
  }

  on(jobId: string, listener: (event: JobEvent) => void): () => void {
    const eventName = `job:${jobId}`
    this.emitter.on(eventName, listener)
    return () => this.emitter.off(eventName, listener)
  }

  private emit(event: JobEvent): void {
    this.emitter.emit(`job:${event.jobId}`, event)
  }
}
