import type { Dialogue } from './types'

export interface LayoutBox {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export function estimateVerticalTextBox(dialogue: Pick<Dialogue, 'id' | 'text' | 'x' | 'y' | 'scale'>): LayoutBox {
  const chars = dialogue.text.replace(/\s+/g, '').length
  const columns = Math.max(1, Math.ceil(chars / 11))
  const width = Math.min(0.28, Math.max(0.08, columns * 0.045 * dialogue.scale))
  const height = Math.min(0.42, Math.max(0.16, Math.min(chars, 11) * 0.035 * dialogue.scale + 0.08))

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

export function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
