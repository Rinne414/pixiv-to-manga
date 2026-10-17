export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  pre: string[]
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

export function parseVersion(text: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(text.trim())
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split('.') : [],
  }
}

/** Semver order: negative when a < b, positive when a > b. Unparseable input throws. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) throw new RangeError(`Cannot compare versions "${a}" and "${b}"`)
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] - right[key]
  }
  return comparePrerelease(left.pre, right.pre)
}

export function isNewerVersion(candidate: string, current: string): boolean {
  if (!parseVersion(candidate) || !parseVersion(current)) return false
  return compareVersions(candidate, current) > 0
}

function comparePrerelease(a: string[], b: string[]): number {
  // A release outranks any prerelease of the same number.
  if (!a.length || !b.length) return b.length - a.length
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i]
    const y = b[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    const xNumeric = /^\d+$/.test(x)
    const yNumeric = /^\d+$/.test(y)
    if (xNumeric && yNumeric) return Number(x) - Number(y)
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1
    return x < y ? -1 : 1
  }
  return 0
}
