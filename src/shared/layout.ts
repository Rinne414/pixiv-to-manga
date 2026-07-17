import type { BubbleStyle, Dialogue, PanelBox, TextDirection } from './types'

export interface LayoutBox {
  id: string
  x: number
  y: number
  width: number
  height: number
}

/** SFX text draws bubble-less at display size; every renderer and estimate must agree. */
export const SFX_FONT_MULTIPLIER = 1.6

export function dialogueFontScale(dialogue: Pick<Dialogue, 'scale'> & { bubbleStyle?: BubbleStyle }): number {
  return dialogue.scale * (dialogue.bubbleStyle === 'sfx' ? SFX_FONT_MULTIPLIER : 1)
}

export function estimateVerticalTextBox(
  dialogue: Pick<Dialogue, 'id' | 'text' | 'x' | 'y' | 'scale'> & { bubbleStyle?: BubbleStyle; textDirection?: TextDirection },
): LayoutBox {
  const chars = dialogue.text.replace(/\s+/g, '').length
  const runs = Math.max(1, Math.ceil(chars / 11))
  const scale = dialogueFontScale(dialogue)

  if (dialogue.textDirection === 'horizontal') {
    const width = Math.min(0.5, Math.max(0.12, Math.min(chars, 11) * 0.03 * scale + 0.06))
    const height = Math.min(0.3, Math.max(0.08, runs * 0.05 * scale + 0.04))
    return { id: dialogue.id, x: clamp01(dialogue.x), y: clamp01(dialogue.y), width, height }
  }

  const width = Math.min(0.28, Math.max(0.08, runs * 0.045 * scale))
  const height = Math.min(0.42, Math.max(0.16, Math.min(chars, 11) * 0.035 * scale + 0.08))

  return {
    id: dialogue.id,
    x: clamp01(dialogue.x),
    y: clamp01(dialogue.y),
    width,
    height,
  }
}

export function resolveDialogueCollisions<T extends Dialogue>(dialogues: T[]): T[] {
  const adjusted = dialogues.map((dialogue) => ({ ...dialogue }))

  for (let pass = 0; pass < 24; pass += 1) {
    let changed = false
    for (let i = 0; i < adjusted.length; i += 1) {
      for (let j = i + 1; j < adjusted.length; j += 1) {
        if (adjusted[i].locked && adjusted[j].locked) {
          continue
        }

        const a = estimateVerticalTextBox(adjusted[i])
        const b = estimateVerticalTextBox(adjusted[j])
        const overlapX = a.width / 2 + b.width / 2 - Math.abs(a.x - b.x)
        const overlapY = a.height / 2 + b.height / 2 - Math.abs(a.y - b.y)

        if (overlapX > 0 && overlapY > 0) {
          changed = true
          const pushX = overlapX < overlapY
          const dir = pushX ? Math.sign(a.x - b.x) || 1 : Math.sign(a.y - b.y) || 1
          const delta = Math.min(0.06, (pushX ? overlapX : overlapY) / 2 + 0.01)

          if (!adjusted[i].locked) {
            if (pushX) adjusted[i].x = clamp01(adjusted[i].x + delta * dir)
            else adjusted[i].y = clamp01(adjusted[i].y + delta * dir)
          }
          if (!adjusted[j].locked) {
            if (pushX) adjusted[j].x = clamp01(adjusted[j].x - delta * dir)
            else adjusted[j].y = clamp01(adjusted[j].y - delta * dir)
          }
        }
      }
    }

    for (const dialogue of adjusted) {
      const box = estimateVerticalTextBox(dialogue)
      dialogue.x = clamp(dialogue.x, box.width / 2 + 0.02, 1 - box.width / 2 - 0.02)
      dialogue.y = clamp(dialogue.y, box.height / 2 + 0.02, 1 - box.height / 2 - 0.02)
    }

    if (!changed) {
      break
    }
  }

  return adjusted
}

const PANEL_SNAP_MARGIN = 0.02

/**
 * Clamps dialogue anchors into the panel grid: positions already inside a panel
 * stay put, strays move to the inside edge of the nearest panel (by center
 * distance). No-op when the page has no panels drawn.
 */
export function snapDialoguesToPanels<T extends Pick<Dialogue, 'x' | 'y'>>(dialogues: T[], panels: PanelBox[] | undefined): T[] {
  if (!panels?.length) {
    return dialogues
  }
  return dialogues.map((dialogue) => {
    const inside = panels.some(
      (panel) =>
        dialogue.x >= panel.x && dialogue.x <= panel.x + panel.width && dialogue.y >= panel.y && dialogue.y <= panel.y + panel.height,
    )
    if (inside) {
      return dialogue
    }
    const nearest = panels.reduce((best, panel) => {
      const distance = (dx: PanelBox) => {
        const cx = dx.x + dx.width / 2
        const cy = dx.y + dx.height / 2
        return (dialogue.x - cx) ** 2 + (dialogue.y - cy) ** 2
      }
      return distance(panel) < distance(best) ? panel : best
    })
    return {
      ...dialogue,
      x: clamp(dialogue.x, nearest.x + PANEL_SNAP_MARGIN, nearest.x + nearest.width - PANEL_SNAP_MARGIN),
      y: clamp(dialogue.y, nearest.y + PANEL_SNAP_MARGIN, nearest.y + nearest.height - PANEL_SNAP_MARGIN),
    }
  })
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
