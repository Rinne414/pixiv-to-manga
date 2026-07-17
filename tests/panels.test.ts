import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { panelPromptSection } from '../server/ai'
import { StudioDatabase } from '../server/database'
import { snapDialoguesToPanels } from '../src/shared/layout'
import { updatePagePanelsSchema } from '../src/shared/schemas'
import type { PanelBox } from '../src/shared/types'

const PANELS: PanelBox[] = [
  { x: 0.05, y: 0.05, width: 0.4, height: 0.4 },
  { x: 0.55, y: 0.55, width: 0.4, height: 0.4 },
]

describe('snapDialoguesToPanels', () => {
  it('keeps anchors already inside a panel and moves strays into the nearest one', () => {
    const snapped = snapDialoguesToPanels(
      [
        { x: 0.2, y: 0.2 },
        { x: 0.5, y: 0.98 },
      ],
      PANELS,
    )
    expect(snapped[0]).toEqual({ x: 0.2, y: 0.2 })
    // (0.5, 0.98) is closest to the second panel; both axes clamp inside it.
    expect(snapped[1].x).toBeGreaterThanOrEqual(0.55)
    expect(snapped[1].x).toBeLessThanOrEqual(0.95)
    expect(snapped[1].y).toBeLessThanOrEqual(0.95)
  })

  it('is a no-op without panels', () => {
    const dialogues = [{ x: 0.9, y: 0.9 }]
    expect(snapDialoguesToPanels(dialogues, undefined)).toBe(dialogues)
    expect(snapDialoguesToPanels(dialogues, [])).toBe(dialogues)
  })
})

describe('panelPromptSection', () => {
  it('describes panels in reading order with RTL wording', () => {
    const section = panelPromptSection(PANELS, 'rtl')
    expect(section).toContain('2 个分格')
    expect(section).toContain('从右到左')
    expect(section).toContain('格1：x 0.05-0.45')
    expect(section).toContain('格2：x 0.55-0.95')
    expect(panelPromptSection(PANELS, 'ltr')).toContain('从左到右')
    expect(panelPromptSection(undefined, 'rtl')).toBe('')
    expect(panelPromptSection([], 'rtl')).toBe('')
  })
})

describe('page panel persistence', () => {
  afterEach(() => {
    delete process.env.PTM_DATA_DIR
  })

  it('round-trips panels through the database and clears with an empty list', () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ptm-panels-test-'))
    process.env.PTM_DATA_DIR = dataDir
    const db = new StudioDatabase(path.join(dataDir, 'studio.sqlite'), false)
    const project = db.createProject({ title: 'Panels', mode: 'story', source: 'local' })
    const asset = db.createAsset({
      projectId: project.id,
      kind: 'original',
      relativePath: path.join('projects', project.id, 'originals', 'p.png'),
      mimeType: 'image/png',
      width: 100,
      height: 100,
    })
    const page = db.createPage({ projectId: project.id, index: 0, originalAssetId: asset.id })

    const withPanels = db.updatePagePanels(page.id, PANELS)
    expect(withPanels.panels).toEqual(PANELS)

    const cleared = db.updatePagePanels(page.id, [])
    expect(cleared.panels).toBeUndefined()
  })

  it('schema rejects out-of-range and oversized panel lists', () => {
    expect(() => updatePagePanelsSchema.parse({ panels: [{ x: -0.1, y: 0, width: 0.5, height: 0.5 }] })).toThrow()
    expect(() => updatePagePanelsSchema.parse({ panels: Array.from({ length: 13 }, () => PANELS[0]) })).toThrow()
    expect(updatePagePanelsSchema.parse({ panels: PANELS }).panels).toHaveLength(2)
  })
})
