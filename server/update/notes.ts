/** Plain-text excerpt of a release body for the in-app summary. */
export function summarizeReleaseNotes(body: string | null | undefined, maxLength: number): string {
  if (!body) return ''
  const plain = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/[*_`~>]/g, '')
    .replace(/^-{3,}\s*$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (plain.length <= maxLength) return plain
  const cut = plain.slice(0, maxLength)
  const boundary = cut.lastIndexOf(' ')
  return `${(boundary > maxLength * 0.6 ? cut.slice(0, boundary) : cut).trimEnd()}…`
}
