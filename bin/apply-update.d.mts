export const PROTECTED_ENTRIES: Set<string>

export interface ApplyUpdateJob {
  appRoot: string
  stagedRoot: string
  dataDir: string
  failAfterEntries?: number
  caseInsensitive?: boolean
}

export function planReplacement(job: ApplyUpdateJob): { replace: string[] }
export function recoverInterruptedSwap(appRoot: string): { restored: boolean }
export function applyUpdate(job: ApplyUpdateJob): void
