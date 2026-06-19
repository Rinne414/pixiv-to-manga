export type SafetyClass = 'safe' | 'suggestive' | 'explicit' | 'illegal' | 'unknown' | 'failed'

export interface RouteSafetyInput {
  supportsVision: boolean
  allowsAdultInput: boolean
  allowsAdultGeneration: boolean
  r18: boolean
  imagePresent: boolean
  safetyClass: SafetyClass
}

export type RouteSafetyResult =
  | { allow: true; reason: 'allowed' }
  | {
      allow: false
      reason:
        | 'illegal_content'
        | 'r18_disabled'
        | 'vision_required'
        | 'adult_input_not_allowed'
        | 'explicit_image_not_allowed'
        | 'adult_generation_not_allowed'
        | 'safety_unknown'
        | 'safety_classification_failed'
    }

export function evaluateRouteSafety(input: RouteSafetyInput): RouteSafetyResult {
  if (input.safetyClass === 'illegal') {
    return { allow: false, reason: 'illegal_content' }
  }

  if (input.safetyClass === 'failed') {
    return { allow: false, reason: 'safety_classification_failed' }
  }

  if (input.safetyClass === 'unknown') {
    return { allow: false, reason: 'safety_unknown' }
  }

  const adultClass = input.safetyClass === 'suggestive' || input.safetyClass === 'explicit'

  if (adultClass && !input.r18) {
    return { allow: false, reason: 'r18_disabled' }
  }

  if (input.imagePresent && !input.supportsVision) {
    return { allow: false, reason: 'vision_required' }
  }

  if (input.imagePresent && input.safetyClass === 'explicit' && !input.allowsAdultInput) {
    return { allow: false, reason: 'explicit_image_not_allowed' }
  }

  if (input.imagePresent && adultClass && !input.allowsAdultInput) {
    return { allow: false, reason: 'adult_input_not_allowed' }
  }

  if (input.r18 && !input.allowsAdultGeneration) {
    return { allow: false, reason: 'adult_generation_not_allowed' }
  }

  return { allow: true, reason: 'allowed' }
}
