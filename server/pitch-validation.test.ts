import { describe, expect, it } from 'vitest'
import { validatePitch } from './pitch-validation.ts'

describe('pitch validation', () => {
  it('rejects an empty microphone turn', () => {
    expect(validatePitch('   ')).toMatchObject({ valid: false, code: 'empty-pitch' })
  })

  it('does not let a greeting become a jury verdict', () => {
    expect(validatePitch('Can you hear me?')).toMatchObject({ valid: false, code: 'side-conversation' })
  })

  it('accepts a concise, real pitch', () => {
    expect(validatePitch('We are building an app for student teams that turns chaotic project notes into a clear next action list.')).toMatchObject({ valid: true })
  })
})
