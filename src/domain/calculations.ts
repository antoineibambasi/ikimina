import type {
  CollectiveFundPeriodRow,
  CollectiveFundSummary,
  ContributionMatrixRow,
  ContributionStatus,
  IkiminaDataset,
  Member,
  MemberLedger,
  MemberTimelineRow,
  MonthlyEntry,
  OpeningBalance,
  Period,
  PeriodDetail,
  PeriodMemberDetail,
} from './types'
import { sumCents } from './money'

export interface PeriodTotals {
  contributionCents: number
  savingCents: number
  mutualInsuranceCents: number
  loanCents: number
  repaymentCents: number
  travelCents: number
}

export interface DashboardTotals extends PeriodTotals {
  creditBalanceCents: number
  travelBalanceCents: number
  activeMembers: number
  draftPeriods: number
  closedPeriods: number
}

export function getPeriodEntries(
  entries: MonthlyEntry[],
  periodId: string,
): MonthlyEntry[] {
  return entries.filter((entry) => entry.periodId === periodId)
}

export function getMonthlyEntry(
  entries: MonthlyEntry[],
  periodId: string,
  memberId: string,
): MonthlyEntry | undefined {
  return entries.find((entry) => entry.periodId === periodId && entry.memberId === memberId)
}

export function calculatePeriodTotals(entries: MonthlyEntry[]): PeriodTotals {
  return {
    contributionCents: sumCents(entries.map((entry) => entry.contributionCents)),
    savingCents: sumCents(entries.map((entry) => entry.savingCents)),
    mutualInsuranceCents: sumCents(entries.map((entry) => entry.mutualInsuranceCents)),
    loanCents: sumCents(entries.map((entry) => entry.loanCents)),
    repaymentCents: sumCents(entries.map((entry) => entry.repaymentCents)),
    travelCents: sumCents(entries.map((entry) => entry.travelCents)),
  }
}

export function sortMembers(members: Member[]): Member[] {
  return [...members].sort((first, second) => {
    if (first.successionOrder !== second.successionOrder) {
      return first.successionOrder - second.successionOrder
    }

    return first.name.localeCompare(second.name, 'fr')
  })
}

export function sortPeriods(periods: Period[]): Period[] {
  return [...periods].sort((first, second) => first.month.localeCompare(second.month))
}

export function getCurrentPeriod(periods: Period[], today = new Date()): Period {
  const sorted = sortPeriods(periods)
  const currentMonth = today.toISOString().slice(0, 7)
  return (
    sorted.find((period) => period.month.slice(0, 7) === currentMonth) ??
    sorted.find((period) => period.status === 'draft') ??
    sorted[sorted.length - 1]
  )
}

export function calculateMemberLedger(
  member: Member,
  openingBalances: OpeningBalance[],
  entries: MonthlyEntry[],
  periods: Period[],
  throughPeriodId?: string,
): MemberLedger {
  const sortedPeriods = sortPeriods(periods)
  const throughPeriod = throughPeriodId
    ? sortedPeriods.find((period) => period.id === throughPeriodId)
    : sortedPeriods[sortedPeriods.length - 1]
  const allowedPeriodIds = new Set(
    sortedPeriods
      .filter((period) => !throughPeriod || period.month <= throughPeriod.month)
      .map((period) => period.id),
  )
  const memberEntries = entries.filter(
    (entry) => entry.memberId === member.id && allowedPeriodIds.has(entry.periodId),
  )
  const opening = openingBalances.find((balance) => balance.memberId === member.id)
  const totals = calculatePeriodTotals(memberEntries)

  return {
    member,
    openingCreditCents: opening?.creditCents ?? 0,
    openingTravelSavingCents: opening?.travelSavingCents ?? 0,
    loanCents: totals.loanCents,
    repaymentCents: totals.repaymentCents,
    creditBalanceCents: (opening?.creditCents ?? 0) + totals.loanCents - totals.repaymentCents,
    travelMovementCents: totals.travelCents,
    travelBalanceCents: (opening?.travelSavingCents ?? 0) + totals.travelCents,
    contributionCents: totals.contributionCents,
    savingCents: totals.savingCents,
    mutualInsuranceCents: totals.mutualInsuranceCents,
  }
}

export function calculateAllLedgers(
  dataset: IkiminaDataset,
  throughPeriodId?: string,
): MemberLedger[] {
  return sortMembers(dataset.members).map((member) =>
    calculateMemberLedger(
      member,
      dataset.openingBalances,
      dataset.monthlyEntries,
      dataset.periods,
      throughPeriodId,
    ),
  )
}

