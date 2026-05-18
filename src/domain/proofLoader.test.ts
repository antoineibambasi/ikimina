import { describe, expect, it } from 'vitest'
import { buildProofCandidate, summarizeProofCandidates } from './proofLoader'
import type { IkiminaDataset } from './types'

const dataset: IkiminaDataset = {
  cycle: {
    id: 'cycle-1',
    name: 'IKIMINA 2025-2026',
    currency: 'EUR',
    startMonth: '2025-06-01',
    endMonth: '2026-08-01',
    defaults: {
      contributionCents: 100_00,
      savingCents: 20_00,
      mutualInsuranceCents: 5_00,
    },
  },
  members: [
    {
      id: 'member-ibambasi-antoine',
      name: 'IBAMBASI ANTOINE',
      successionOrder: 7,
      status: 'active',
    },
  ],
  periods: [
    {
      id: 'period-2026-01',
      cycleId: 'cycle-1',
      label: 'JANVIER 2026',
      month: '2026-01-01',
      status: 'closed',
    },
  ],
  openingBalances: [],
  monthlyEntries: [],
  auditEvents: [],
  exports: [],
  importReport: {
    sourceWorkbook: 'test.xlsx',
    generatedAt: '2026-05-18T00:00:00.000Z',
    ignoredFormulaErrors: 0,
    warnings: [],
    periodTotals: [],
  },
}

describe('proof loader', () => {
  it('suggests member, period, amount and purpose from a proof file', () => {
    const candidate = buildProofCandidate(dataset, {
      fileName: 'preuve-IBAMBASI-ANTOINE-janvier-2026-125-eur.pdf',
      fileType: 'application/pdf',
      sizeBytes: 12_000,
    })

    expect(candidate).toMatchObject({
      member: dataset.members[0],
      period: dataset.periods[0],
      amountCents: 125_00,
      purpose: 'cotisation_epargne_assurance',
      status: 'ready',
    })
  })

  it('summarizes candidates for triage', () => {
    const ready = buildProofCandidate(dataset, {
      fileName: 'preuve-IBAMBASI-ANTOINE-janvier-2026-100-eur.pdf',
      fileType: 'application/pdf',
    })
    const review = buildProofCandidate(dataset, {
      fileName: 'preuve-inconnue.pdf',
      fileType: 'application/pdf',
    })

    expect(summarizeProofCandidates([ready, review])).toEqual({
      total: 2,
      ready: 1,
      needsReview: 1,
      unsupported: 0,
    })
  })
})
