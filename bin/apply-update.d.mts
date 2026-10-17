export const PROTECTED_ENTRIES: Set<string>

export interface ApplyUpdateJob {
  appRoot: string
  stagedRoot: string
  dataDir: string
  failAfterEntries?: number
}

export function planReplacement(job: ApplyUpdateJob): { replace: string[] }
export function applyUpdate(job: ApplyUpdateJob): void
