import { EventEmitter } from 'node:events'
import type { JobEvent } from '../src/shared/types'
import type { StudioDatabase } from './database'

export class JobHub {
  private emitter = new EventEmitter()
  private cancelled = new Set<string>()
  private terminal = new Set<string>()
  private controllers = new Map<string, AbortController>()
  private history = new Map<string, JobEvent[]>()
  private readonly cancelledControllerTtlMs = 5 * 60 * 1000
  private db: StudioDatabase

  constructor(db: StudioDatabase) {
    this.db = db
    this.emitter.setMaxListeners(100)
  }

  create(type: string, message: string): string {
    const jobId = this.db.createJob(type, message)
    this.cancelled.delete(jobId)
    this.terminal.delete(jobId)
    this.controllers.set(jobId, new AbortController())
    this.emit({ jobId, type: 'queued', progress: 0, message })
    return jobId
  }

  progress(jobId: string, progress: number, message: string, payload?: unknown): void {
    if (this.terminal.has(jobId)) return
    this.db.updateJob(jobId, 'running', progress, message)
    this.emit({ jobId, type: 'progress', progress, message, payload })
  }

  complete(jobId: string, message: string, payload?: unknown): void {
    if (this.terminal.has(jobId)) return
    this.terminal.add(jobId)
    this.controllers.delete(jobId)
    this.db.updateJob(jobId, 'complete', 1, message)
    this.emit({ jobId, type: 'complete', progress: 1, message, payload })
  }

  fail(jobId: string, error: string): void {
    if (this.terminal.has(jobId)) return
    this.terminal.add(jobId)
    this.controllers.delete(jobId)
    this.db.updateJob(jobId, 'error', 1, 'Failed', error)
    this.emit({ jobId, type: 'error', progress: 1, message: 'Failed', error })
  }

  cancel(jobId: string): void {
    if (this.terminal.has(jobId)) return
    this.terminal.add(jobId)
    this.cancelled.add(jobId)
    this.controllers.get(jobId)?.abort()
    this.scheduleCancelledControllerCleanup(jobId)
    this.db.updateJob(jobId, 'cancelled', 1, 'Cancelled')
    this.emit({ jobId, type: 'cancelled', progress: 1, message: 'Cancelled' })
  }

  isCancelled(jobId: string): boolean {
    return this.cancelled.has(jobId)
  }

  signal(jobId: string): AbortSignal | undefined {
    return this.controllers.get(jobId)?.signal
  }

  on(jobId: string, listener: (event: JobEvent) => void): () => void {
    const eventName = `job:${jobId}`
    this.emitter.on(eventName, listener)
    const events = this.history.get(jobId) || []
    for (const event of events) {
      listener(event)
    }
    return () => this.emitter.off(eventName, listener)
  }

  private emit(event: JobEvent): void {
    const events = this.history.get(event.jobId) || []
    events.push(event)
    this.history.set(event.jobId, events.slice(-50))
    this.emitter.emit(`job:${event.jobId}`, event)
  }

  private scheduleCancelledControllerCleanup(jobId: string): void {
    const timeout = setTimeout(() => {
      this.controllers.delete(jobId)
    }, this.cancelledControllerTtlMs)
    timeout.unref?.()
  }
}
