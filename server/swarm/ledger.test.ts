import { describe, expect, it, vi } from 'vitest'
import { Ledger } from './ledger.ts'

const runtime = () => ({ emit: vi.fn() })
const evidence = (overrides: Record<string, unknown> = {}) => ({
  status: 'unproven' as const, capturedAt: '2026-01-01T00:00:00.000Z', screenshotCaptured: false, ...overrides,
})

describe('Ledger deep-read and evidence guards', () => {
  it('spends the interactive deep-read budget exactly once', () => {
    const ledger = new Ledger('Pitch', 'Hackathon', runtime())
    expect(ledger.claimDeepRead()).toBe(true)
    expect(ledger.claimDeepRead()).toBe(false)
    expect(ledger.claimDeepRead()).toBe(false)
  })

  it('rehydrates an interaction as an already-spent deep read', () => {
    const ledger = new Ledger('Pitch', 'Hackathon', runtime())
    const snapshot = ledger.snapshot()
    snapshot.evidence.push(evidence({ interaction: { instruction: 'Close popup', acted: 'Closed' } }))
    const restored = Ledger.fromSnapshot(snapshot, [], runtime())
    expect(restored.claimDeepRead()).toBe(false)
  })

  it('lets only judged evidence change a claim status', () => {
    const ledger = new Ledger('Pitch', 'Hackathon', runtime())
    const [claim] = ledger.addClaims([{ id: 'claim-1', claim: 'A claim', type: 'market', importance: 3, confidence: 0.5, researchQuery: 'claim', evidenceStatus: 'unproven' }])
    ledger.addEvidence(evidence({ claimId: claim.id, status: 'verified', judged: true }))
    expect(claim.evidenceStatus).toBe('verified')
    ledger.addEvidence(evidence({ claimId: claim.id, status: 'unproven', judged: false }))
    expect(claim.evidenceStatus).toBe('verified')
  })
})
