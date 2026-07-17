import { useState } from 'react'
import { Lock, Plus, Trash2, Unlock, WandSparkles } from 'lucide-react'
import type { BubbleStyle, Dialogue, FontAsset, TextDirection } from '../shared/types'
import { FONT_PRESETS, fontValueFromFamily } from '../fonts'
import { useI18n } from '../i18n/context'
import { bubbleStyleKeys, bubbleStyles } from './labels'

export function DialoguePanel(props: {
  dialogues: Dialogue[]
  selectedDialogue?: Dialogue
  customFonts: FontAsset[]
  canAdd: boolean
  canRegenerate: boolean
  onAdd: () => void
  onDelete: (id: string) => void
  onSelect: (id: string) => void
  onLocalChange: (id: string, patch: Partial<Dialogue>) => void
  onCommit: (id: string, patch: Partial<Dialogue>) => void
  onRegenerate: (id: string, instruction: string) => void
}) {
  const { t } = useI18n()
  const [instruction, setInstruction] = useState('')
  const dialogue = props.selectedDialogue
  return (
    <div className="inspector-body">
      <button type="button" className="secondary-button" data-testid="dialogue-add" disabled={!props.canAdd} onClick={props.onAdd}>
        <Plus size={15} />
        {t('dialogue.add')}
      </button>
      <div className="dialogue-stack">
        {props.dialogues.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`dialogue-chip ${item.id === dialogue?.id ? 'active' : ''}`}
            data-testid="dialogue-chip"
            onClick={() => props.onSelect(item.id)}
          >
            <span style={{ borderColor: item.color }} />
            {item.text}
          </button>
        ))}
      </div>

      {dialogue ? (
        <div className="edit-form">
          <label>
            {t('dialogue.text')}
            <textarea
              value={dialogue.text}
              rows={5}
              onChange={(event) => props.onLocalChange(dialogue.id, { text: event.target.value })}
              onBlur={() => props.onCommit(dialogue.id, { text: dialogue.text })}
            />
          </label>
          <div className="regen-block">
            <input
              value={instruction}
              placeholder={t('dialogue.instructionPlaceholder')}
              aria-label={t('dialogue.instructionPlaceholder')}
              data-testid="dialogue-instruction"
              onChange={(event) => setInstruction(event.target.value)}
            />
            <button
              type="button"
              className="secondary-button"
              data-testid="dialogue-regenerate"
              disabled={!props.canRegenerate}
              onClick={() => props.onRegenerate(dialogue.id, instruction.trim())}
            >
              <WandSparkles size={15} />
              {t('dialogue.regenerate')}
            </button>
          </div>
          <label>
            {t('dialogue.character')}
            <input
              value={dialogue.characterName || ''}
              onChange={(event) => props.onLocalChange(dialogue.id, { characterName: event.target.value })}
              onBlur={() => props.onCommit(dialogue.id, { characterName: dialogue.characterName })}
            />
          </label>
          <div className="two-col">
            <label>
              {t('character.color')}
              <input
                type="color"
                value={dialogue.color}
                onChange={(event) => {
                  props.onLocalChange(dialogue.id, { color: event.target.value })
                  props.onCommit(dialogue.id, { color: event.target.value })
                }}
              />
            </label>
            <label>
              {t('character.bubble')}
              <select
                value={dialogue.bubbleStyle}
                onChange={(event) => {
                  const bubbleStyle = event.target.value as BubbleStyle
                  props.onLocalChange(dialogue.id, { bubbleStyle })
                  props.onCommit(dialogue.id, { bubbleStyle })
                }}
              >
                {bubbleStyles.map((style) => (
                  <option key={style} value={style}>
                    {t(bubbleStyleKeys[style])}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="two-col">
            <label>
              {t('dialogue.direction')}
              <select
                value={dialogue.textDirection || 'vertical'}
                data-testid="dialogue-direction"
                onChange={(event) => {
                  const textDirection = event.target.value as TextDirection
                  props.onLocalChange(dialogue.id, { textDirection })
                  props.onCommit(dialogue.id, { textDirection })
                }}
              >
                <option value="vertical">{t('dialogue.vertical')}</option>
                <option value="horizontal">{t('dialogue.horizontal')}</option>
              </select>
            </label>
            <label>
              {t('dialogue.font')}
              <select
                value={dialogue.fontFamily || ''}
                data-testid="dialogue-font"
                onChange={(event) => {
                  const fontFamily = event.target.value || undefined
                  props.onLocalChange(dialogue.id, { fontFamily })
                  props.onCommit(dialogue.id, { fontFamily })
                }}
              >
                <option value="">{t('dialogue.fontInherit')}</option>
                {FONT_PRESETS.filter((preset) => preset.value).map((preset) => (
                  <option key={preset.labelKey} value={preset.value}>
                    {t(preset.labelKey)}
                  </option>
                ))}
                {props.customFonts.map((font) => (
                  <option key={font.id} value={fontValueFromFamily(font.familyName)}>
                    {font.familyName}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="two-col">
            <button
              type="button"
              className="secondary-button"
              aria-pressed={dialogue.locked}
              data-testid="dialogue-lock-toggle"
              onClick={() => props.onCommit(dialogue.id, dialogue.locked ? { locked: false } : { locked: true })}
            >
              {dialogue.locked ? <Unlock size={15} /> : <Lock size={15} />}
              {dialogue.locked ? t('dialogue.unlock') : t('dialogue.lock')}
            </button>
            <button
              type="button"
              className="secondary-button danger-button"
              data-testid="dialogue-delete"
              onClick={() => props.onDelete(dialogue.id)}
            >
              <Trash2 size={15} />
              {t('dialogue.delete')}
            </button>
          </div>
        </div>
      ) : (
        <p className="empty-text">{t('dialogue.empty')}</p>
      )}
    </div>
  )
}
