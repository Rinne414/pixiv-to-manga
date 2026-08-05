export const quickTransition = {
  duration: 0.16,
  ease: [0.22, 1, 0.36, 1] as const,
}

export const softSpring = {
  type: 'spring' as const,
  stiffness: 520,
  damping: 36,
  mass: 0.72,
}
