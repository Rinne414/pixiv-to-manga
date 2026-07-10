import { Lock, Plus, Trash2, Unlock } from 'lucide-react'
import type { BubbleStyle, Dialogue } from '../shared/types'
import { useI18n } from '../i18n/context'
import { bubbleStyleKeys, bubbleStyles } from './labels'

export function DialoguePanel(props: {
  dialogues: Dialogue[]
  selectedDialogue?: Dialogue
  canAdd: boolean
  onAdd: () => void
  onDelete: (id: string) => void
  onSelect: (id: string) => void
  onLocalChange: (id: string, patch: Partial<Dialogue>) => void
  onCommit: (id: string, patch: Partial<Dialogue>) => void
}) {
  const { t } = useI18n()
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
