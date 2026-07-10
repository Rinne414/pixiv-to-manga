import type { Asset, Page } from '../shared/types'
import { useI18n } from '../i18n/context'
import { pageStatusKeys } from './labels'

export function PageThumb(props: {
  page: Page
  asset?: Asset
  active: boolean
  dialogueCount: number
  onClick: () => void
}) {
  const { t } = useI18n()
  return (
    <button type="button" className={`page-thumb ${props.active ? 'active' : ''}`} data-testid="page-thumb" onClick={props.onClick}>
      <div className="thumb-image">
        {props.asset ? <img src={props.asset.url} alt={t('studio.pageLabel', { n: props.page.index + 1 })} /> : null}
      </div>
      <div>
        <strong>{t('studio.pageLabel', { n: props.page.index + 1 })}</strong>
        <span>{t('studio.pageThumbSummary', { count: props.dialogueCount, status: t(pageStatusKeys[props.page.status]) })}</span>
      </div>
    </button>
  )
}
