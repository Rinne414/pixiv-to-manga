import type { ComponentType } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { IconProps } from './uiUtils'
import { quickTransition, softSpring } from './motionTokens'

export interface MotionIconProps {
  icon: ComponentType<IconProps>
  state: string
  size: number
  spin: boolean
}

export function MotionIcon(props: MotionIconProps) {
  const reducedMotion = useReducedMotion()
  const Icon = props.icon

  return (
    <span className="motion-icon" aria-hidden="true">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={props.state}
          className="motion-icon-layer"
          initial={reducedMotion ? false : { opacity: 0, rotate: -24, scale: 0.55 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, rotate: 24, scale: 0.55 }}
          transition={quickTransition}
        >
          <motion.span
            className="motion-icon-glyph"
            animate={reducedMotion || !props.spin ? { rotate: 0 } : { rotate: 360 }}
            transition={
              reducedMotion || !props.spin
                ? quickTransition
                : { duration: 0.9, ease: 'linear', repeat: Number.POSITIVE_INFINITY }
            }
          >
            <Icon size={props.size} strokeWidth={1.9} />
          </motion.span>
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

export function ActiveIndicator(props: { layoutId: string; className: string }) {
  const reducedMotion = useReducedMotion()
  return (
    <motion.span
      aria-hidden="true"
      className={props.className}
      layoutId={props.layoutId}
      transition={reducedMotion ? { duration: 0 } : softSpring}
    />
  )
}