export function calculateDashboardTotals(
  dataset: IkiminaDataset,
  periodId: string,
): DashboardTotals {
  const periodEntries = getPeriodEntries(dataset.monthlyEntries, periodId)
  const periodTotals = calculatePeriodTotals(periodEntries)
  const ledgers = calculateAllLedgers(dataset, periodId)

  return {
    ...periodTotals,
    creditBalanceCents: sumCents(ledgers.map((ledger) => ledger.creditBalanceCents)),
    travelBalanceCents: sumCents(ledgers.map((ledger) => ledger.travelBalanceCents)),
    activeMembers: dataset.members.filter((member) => member.status === 'active').length,
    draftPeriods: dataset.periods.filter((period) => period.status === 'draft').length,
    closedPeriods: dataset.periods.filter((period) => period.status === 'closed').length,
  }
}

function hasAnyAmount(entry?: MonthlyEntry): boolean {
  if (!entry) {
    return false
  }

  return (
    entry.contributionCents !== 0 ||
    entry.savingCents !== 0 ||
    entry.mutualInsuranceCents !== 0 ||
    entry.loanCents !== 0 ||
    entry.repaymentCents !== 0 ||
    entry.travelCents !== 0
  )
}

export function getEntryStatus(
  entry: MonthlyEntry | undefined,
  defaults: IkiminaDataset['cycle']['defaults'],
  periodStatus: Period['status'] = 'closed',
): ContributionStatus {
  if (!entry || !hasAnyAmount(entry)) {
    return periodStatus === 'draft' ? 'draft' : 'missing'
  }

  const monthlySavingPaid = entry.savingCents === defaults.savingCents
  const mutualInsurancePaid = entry.mutualInsuranceCents === defaults.mutualInsuranceCents
  const contributionNormalOrExempt =
    entry.contributionCents === defaults.contributionCents || entry.contributionCents === 0

  return monthlySavingPaid && mutualInsurancePaid && contributionNormalOrExempt
    ? 'complete'
    : 'partial'
}

export function getMemberTimeline(
  dataset: IkiminaDataset,
  memberId: string,
): MemberTimelineRow[] {
  const member = dataset.members.find((item) => item.id === memberId)
  if (!member) {
    return []
  }

  const opening = dataset.openingBalances.find((balance) => balance.memberId === memberId)
  let creditBalanceCents = opening?.creditCents ?? 0
  let travelBalanceCents = opening?.travelSavingCents ?? 0

  return sortPeriods(dataset.periods).map((period) => {
    const entry = getMonthlyEntry(dataset.monthlyEntries, period.id, memberId)
    const contributionCents = entry?.contributionCents ?? 0
    const savingCents = entry?.savingCents ?? 0
    const mutualInsuranceCents = entry?.mutualInsuranceCents ?? 0
    const loanCents = entry?.loanCents ?? 0
    const repaymentCents = entry?.repaymentCents ?? 0
    const travelCents = entry?.travelCents ?? 0

    creditBalanceCents += loanCents - repaymentCents
    travelBalanceCents += travelCents

    return {
      period,
      entry,
      contributionStatus: getEntryStatus(entry, dataset.cycle.defaults, period.status),
      contributionCents,
      savingCents,
      mutualInsuranceCents,
      loanCents,
      repaymentCents,
      travelCents,
      creditBalanceCents,
      travelBalanceCents,
    }
  })
}

export function getPeriodDetail(
  dataset: IkiminaDataset,
  periodId: string,
): PeriodDetail | undefined {
  const period = dataset.periods.find((item) => item.id === periodId)
  if (!period) {
    return undefined
  }

  const rows: PeriodMemberDetail[] = sortMembers(dataset.members).map((member) => {
    const entry = getMonthlyEntry(dataset.monthlyEntries, period.id, member.id)
    const ledger = calculateMemberLedger(
      member,
      dataset.openingBalances,
      dataset.monthlyEntries,
      dataset.periods,
      period.id,
    )

    return {
      member,
      entry,
      contributionStatus: getEntryStatus(entry, dataset.cycle.defaults, period.status),
      contributionCents: entry?.contributionCents ?? 0,
      savingCents: entry?.savingCents ?? 0,
      mutualInsuranceCents: entry?.mutualInsuranceCents ?? 0,
      loanCents: entry?.loanCents ?? 0,
      repaymentCents: entry?.repaymentCents ?? 0,
      travelCents: entry?.travelCents ?? 0,
      creditBalanceCents: ledger.creditBalanceCents,
      travelBalanceCents: ledger.travelBalanceCents,
    }
  })

  return { period, rows }
}

