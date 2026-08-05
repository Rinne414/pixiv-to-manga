import { useEffect } from 'react'
import { BookOpenCheck, KeyRound, ShieldAlert, X } from 'lucide-react'
import { useI18n } from './i18n/context'
import type { MessageKey } from './i18n/messages'

interface GuideModalProps {
  onClose: () => void
}

const guideSteps: Array<{ title: MessageKey; body: MessageKey }> = [
  { title: 'guide.stepImportTitle', body: 'guide.stepImportBody' },
  { title: 'guide.stepProviderTitle', body: 'guide.stepProviderBody' },
  { title: 'guide.stepGenerateTitle', body: 'guide.stepGenerateBody' },
  { title: 'guide.stepEditTitle', body: 'guide.stepEditBody' },
  { title: 'guide.stepExportTitle', body: 'guide.stepExportBody' },
]

export function GuideModal(props: GuideModalProps) {
  const { t } = useI18n()
  const { onClose } = props

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="guide-overlay" role="presentation" data-testid="guide-overlay">
      <section className="guide-card" role="dialog" aria-modal="true" aria-labelledby="guide-title" data-testid="guide-modal">
        <div className="guide-header">
          <div>
            <div className="guide-title-row">
              <BookOpenCheck size={18} />
              <h2 id="guide-title">{t('guide.title')}</h2>
            </div>
            <p>{t('guide.intro')}</p>
          </div>
          <button type="button" className="icon-button" aria-label={t('guide.close')} title={t('guide.close')} data-testid="guide-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <ol className="guide-steps">
          {guideSteps.map((step) => (
            <li key={step.title}>
              <strong>{t(step.title)}</strong>
              <span>{t(step.body)}</span>
            </li>
          ))}
        </ol>

        <div className="guide-callout warning">
          <ShieldAlert size={17} />
          <div>
            <strong>{t('guide.pixivRiskTitle')}</strong>
            <p>{t('guide.pixivRiskBody')}</p>
          </div>
        </div>
        <div className="guide-callout">
          <KeyRound size={17} />
          <div>
            <strong>{t('guide.secretTitle')}</strong>
            <p>{t('guide.secretBody')}</p>
          </div>
        </div>
      </section>
    </div>
  )
}
