export type MemberStatus = 'active' | 'inactive'

export type PeriodStatus = 'draft' | 'closed'

export type AppRole = 'admin' | 'participant'

export type MoneyCents = number

export interface CycleDefaults {
  contributionCents: MoneyCents
  savingCents: MoneyCents
  mutualInsuranceCents: MoneyCents
}

export interface Cycle {
  id: string
  name: string
  currency: 'EUR'
  startMonth: string
  endMonth: string
  defaults: CycleDefaults
}

export interface Member {
  id: string
  name: string
  successionOrder: number
  status: MemberStatus
}

export interface Period {
  id: string
  cycleId: string
  label: string
  month: string
  status: PeriodStatus
  closedAt?: string
}

export interface OpeningBalance {
  memberId: string
  creditCents: MoneyCents
  travelSavingCents: MoneyCents
}

export interface MonthlyEntry {
  id: string
  periodId: string
  memberId: string
  contributionCents: MoneyCents
  savingCents: MoneyCents
  mutualInsuranceCents: MoneyCents
  loanCents: MoneyCents
  repaymentCents: MoneyCents
  travelCents: MoneyCents
  notes?: string
  updatedAt?: string
}

export interface AuditEvent {
  id: string
  actor: string
  action: string
  entityType: string
  entityId: string
  before?: unknown
  after?: unknown
  createdAt: string
}

export interface ExportRecord {
  id: string
  periodId: string
  kind: 'pdf' | 'xlsx'
  fileName: string
  createdAt: string
}

export interface ImportWarning {
  sheet: string
  cell?: string
  message: string
}

export interface ImportReport {
  sourceWorkbook: string
  generatedAt: string
  ignoredFormulaErrors: number
  warnings: ImportWarning[]
  periodTotals: Array<{
    periodId: string
    label: string
    contributionCents: MoneyCents
    savingCents: MoneyCents
    mutualInsuranceCents: MoneyCents
    loanCents: MoneyCents
    repaymentCents: MoneyCents
    travelCents: MoneyCents
  }>
}

export interface IkiminaDataset {
  cycle: Cycle
  members: Member[]
  periods: Period[]
  openingBalances: OpeningBalance[]
  monthlyEntries: MonthlyEntry[]
  auditEvents: AuditEvent[]
  exports: ExportRecord[]
  importReport: ImportReport
}

export interface MemberLedger {
  member: Member
  openingCreditCents: MoneyCents
  openingTravelSavingCents: MoneyCents
  loanCents: MoneyCents
  repaymentCents: MoneyCents
  creditBalanceCents: MoneyCents
  travelMovementCents: MoneyCents
  travelBalanceCents: MoneyCents
  contributionCents: MoneyCents
  savingCents: MoneyCents
  mutualInsuranceCents: MoneyCents
}
