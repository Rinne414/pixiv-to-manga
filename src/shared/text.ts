export function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

/** Splits dialogue text into vertical manga columns (right-to-left rendering order). */
export function toVerticalColumns(text: string, rowsPerColumn: number): string[] {
  const chars = Array.from(text.replace(/\s+/g, ''))
  const columns: string[] = []
  for (let index = 0; index < chars.length; index += rowsPerColumn) {
    columns.push(chars.slice(index, index + rowsPerColumn).join(''))
  }
  return columns.length ? columns : ['']
}
