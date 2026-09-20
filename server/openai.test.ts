import { describe, expect, it } from 'vitest'
import { deterministicInterjection } from './openai.ts'

describe('live pitch interjections', () => {
  it('turns an unsupported uniqueness claim into an intent to research, not a fabricated receipt', () => {
    const turn = deterministicInterjection('Nobody else is doing this.', [])
    expect(turn?.juror).toBe('gale')
    expect(turn?.line).toMatch(/opening a browser/i)
    expect(turn?.line).not.toMatch(/I (looked|found|verified)/i)
  })

  it('does not let the same juror interrupt twice', () => {
    expect(deterministicInterjection('Nobody else is doing this.', ['gale'])).toBeNull()
  })

  it('routes scope creep to Ember rather than making every interruption a research event', () => {
    const turn = deterministicInterjection('Plus we also have journaling and social features.', [])
    expect(turn?.juror).toBe('ember')
    expect(turn?.trigger).toBe('scope creep')
  })
})
