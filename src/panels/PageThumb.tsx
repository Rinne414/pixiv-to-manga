import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import type { Asset, Page } from '../shared/types'
import { useI18n } from '../i18n/context'
import { pageStatusKeys } from './labels'

export function PageThumb(props: {
  page: Page
  asset?: Asset
  active: boolean
  dialogueCount: number
  pageCount: number
  disabled: boolean
  onClick: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
}) {
  const { t } = useI18n()
  const isFirst = props.page.index === 0
  const isLast = props.page.index === props.pageCount - 1
  return (
    <div className="page-thumb-row">
      <button type="button" className={`page-thumb ${props.active ? 'active' : ''}`} data-testid="page-thumb" onClick={props.onClick}>
        <div className="thumb-image">
          {props.asset ? <img src={props.asset.url} alt={t('studio.pageLabel', { n: props.page.index + 1 })} /> : null}
        </div>
        <div>
          <strong>{t('studio.pageLabel', { n: props.page.index + 1 })}</strong>
          <span>{t('studio.pageThumbSummary', { count: props.dialogueCount, status: t(pageStatusKeys[props.page.status]) })}</span>
        </div>
      </button>
      <div className="page-thumb-actions">
        <button
          type="button"
          title={t('studio.movePageUp')}
          aria-label={t('studio.movePageUp')}
          data-testid="page-move-up"
          disabled={props.disabled || isFirst}
          onClick={props.onMoveUp}
        >
          <ChevronUp size={13} />
        </button>
        <button
          type="button"
          title={t('studio.movePageDown')}
          aria-label={t('studio.movePageDown')}
          data-testid="page-move-down"
          disabled={props.disabled || isLast}
          onClick={props.onMoveDown}
        >
          <ChevronDown size={13} />
        </button>
        <button
          type="button"
          className="danger"
          title={t('studio.deletePage')}
          aria-label={t('studio.deletePage')}
          data-testid="page-delete"
          disabled={props.disabled}
          onClick={props.onDelete}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}
