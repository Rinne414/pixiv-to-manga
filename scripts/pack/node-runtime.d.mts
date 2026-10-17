export const NODE_VERSION: string
export function downloadTo(url: string, destination: string, maxBytes: number): Promise<void>
export function recordVerified(recordPath: string, files: Record<string, string>): Promise<void>
export function cacheIsIntact(recordPath: string, files: Record<string, string>): Promise<boolean>
export function ensureNodeRuntime(cacheDir: string, target: string): Promise<{ binaryPath: string; licensePath: string }>
