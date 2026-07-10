export function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

/** Punctuation that must not start a vertical column (行頭禁則); it hangs at the bottom of the previous column instead. */
const KINSOKU_NO_COLUMN_START = new Set(
  Array.from('、。，．！？；：・」』）】〉》〕｝!?,.;:)]…‥ーっゃゅょぁぃぅぇぉッャュョァィゥェォ〜～'),
)
/** Opening brackets that must not end a vertical column (行末禁則); they carry over to the next column. */
const KINSOKU_NO_COLUMN_END = new Set(Array.from('「『（【〈《〔｛(['))
/** How many prohibited leading chars may hang below a full column before we give up and wrap anyway. */
const KINSOKU_MAX_HANGING_CHARS = 2

/**
 * Splits dialogue text into vertical manga columns (right-to-left rendering order),
 * applying CJK kinsoku rules so punctuation never starts a column and opening
 * brackets never end one. Renderers size bubbles from the actual max column length,
 * so hanging punctuation stays WYSIWYG between the editor and PNG export.
 */
export function toVerticalColumns(text: string, rowsPerColumn: number): string[] {
  const chars = Array.from(text.replace(/\s+/g, ''))
  const columns: string[][] = []
  let column: string[] = []

  for (const char of chars) {
    if (column.length >= rowsPerColumn) {
      if (KINSOKU_NO_COLUMN_START.has(char) && column.length < rowsPerColumn + KINSOKU_MAX_HANGING_CHARS) {
        column.push(char)
        continue
      }
      // Carry trailing opening brackets into the next column; never let them end a column.
      const carried: string[] = []
      while (column.length && KINSOKU_NO_COLUMN_END.has(column[column.length - 1])) {
        carried.unshift(column.pop() as string)
      }
      if (column.length) {
        columns.push(column)
      }
      column = carried
    }
    column.push(char)
  }
  if (column.length) {
    columns.push(column)
  }

  return columns.length ? columns.map((item) => item.join('')) : ['']
}
