import { describe, expect, it } from 'vitest'
import {
  calculateDashboardTotals,
  calculateMemberLedger,
  calculatePeriodTotals,
  getCollectiveFundRows,
  getCollectiveFundSummary,
  getContributionMatrix,
  getEntryStatus,
  getMemberTimeline,
  getPeriodDetail,
  getTontineRotation,
} from './calculations'
import type { IkiminaDataset, Member, MonthlyEntry, OpeningBalance, Period } from './types'

const member: Member = {
  id: 'member-1',
  name: 'MEMBRE TEST',
  successionOrder: 1,
  status: 'active',
}

const periods: Period[] = [
  {
    id: 'period-1',
    cycleId: 'cycle-1',
    label: 'JUIN 2025',
    month: '2025-06-01',
    status: 'closed',
  },
  {
    id: 'period-2',
    cycleId: 'cycle-1',
    label: 'JUILLET 2025',
    month: '2025-07-01',
    status: 'draft',
  },
]

const openingBalances: OpeningBalance[] = [
  {
    memberId: member.id,
    creditCents: 100_00,
    travelSavingCents: 25_00,
  },
]

const entries: MonthlyEntry[] = [
  {
    id: 'entry-1',
    periodId: 'period-1',
    memberId: member.id,
    contributionCents: 100_00,
    savingCents: 20_00,
    mutualInsuranceCents: 5_00,
    loanCents: 50_00,
    repaymentCents: 10_00,
    travelCents: 7_50,
  },
  {
    id: 'entry-2',
    periodId: 'period-2',
    memberId: member.id,
    contributionCents: 100_00,
    savingCents: 20_00,
    mutualInsuranceCents: 5_00,
    loanCents: 0,
    repaymentCents: 75_00,
    travelCents: 2_50,
  },
]

function datasetFixture(overrides: Partial<IkiminaDataset> = {}): IkiminaDataset {
  return {
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
    members: [member],
    periods,
    openingBalances,
    monthlyEntries: entries,
    auditEvents: [],
    exports: [],
    importReport: {
      sourceWorkbook: 'test.xlsx',
      generatedAt: '2026-05-18T00:00:00.000Z',
      ignoredFormulaErrors: 0,
      warnings: [],
      periodTotals: [],
    },
    ...overrides,
  }
}

