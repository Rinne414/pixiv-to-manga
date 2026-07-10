import { useState } from 'react'
import { Circle, CircleCheck, Compass, X } from 'lucide-react'
import { useI18n } from './i18n/context'
import type { MessageKey } from './i18n/messages'

const ONBOARDING_DISMISSED_KEY = 'ptm-onboarding-dismissed'

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDING_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

interface OnboardingChecklistProps {
  hasPages: boolean
  hasProvider: boolean
  hasStoryBible: boolean
  hasDialogues: boolean
  hasExported: boolean
}

export function OnboardingChecklist(props: OnboardingChecklistProps) {
  const { t } = useI18n()
  const [dismissed, setDismissed] = useState(readDismissed)

  if (dismissed) {
    return null
  }

  const steps: Array<{ key: MessageKey; done: boolean }> = [
    { key: 'onboarding.stepImport', done: props.hasPages },
    { key: 'onboarding.stepProvider', done: props.hasProvider },
    { key: 'onboarding.stepAnalyze', done: props.hasStoryBible },
    { key: 'onboarding.stepGenerate', done: props.hasDialogues },
    { key: 'onboarding.stepExport', done: props.hasExported },
  ]

  const dismiss = () => {
    setDismissed(true)
    try {
      window.localStorage.setItem(ONBOARDING_DISMISSED_KEY, '1')
    } catch {
      // Preference simply resets next session when storage is unavailable.
    }
  }

  return (
    <section className="onboarding-card" data-testid="onboarding-card">
      <div className="panel-heading onboarding-heading">
        <Compass size={16} />
        <span>{t('onboarding.title')}</span>
        <button
          type="button"
          className="icon-button onboarding-dismiss"
          data-testid="onboarding-dismiss"
          title={t('onboarding.dismiss')}
          aria-label={t('onboarding.dismiss')}
          onClick={dismiss}
        >
          <X size={14} />
        </button>
      </div>
      <ol className="onboarding-steps">
        {steps.map((step) => (
          <li key={step.key} data-testid="onboarding-step" data-done={step.done}>
            {step.done ? <CircleCheck size={15} /> : <Circle size={15} />}
            <span>{t(step.key)}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
