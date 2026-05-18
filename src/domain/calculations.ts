import type {
  IkiminaDataset,
  Member,
  MemberLedger,
  MonthlyEntry,
  OpeningBalance,
  Period,
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
