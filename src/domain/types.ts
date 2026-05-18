export type MemberStatus = 'active' | 'inactive'

export type PeriodStatus = 'draft' | 'closed'

export type AppRole = 'admin' | 'participant'

export type ContributionStatus = 'complete' | 'partial' | 'missing' | 'draft'

export type ProofCandidateStatus = 'ready' | 'needs_review' | 'unsupported'

export type ProofCandidatePurpose =
  | 'cotisation'
  | 'epargne'
  | 'assurance'
  | 'cotisation_epargne_assurance'
  | 'unknown'

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

export interface MemberTimelineRow {
  period: Period
  entry?: MonthlyEntry
  contributionStatus: ContributionStatus
  contributionCents: MoneyCents
  savingCents: MoneyCents
  mutualInsuranceCents: MoneyCents
  loanCents: MoneyCents
  repaymentCents: MoneyCents
  travelCents: MoneyCents
  creditBalanceCents: MoneyCents
  travelBalanceCents: MoneyCents
}

export interface PeriodMemberDetail {
  member: Member
  entry?: MonthlyEntry
  contributionStatus: ContributionStatus
  contributionCents: MoneyCents
  savingCents: MoneyCents
  mutualInsuranceCents: MoneyCents
  loanCents: MoneyCents
  repaymentCents: MoneyCents
  travelCents: MoneyCents
  creditBalanceCents: MoneyCents
  travelBalanceCents: MoneyCents
}

export interface PeriodDetail {
  period: Period
  rows: PeriodMemberDetail[]
}

export interface ContributionMatrixCell {
  period: Period
  entry?: MonthlyEntry
  status: ContributionStatus
  contributionCents: MoneyCents
  savingCents: MoneyCents
  mutualInsuranceCents: MoneyCents
}

export interface ContributionMatrixRow {
  member: Member
  cells: ContributionMatrixCell[]
  contributionTotalCents: MoneyCents
  savingTotalCents: MoneyCents
  mutualInsuranceTotalCents: MoneyCents
}

export interface CollectiveFundPeriodRow {
  period: Period
  activeMembers: number
  expectedSavingCents: MoneyCents
  paidSavingCents: MoneyCents
  savingGapCents: MoneyCents
  savingStatus: ContributionStatus
  expectedMutualInsuranceCents: MoneyCents
  paidMutualInsuranceCents: MoneyCents
  mutualInsuranceGapCents: MoneyCents
  mutualInsuranceStatus: ContributionStatus
  status: ContributionStatus
  priority: number
}

export interface CollectiveFundSummary {
  expectedSavingCents: MoneyCents
  paidSavingCents: MoneyCents
  savingGapCents: MoneyCents
  expectedMutualInsuranceCents: MoneyCents
  paidMutualInsuranceCents: MoneyCents
  mutualInsuranceGapCents: MoneyCents
  periodsWithAttention: number
  draftPeriods: number
}

export interface RotationEntry {
  period: Period
  member: Member
  status: 'past' | 'current' | 'future'
  isPredicted: boolean
  cagnotteAmountCents: MoneyCents
}

export interface ProofDocumentInput {
  fileName: string
  fileType?: string
  sizeBytes?: number
  text?: string
}

export interface ProofCandidate {
  id: string
  fileName: string
  fileType: string
  sizeBytes: number
  member?: Member
  period?: Period
  amountCents?: MoneyCents
  purpose: ProofCandidatePurpose
  confidence: number
  status: ProofCandidateStatus
  reasons: string[]
}

export interface ProofTriageSummary {
  total: number
  ready: number
  needsReview: number
  unsupported: number
}