export function getContributionMatrix(dataset: IkiminaDataset): ContributionMatrixRow[] {
  const periods = sortPeriods(dataset.periods)

  return sortMembers(dataset.members).map((member) => {
    const cells = periods.map((period) => {
      const entry = getMonthlyEntry(dataset.monthlyEntries, period.id, member.id)

      return {
        period,
        entry,
        status: getEntryStatus(entry, dataset.cycle.defaults, period.status),
        contributionCents: entry?.contributionCents ?? 0,
        savingCents: entry?.savingCents ?? 0,
        mutualInsuranceCents: entry?.mutualInsuranceCents ?? 0,
      }
    })

    return {
      member,
      cells,
      contributionTotalCents: sumCents(cells.map((cell) => cell.contributionCents)),
      savingTotalCents: sumCents(cells.map((cell) => cell.savingCents)),
      mutualInsuranceTotalCents: sumCents(cells.map((cell) => cell.mutualInsuranceCents)),
    }
  })
}

function getCollectiveFundStatus(
  paidCents: number,
  expectedCents: number,
  periodStatus: Period['status'],
): ContributionStatus {
  if (periodStatus === 'draft' && paidCents === 0) {
    return 'draft'
  }

  if (paidCents === expectedCents) {
    return 'complete'
  }

  if (paidCents === 0) {
    return periodStatus === 'draft' ? 'draft' : 'missing'
  }

  return 'partial'
}

function combineCollectiveStatus(
  savingStatus: ContributionStatus,
  mutualInsuranceStatus: ContributionStatus,
): ContributionStatus {
  if (savingStatus === 'missing' || mutualInsuranceStatus === 'missing') {
    return 'missing'
  }

  if (savingStatus === 'partial' || mutualInsuranceStatus === 'partial') {
    return 'partial'
  }

  if (savingStatus === 'draft' || mutualInsuranceStatus === 'draft') {
    return 'draft'
  }

  return 'complete'
}

function getCollectivePriority(status: ContributionStatus, periodStatus: Period['status']): number {
  if (periodStatus === 'closed' && status === 'missing') {
    return 3
  }

  if (periodStatus === 'closed' && status === 'partial') {
    return 2
  }

  if (periodStatus === 'draft' && status === 'partial') {
    return 1
  }

  return 0
}

export function getCollectiveFundRows(dataset: IkiminaDataset): CollectiveFundPeriodRow[] {
  const activeMembers = dataset.members.filter((member) => member.status === 'active').length

  return sortPeriods(dataset.periods).map((period) => {
    const totals = calculatePeriodTotals(getPeriodEntries(dataset.monthlyEntries, period.id))
    const expectedSavingCents = activeMembers * dataset.cycle.defaults.savingCents
    const expectedMutualInsuranceCents =
      activeMembers * dataset.cycle.defaults.mutualInsuranceCents
    const savingStatus = getCollectiveFundStatus(
      totals.savingCents,
      expectedSavingCents,
      period.status,
    )
    const mutualInsuranceStatus = getCollectiveFundStatus(
      totals.mutualInsuranceCents,
      expectedMutualInsuranceCents,
      period.status,
    )
    const status = combineCollectiveStatus(savingStatus, mutualInsuranceStatus)

    return {
      period,
      activeMembers,
      expectedSavingCents,
      paidSavingCents: totals.savingCents,
      savingGapCents: expectedSavingCents - totals.savingCents,
      savingStatus,
      expectedMutualInsuranceCents,
      paidMutualInsuranceCents: totals.mutualInsuranceCents,
      mutualInsuranceGapCents: expectedMutualInsuranceCents - totals.mutualInsuranceCents,
      mutualInsuranceStatus,
      status,
      priority: getCollectivePriority(status, period.status),
    }
  })
}

export function getCollectiveFundSummary(dataset: IkiminaDataset): CollectiveFundSummary {
  const rows = getCollectiveFundRows(dataset)
  const closedRows = rows.filter((row) => row.period.status === 'closed')

  return {
    expectedSavingCents: sumCents(closedRows.map((row) => row.expectedSavingCents)),
    paidSavingCents: sumCents(closedRows.map((row) => row.paidSavingCents)),
    savingGapCents: sumCents(closedRows.map((row) => row.savingGapCents)),
    expectedMutualInsuranceCents: sumCents(
      closedRows.map((row) => row.expectedMutualInsuranceCents),
    ),
    paidMutualInsuranceCents: sumCents(closedRows.map((row) => row.paidMutualInsuranceCents)),
    mutualInsuranceGapCents: sumCents(closedRows.map((row) => row.mutualInsuranceGapCents)),
    periodsWithAttention: closedRows.filter((row) => row.priority > 0).length,
    draftPeriods: rows.filter((row) => row.period.status === 'draft').length,
  }
}

export function upsertMonthlyEntry(
  entries: MonthlyEntry[],
  nextEntry: MonthlyEntry,
): MonthlyEntry[] {
  const found = entries.some((entry) => entry.id === nextEntry.id)
  if (!found) {
    return [...entries, nextEntry]
  }

  return entries.map((entry) => (entry.id === nextEntry.id ? nextEntry : entry))
}