describe('IKIMINA financial calculations', () => {
  it('sums period entries in cents', () => {
    expect(calculatePeriodTotals(entries)).toEqual({
      contributionCents: 200_00,
      savingCents: 40_00,
      mutualInsuranceCents: 10_00,
      loanCents: 50_00,
      repaymentCents: 85_00,
      travelCents: 10_00,
    })
  })

  it('calculates credit and travel balances through a selected period', () => {
    expect(
      calculateMemberLedger(member, openingBalances, entries, periods, 'period-2'),
    ).toMatchObject({
      creditBalanceCents: 65_00,
      travelBalanceCents: 35_00,
    })
  })

  it('calculates dashboard totals for the active period', () => {
    const dataset = datasetFixture()

    expect(calculateDashboardTotals(dataset, 'period-2')).toMatchObject({
      contributionCents: 100_00,
      repaymentCents: 75_00,
      creditBalanceCents: 65_00,
      travelBalanceCents: 35_00,
      activeMembers: 1,
      draftPeriods: 1,
      closedPeriods: 1,
    })
  })

  it('treats monthly saving and mutual insurance as required flows', () => {
    const dataset = datasetFixture()

    expect(getEntryStatus(entries[0], dataset.cycle.defaults, 'closed')).toBe('complete')
    expect(
      getEntryStatus(
        {
          ...entries[0],
          contributionCents: 0,
          savingCents: 20_00,
          mutualInsuranceCents: 5_00,
        },
        dataset.cycle.defaults,
        'closed',
      ),
    ).toBe('complete')
    expect(
      getEntryStatus({ ...entries[0], savingCents: 0 }, dataset.cycle.defaults, 'closed'),
    ).toBe('partial')
    expect(
      getEntryStatus(
        {
          ...entries[0],
          contributionCents: 0,
          savingCents: 0,
          mutualInsuranceCents: 0,
          loanCents: 0,
          repaymentCents: 0,
          travelCents: 0,
        },
        dataset.cycle.defaults,
        'draft',
      ),
    ).toBe('draft')
  })

  it('builds a member timeline with monthly saving, insurance and cumulative credit', () => {
    const timeline = getMemberTimeline(datasetFixture(), member.id)

    expect(timeline).toHaveLength(2)
    expect(timeline[0]).toMatchObject({
      savingCents: 20_00,
      mutualInsuranceCents: 5_00,
      creditBalanceCents: 140_00,
    })
    expect(timeline[1]).toMatchObject({
      savingCents: 20_00,
      mutualInsuranceCents: 5_00,
      creditBalanceCents: 65_00,
    })
  })

  it('builds period detail rows with totals equal to entries', () => {
    const detail = getPeriodDetail(datasetFixture(), 'period-1')

    expect(detail?.rows).toHaveLength(1)
    expect(detail?.rows[0]).toMatchObject({
      contributionStatus: 'complete',
      savingCents: 20_00,
      mutualInsuranceCents: 5_00,
      creditBalanceCents: 140_00,
    })
  })

  it('builds contribution matrix totals for contribution, monthly saving and insurance', () => {
    const matrix = getContributionMatrix(datasetFixture())

    expect(matrix[0]).toMatchObject({
      contributionTotalCents: 200_00,
      savingTotalCents: 40_00,
      mutualInsuranceTotalCents: 10_00,
    })
  })

  it('tracks monthly saving and mutual insurance as collective funds', () => {
    const rows = getCollectiveFundRows(datasetFixture())
    const summary = getCollectiveFundSummary(datasetFixture())

    expect(rows[0]).toMatchObject({
      expectedSavingCents: 20_00,
      paidSavingCents: 20_00,
      savingGapCents: 0,
      expectedMutualInsuranceCents: 5_00,
      paidMutualInsuranceCents: 5_00,
      mutualInsuranceGapCents: 0,
      status: 'complete',
      priority: 0,
    })
    expect(summary).toMatchObject({
      expectedSavingCents: 20_00,
      paidSavingCents: 20_00,
      expectedMutualInsuranceCents: 5_00,
      paidMutualInsuranceCents: 5_00,
      periodsWithAttention: 0,
      draftPeriods: 1,
    })
  })

  it('prioritizes closed collective fund gaps for triage', () => {
    const dataset = datasetFixture({
      monthlyEntries: [{ ...entries[0], savingCents: 0 }],
    })

    expect(getCollectiveFundRows(dataset)[0]).toMatchObject({
      savingStatus: 'missing',
      mutualInsuranceStatus: 'complete',
      status: 'missing',
      priority: 3,
    })
  })

  it('deduces and predicts tontine rotation beneficiaries', () => {
    const secondMember: Member = {
      id: 'member-2',
      name: 'DEUXIEME MEMBRE',
      successionOrder: 2,
      status: 'active',
    }
    const dataset = datasetFixture({
      members: [member, secondMember],
      monthlyEntries: [
        { ...entries[0], contributionCents: 0 },
        {
          ...entries[0],
          id: 'entry-member-2-period-1',
          memberId: secondMember.id,
          contributionCents: 100_00,
        },
      ],
    })

    const rotation = getTontineRotation(dataset)

    expect(rotation).toHaveLength(2)
    expect(rotation[0]).toMatchObject({
      member,
      isPredicted: false,
      cagnotteAmountCents: 100_00,
    })
    expect(rotation[1]).toMatchObject({
      member: secondMember,
      isPredicted: true,
    })
  })
})
