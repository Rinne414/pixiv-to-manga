import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { motion } from 'motion/react'
import type { Asset, Page } from '../shared/types'
import { useI18n } from '../i18n/context'
import { pageStatusKeys } from './labels'
import { ActiveIndicator } from '../MotionUI'
import { quickTransition, softSpring } from '../motionTokens'

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
    <motion.div className="page-thumb-row" layout="position" transition={softSpring}>
      <motion.button
        type="button"
        className={`page-thumb ${props.active ? 'active' : ''}`}
        data-testid="page-thumb"
        whileHover={{ x: 2 }}
        whileTap={{ scale: 0.985 }}
        transition={quickTransition}
        onClick={props.onClick}
      >
        {props.active ? <ActiveIndicator layoutId="active-page-row" className="page-active-indicator" /> : null}
        <div className="thumb-image">
          {props.asset ? <img src={props.asset.url} alt={t('studio.pageLabel', { n: props.page.index + 1 })} /> : null}
        </div>
        <div>
          <strong>{t('studio.pageLabel', { n: props.page.index + 1 })}</strong>
          <span>{t('studio.pageThumbSummary', { count: props.dialogueCount, status: t(pageStatusKeys[props.page.status]) })}</span>
        </div>
      </motion.button>
      <div className="page-thumb-actions">
        <motion.button
          type="button"
          title={t('studio.movePageUp')}
          aria-label={t('studio.movePageUp')}
          data-testid="page-move-up"
          disabled={props.disabled || isFirst}
          whileTap={{ scale: 0.84, y: -1 }}
          onClick={props.onMoveUp}
        >
          <ChevronUp size={13} />
        </motion.button>
        <motion.button
          type="button"
          title={t('studio.movePageDown')}
          aria-label={t('studio.movePageDown')}
          data-testid="page-move-down"
          disabled={props.disabled || isLast}
          whileTap={{ scale: 0.84, y: 1 }}
          onClick={props.onMoveDown}
        >
          <ChevronDown size={13} />
        </motion.button>
        <motion.button
          type="button"
          className="danger"
          title={t('studio.deletePage')}
          aria-label={t('studio.deletePage')}
          data-testid="page-delete"
          disabled={props.disabled}
          whileTap={{ scale: 0.84 }}
          onClick={props.onDelete}
        >
          <Trash2 size={13} />
        </motion.button>
      </div>
    </motion.div>
  )
}
