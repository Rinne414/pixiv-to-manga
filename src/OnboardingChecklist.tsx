import { useState } from 'react'
import { Circle, CircleCheck, Compass, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useI18n } from './i18n/context'
import type { MessageKey } from './i18n/messages'
import { MotionIcon } from './MotionUI'
import { quickTransition } from './motionTokens'

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
    <AnimatePresence initial={false}>
    {!dismissed ? (
    <motion.section
      className="onboarding-card"
      data-testid="onboarding-card"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={quickTransition}
    >
      <div className="panel-heading onboarding-heading">
        <Compass size={16} />
        <span>{t('onboarding.title')}</span>
        <motion.button
          type="button"
          className="icon-button onboarding-dismiss"
          data-testid="onboarding-dismiss"
          title={t('onboarding.dismiss')}
          aria-label={t('onboarding.dismiss')}
          whileHover={{ rotate: 8 }}
          whileTap={{ scale: 0.86, rotate: -8 }}
          onClick={dismiss}
        >
          <X size={14} />
        </motion.button>
      </div>
      <ol className="onboarding-steps">
        {steps.map((step) => (
          <motion.li key={step.key} layout data-testid="onboarding-step" data-done={step.done} transition={quickTransition}>
            <MotionIcon icon={step.done ? CircleCheck : Circle} state={step.done ? 'done' : 'pending'} size={15} spin={false} />
            <span>{t(step.key)}</span>
          </motion.li>
        ))}
      </ol>
    </motion.section>
    ) : null}
    </AnimatePresence>
  )
}
