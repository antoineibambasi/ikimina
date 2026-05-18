import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Database,
  Download,
  FileSpreadsheet,
  FileQuestion,
  Gauge,
  Landmark,
  Layers,
  Lock,
  PiggyBank,
  RefreshCcw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Upload,
  UserRound,
  Users,
} from 'lucide-react'
import './App.css'
import importedDataset from './data/ikimina-import.json'
import {
  calculateAllLedgers,
  calculateDashboardTotals,
  calculatePeriodTotals,
  getCollectiveFundRows,
  getCollectiveFundSummary,
  getContributionMatrix,
  getCurrentPeriod,
  getMemberTimeline,
  getPeriodDetail,
  getPeriodEntries,
  getTontineRotation,
  sortMembers,
  sortPeriods,
  upsertMonthlyEntry,
} from './domain/calculations'
import { formatInputMoney, formatMoney, parseMoneyInput } from './domain/money'
import { buildProofCandidate, summarizeProofCandidates } from './domain/proofLoader'
import type {
  AuditEvent,
  CollectiveFundPeriodRow,
  ContributionStatus,
  IkiminaDataset,
  Member,
  MonthlyEntry,
  Period,
  ProofCandidate,
} from './domain/types'
import { isSupabaseConfigured, supabase } from './lib/supabase'

type ViewKey =
  | 'dashboard'
  | 'encoding'
  | 'members'
  | 'credits'
  | 'travel'
  | 'collective'
  | 'reports'
  | 'exploration'
  | 'rotation'
  | 'imports'
  | 'settings'

type AppRoute =
  | { kind: 'view'; view: ViewKey }
  | { kind: 'member'; memberId: string }
  | { kind: 'period'; periodId: string }
  | { kind: 'contributions' }

const viewItems: Array<{
  key: ViewKey
  label: string
  icon: typeof Gauge
}> = [
  { key: 'dashboard', label: 'Tableau de bord', icon: Gauge },
  { key: 'encoding', label: 'Encodage mensuel', icon: ClipboardList },
  { key: 'members', label: 'Membres', icon: Users },
  { key: 'credits', label: 'Credits', icon: Landmark },
  { key: 'travel', label: 'Epargne voyage', icon: PiggyBank },
  { key: 'collective', label: 'Fonds collectifs', icon: Layers },
  { key: 'reports', label: 'Rapports', icon: BarChart3 },
  { key: 'exploration', label: 'Exploration', icon: Search },
  { key: 'rotation', label: 'Rotation tontine', icon: RefreshCcw },
  { key: 'imports', label: 'Import & preuves', icon: Upload },
  { key: 'settings', label: 'Parametres', icon: Settings },
]

const moneyFields: Array<{
  key: keyof Pick<
    MonthlyEntry,
    | 'contributionCents'
    | 'savingCents'
    | 'mutualInsuranceCents'
    | 'loanCents'
    | 'repaymentCents'
    | 'travelCents'
  >
  label: string
}> = [
  { key: 'contributionCents', label: 'Cotisation' },
  { key: 'savingCents', label: 'Epargne' },
  { key: 'mutualInsuranceCents', label: 'Ass. mutuelle' },
  { key: 'loanCents', label: 'Pret' },
  { key: 'repaymentCents', label: 'Remboursement' },
  { key: 'travelCents', label: 'Voyage' },
]

const contributionStatusLabels: Record<ContributionStatus, string> = {
  complete: 'Complet',
  partial: 'Partiel',
  missing: 'Absent',
  draft: 'Brouillon',
}

function cloneInitialDataset(): IkiminaDataset {
  return structuredClone(importedDataset) as IkiminaDataset
}

function statusLabel(status: Period['status']) {
  return status === 'closed' ? 'Cloture' : 'Brouillon'
}

function parseHashRoute(hash = window.location.hash): AppRoute {
  const clean = hash.replace(/^#\/?/, '')
  const [kind, id] = clean.split('/')

  if (kind === 'membre' && id) {
    return { kind: 'member', memberId: id }
  }

  if (kind === 'mois' && id) {
    return { kind: 'period', periodId: id }
  }

  if (kind === 'cotisations') {
    return { kind: 'contributions' }
  }

  if (viewItems.some((item) => item.key === kind)) {
    return { kind: 'view', view: kind as ViewKey }
  }

  return { kind: 'view', view: 'dashboard' }
}

function viewHash(view: ViewKey) {
  return `#/${view}`
}

function memberHash(memberId: string) {
  return `#/membre/${memberId}`
}

function periodHash(periodId: string) {
  return `#/mois/${periodId}`
}

function routeTitle(route: AppRoute, dataset: IkiminaDataset): string {
  if (route.kind === 'member') {
    return dataset.members.find((member) => member.id === route.memberId)?.name ?? 'Membre 360'
  }

  if (route.kind === 'period') {
    return dataset.periods.find((period) => period.id === route.periodId)?.label ?? 'Mois 360'
  }

  if (route.kind === 'contributions') {
    return 'Cotisations'
  }

  return viewItems.find((item) => item.key === route.view)?.label ?? 'IKIMINA'
}

function activeNavKey(route: AppRoute): ViewKey {
  if (route.kind === 'view') {
    return route.view
  }

  return 'exploration'
}

function createAudit(action: string, entityType: string, entityId: string, after?: unknown): AuditEvent {
  return {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    actor: 'admin-local',
    action,
    entityType,
    entityId,
    after,
    createdAt: new Date().toISOString(),
  }
}

function periodEntry(dataset: IkiminaDataset, periodId: string, memberId: string): MonthlyEntry {
  const existing = dataset.monthlyEntries.find(
    (entry) => entry.periodId === periodId && entry.memberId === memberId,
  )
  if (existing) {
    return existing
  }

  return {
    id: `entry-${periodId}-${memberId}`,
    periodId,
    memberId,
    contributionCents: dataset.cycle.defaults.contributionCents,
    savingCents: dataset.cycle.defaults.savingCents,
    mutualInsuranceCents: dataset.cycle.defaults.mutualInsuranceCents,
    loanCents: 0,
    repaymentCents: 0,
    travelCents: 0,
    notes: '',
  }
}

function StatTile({
  label,
  value,
  tone = 'neutral',
  href,
}: {
  label: string
  value: string
  tone?: 'neutral' | 'green' | 'amber' | 'red'
  href?: string
}) {
  const content = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
    </>
  )

  if (href) {
    return (
      <a className={`stat-tile clickable tone-${tone}`} href={href}>
        {content}
      </a>
    )
  }

  return <div className={`stat-tile tone-${tone}`}>{content}</div>
}

function PeriodSelector({
  periods,
  selectedPeriodId,
  onChange,
}: {
  periods: Period[]
  selectedPeriodId: string
  onChange: (periodId: string) => void
}) {
  return (
    <label className="field compact-field">
      <span>Mois</span>
      <select value={selectedPeriodId} onChange={(event) => onChange(event.target.value)}>
        {sortPeriods(periods).map((period) => (
          <option key={period.id} value={period.id}>
            {period.label} - {statusLabel(period.status)}
          </option>
        ))}
      </select>
    </label>
  )
}

function MemberLink({ member }: { member: Member }) {
  return (
    <a className="text-link" href={memberHash(member.id)}>
      {member.name}
    </a>
  )
}

function PeriodLink({ period }: { period: Period }) {
  return (
    <a className="text-link" href={periodHash(period.id)}>
      {period.label}
    </a>
  )
}

function ContributionStatusBadge({ status }: { status: ContributionStatus }) {
  return <span className={`contribution-status ${status}`}>{contributionStatusLabels[status]}</span>
}

function LoginScreen() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)

  async function sendMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !email.trim()) {
      return
    }

    setIsSending(true)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: window.location.origin,
      },
    })
    setIsSending(false)
    setMessage(
      error
        ? error.message
        : 'Lien envoye. Ouvre ton email pour te connecter a IKIMINA.',
    )
  }

  return (
    <main className="login-screen">
      <section className="login-panel">
        <div className="brand login-brand">
          <div className="brand-mark">IK</div>
          <div>
            <strong>IKIMINA</strong>
            <span>Acces prive</span>
          </div>
        </div>
        <h1>Connexion par lien email</h1>
        <p>
          Entre ton email autorise. Supabase enverra un lien magique pour ouvrir
          l'application.
        </p>
        <form onSubmit={sendMagicLink} className="login-form">
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="nom@example.com"
              required
            />
          </label>
          <button type="submit" disabled={isSending}>
            <ShieldCheck size={16} />
            {isSending ? 'Envoi...' : 'Recevoir le lien'}
          </button>
        </form>
        {message && <div className="notice-bar success">{message}</div>}
      </section>
    </main>
  )
}

function App() {
  const [dataset, setDataset] = useState<IkiminaDataset>(() => cloneInitialDataset())
  const [route, setRoute] = useState<AppRoute>(() => parseHashRoute())
  const [selectedPeriodId, setSelectedPeriodId] = useState(
    () => getCurrentPeriod(cloneInitialDataset().periods).id,
  )
  const [notice, setNotice] = useState<string | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [isAuthLoading, setIsAuthLoading] = useState(isSupabaseConfigured)

  useEffect(() => {
    function syncRoute() {
      const nextRoute = parseHashRoute()
      setRoute(nextRoute)
      if (nextRoute.kind === 'period') {
        setSelectedPeriodId(nextRoute.periodId)
      }
    }

    window.addEventListener('hashchange', syncRoute)
    syncRoute()
    return () => window.removeEventListener('hashchange', syncRoute)
  }, [])

  useEffect(() => {
    if (!supabase) {
      return
    }

    let isMounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (isMounted) {
        setSession(data.session)
        setIsAuthLoading(false)
      }
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setIsAuthLoading(false)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  const selectedPeriod =
    dataset.periods.find((period) => period.id === selectedPeriodId) ?? dataset.periods[0]
  const selectedEntries = useMemo(
    () => getPeriodEntries(dataset.monthlyEntries, selectedPeriod.id),
    [dataset.monthlyEntries, selectedPeriod.id],
  )
  const selectedTotals = useMemo(() => calculatePeriodTotals(selectedEntries), [selectedEntries])
  const dashboardTotals = useMemo(
    () => calculateDashboardTotals(dataset, selectedPeriod.id),
    [dataset, selectedPeriod.id],
  )
  const ledgers = useMemo(
    () => calculateAllLedgers(dataset, selectedPeriod.id),
    [dataset, selectedPeriod.id],
  )
  const sortedMembers = useMemo(() => sortMembers(dataset.members), [dataset.members])
  const sortedPeriods = useMemo(() => sortPeriods(dataset.periods), [dataset.periods])
  const navKey = activeNavKey(route)

  function updateEntry(entry: MonthlyEntry) {
    if (selectedPeriod.status === 'closed') {
      setNotice('Ce mois est cloture. Ajoutez un ajustement trace pour corriger.')
      return
    }

    setDataset((current) => ({
      ...current,
      monthlyEntries: upsertMonthlyEntry(current.monthlyEntries, {
        ...entry,
        updatedAt: new Date().toISOString(),
      }),
    }))
  }

  function updateEntryMoney(
    memberId: string,
    field: (typeof moneyFields)[number]['key'],
    rawValue: string,
  ) {
    const currentEntry = periodEntry(dataset, selectedPeriod.id, memberId)
    updateEntry({
      ...currentEntry,
      [field]: parseMoneyInput(rawValue),
    })
  }

  function closeSelectedPeriod() {
    if (selectedPeriod.status === 'closed') {
      return
    }

    const closedAt = new Date().toISOString()
    setDataset((current) => ({
      ...current,
      periods: current.periods.map((period) =>
        period.id === selectedPeriod.id ? { ...period, status: 'closed', closedAt } : period,
      ),
      auditEvents: [
        createAudit('close_period', 'period', selectedPeriod.id, { closedAt }),
        ...current.auditEvents,
      ],
    }))
    setNotice(`${selectedPeriod.label} est maintenant cloture.`)
  }

  function resetLocalData() {
    const next = cloneInitialDataset()
    setDataset(next)
    setSelectedPeriodId(getCurrentPeriod(next.periods).id)
    setNotice("Donnees locales rechargees depuis l'import Excel.")
  }

  function changeSelectedPeriod(periodId: string) {
    setSelectedPeriodId(periodId)
    if (route.kind === 'period') {
      window.location.hash = periodHash(periodId)
    }
  }

  async function downloadPdf() {
    const { exportPeriodToPdf } = await import('./lib/exporters')
    exportPeriodToPdf(dataset, selectedPeriod)
  }

  async function downloadXlsx() {
    const { exportPeriodToXlsx } = await import('./lib/exporters')
    await exportPeriodToXlsx(dataset, selectedPeriod)
  }

  if (isAuthLoading) {
    return (
      <main className="login-screen">
        <section className="login-panel">
          <p>Verification de la session...</p>
        </section>
      </main>
    )
  }

  if (isSupabaseConfigured && !session) {
    return <LoginScreen />
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">IK</div>
          <div>
            <strong>IKIMINA</strong>
            <span>Gestion de tontine</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Navigation principale">
          {viewItems.map((item) => {
            const Icon = item.icon
            return (
              <a
                key={item.key}
                className={navKey === item.key ? 'active' : ''}
                href={viewHash(item.key)}
              >
                <Icon size={18} />
                {item.label}
              </a>
            )
          })}
        </nav>

        <div className="side-status">
          <ShieldCheck size={18} />
          <span>{isSupabaseConfigured ? 'Supabase configure' : 'Mode local demo'}</span>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">{dataset.cycle.name}</p>
            <h1>{routeTitle(route, dataset)}</h1>
          </div>
          <div className="topbar-actions">
            {session && (
              <button onClick={() => supabase?.auth.signOut()}>
                <Lock size={16} />
                Deconnexion
              </button>
            )}
            <PeriodSelector
              periods={dataset.periods}
              selectedPeriodId={selectedPeriod.id}
              onChange={changeSelectedPeriod}
            />
            <span className={`status-pill ${selectedPeriod.status}`}>
              {selectedPeriod.status === 'closed' ? <Lock size={14} /> : <Save size={14} />}
              {statusLabel(selectedPeriod.status)}
            </span>
          </div>
        </header>

        {!isSupabaseConfigured && (
          <div className="notice-bar">
            <ShieldCheck size={18} />
            <span>
              Mode local: les donnees viennent de l'import Excel. Configure Supabase pour activer
              l'authentification par lien email et la persistence cloud.
            </span>
          </div>
        )}

        {notice && (
          <div className="notice-bar success">
            <CheckCircle2 size={18} />
            <span>{notice}</span>
            <button onClick={() => setNotice(null)}>Fermer</button>
          </div>
        )}

        {route.kind === 'view' && route.view === 'dashboard' && (
          <DashboardView
            selectedPeriod={selectedPeriod}
            selectedTotals={selectedTotals}
            dashboardTotals={dashboardTotals}
            onDownloadPdf={downloadPdf}
            onDownloadXlsx={downloadXlsx}
          />
        )}

        {route.kind === 'view' && route.view === 'encoding' && (
          <EncodingView
            dataset={dataset}
            selectedPeriod={selectedPeriod}
            selectedTotals={selectedTotals}
            sortedMembers={sortedMembers}
            onClose={closeSelectedPeriod}
            onReset={resetLocalData}
            onUpdateEntryMoney={updateEntryMoney}
          />
        )}

        {route.kind === 'view' && route.view === 'members' && (
          <MembersView selectedPeriod={selectedPeriod} ledgers={ledgers} />
        )}

        {route.kind === 'view' && route.view === 'credits' && <CreditsView ledgers={ledgers} />}

        {route.kind === 'view' && route.view === 'travel' && <TravelView ledgers={ledgers} />}

        {route.kind === 'view' && route.view === 'collective' && (
          <CollectiveFundsView dataset={dataset} />
        )}

        {route.kind === 'view' && route.view === 'reports' && (
          <ReportsView
            dataset={dataset}
            selectedPeriod={selectedPeriod}
            selectedTotals={selectedTotals}
            onDownloadPdf={downloadPdf}
            onDownloadXlsx={downloadXlsx}
          />
        )}

        {route.kind === 'view' && route.view === 'exploration' && (
          <ExplorationView dataset={dataset} ledgers={ledgers} periods={sortedPeriods} />
        )}

        {route.kind === 'view' && route.view === 'settings' && (
          <SettingsView dataset={dataset} dashboardTotals={dashboardTotals} />
        )}

        {route.kind === 'view' && route.view === 'rotation' && (
          <RotationView dataset={dataset} />
        )}

        {route.kind === 'view' && route.view === 'imports' && (
          <ProofImportView dataset={dataset} />
        )}

        {route.kind === 'member' && (
          <Member360View
            dataset={dataset}
            memberId={route.memberId}
            selectedPeriodId={selectedPeriod.id}
          />
        )}

        {route.kind === 'period' && (
          <Period360View dataset={dataset} periodId={route.periodId} />
        )}

        {route.kind === 'contributions' && <ContributionsView dataset={dataset} />}
      </main>
    </div>
  )
}

function DashboardView({
  selectedPeriod,
  selectedTotals,
  dashboardTotals,
  onDownloadPdf,
  onDownloadXlsx,
}: {
  selectedPeriod: Period
  selectedTotals: ReturnType<typeof calculatePeriodTotals>
  dashboardTotals: ReturnType<typeof calculateDashboardTotals>
  onDownloadPdf: () => void
  onDownloadXlsx: () => void
}) {
  return (
    <section className="view-stack">
      <div className="stats-grid">
        <StatTile
          label={`Cotisations ${selectedPeriod.label}`}
          value={formatMoney(dashboardTotals.contributionCents)}
          tone="green"
          href={periodHash(selectedPeriod.id)}
        />
        <StatTile
          label="Fonds epargne mensuelle"
          value={formatMoney(dashboardTotals.savingCents)}
          href="#/collective"
        />
        <StatTile
          label="Fonds assurance"
          value={formatMoney(dashboardTotals.mutualInsuranceCents)}
          href="#/collective"
        />
        <StatTile
          label="Encours credit total"
          value={formatMoney(dashboardTotals.creditBalanceCents)}
          tone="amber"
          href="#/credits"
        />
        <StatTile
          label="Rotation tontine"
          value="Calendrier"
          href="#/rotation"
        />
        <StatTile
          label="Import justificatifs"
          value="Triage"
          href="#/imports"
        />
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Situation du mois</h2>
            <p>Totaux importes ou saisis pour {selectedPeriod.label}.</p>
          </div>
          <div className="button-row">
            <a className="button-like" href={periodHash(selectedPeriod.id)}>
              <CalendarDays size={16} />
              Mois 360
            </a>
            <button onClick={onDownloadPdf}>
              <Download size={16} />
              PDF
            </button>
            <button onClick={onDownloadXlsx}>
              <FileSpreadsheet size={16} />
              Excel
            </button>
          </div>
        </div>
        <div className="compact-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Indicateur</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {moneyFields.map((field) => (
                <tr key={field.key}>
                  <td>{field.label}</td>
                  <td>{formatMoney(selectedTotals[field.key])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  )
}

function EncodingView({
  dataset,
  selectedPeriod,
  selectedTotals,
  sortedMembers,
  onClose,
  onReset,
  onUpdateEntryMoney,
}: {
  dataset: IkiminaDataset
  selectedPeriod: Period
  selectedTotals: ReturnType<typeof calculatePeriodTotals>
  sortedMembers: Member[]
  onClose: () => void
  onReset: () => void
  onUpdateEntryMoney: (
    memberId: string,
    field: (typeof moneyFields)[number]['key'],
    rawValue: string,
  ) => void
}) {
  return (
    <section className="panel wide-panel">
      <div className="panel-heading">
        <div>
          <h2>Grille mensuelle</h2>
          <p>Paiements individuels, pilotage collectif pour epargne mensuelle et assurance.</p>
        </div>
        <div className="button-row">
          <a className="button-like" href={periodHash(selectedPeriod.id)}>
            <CalendarDays size={16} />
            Detail mois
          </a>
          <button onClick={onClose} disabled={selectedPeriod.status === 'closed'}>
            <CheckCircle2 size={16} />
            Cloturer
          </button>
          <button onClick={onReset}>
            <RefreshCcw size={16} />
            Recharger import
          </button>
        </div>
      </div>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Ordre</th>
              <th>Nom</th>
              {moneyFields.map((field) => (
                <th key={field.key}>{field.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedMembers.map((member) => {
              const entry = periodEntry(dataset, selectedPeriod.id, member.id)
              return (
                <tr key={member.id}>
                  <td>{member.successionOrder}</td>
                  <td className="member-cell">
                    <MemberLink member={member} />
                  </td>
                  {moneyFields.map((field) => (
                    <td key={field.key}>
                      <input
                        aria-label={`${field.label} ${member.name}`}
                        disabled={selectedPeriod.status === 'closed'}
                        value={formatInputMoney(entry[field.key])}
                        onChange={(event) =>
                          onUpdateEntryMoney(member.id, field.key, event.target.value)
                        }
                      />
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td />
              <td>Total</td>
              {moneyFields.map((field) => (
                <td key={field.key}>{formatMoney(selectedTotals[field.key])}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}

function MembersView({
  selectedPeriod,
  ledgers,
}: {
  selectedPeriod: Period
  ledgers: ReturnType<typeof calculateAllLedgers>
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Participants</h2>
          <p>Chaque nom ouvre la fiche Membre 360 jusqu'a {selectedPeriod.label}.</p>
        </div>
      </div>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Ordre</th>
              <th>Nom</th>
              <th>Statut</th>
              <th>Cotisations</th>
              <th>Epargne payee</th>
              <th>Assurance payee</th>
              <th>Encours credit</th>
              <th>Epargne voyage</th>
            </tr>
          </thead>
          <tbody>
            {ledgers.map((ledger) => (
              <tr key={ledger.member.id}>
                <td>{ledger.member.successionOrder}</td>
                <td className="member-cell">
                  <MemberLink member={ledger.member} />
                </td>
                <td>{ledger.member.status === 'active' ? 'Actif' : 'Inactif'}</td>
                <td>{formatMoney(ledger.contributionCents)}</td>
                <td>{formatMoney(ledger.savingCents)}</td>
                <td>{formatMoney(ledger.mutualInsuranceCents)}</td>
                <td>{formatMoney(ledger.creditBalanceCents)}</td>
                <td>{formatMoney(ledger.travelBalanceCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function CreditsView({ ledgers }: { ledgers: ReturnType<typeof calculateAllLedgers> }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Credits</h2>
          <p>Encours initial + prets - remboursements.</p>
        </div>
      </div>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Ordre</th>
              <th>Nom</th>
              <th>Solde initial</th>
              <th>Prets</th>
              <th>Remboursements</th>
              <th>Encours</th>
            </tr>
          </thead>
          <tbody>
            {ledgers.map((ledger) => (
              <tr key={ledger.member.id}>
                <td>{ledger.member.successionOrder}</td>
                <td className="member-cell">
                  <MemberLink member={ledger.member} />
                </td>
                <td>{formatMoney(ledger.openingCreditCents)}</td>
                <td>{formatMoney(ledger.loanCents)}</td>
                <td>{formatMoney(ledger.repaymentCents)}</td>
                <td className={ledger.creditBalanceCents > 0 ? 'amount-alert' : ''}>
                  <a className="text-link" href={memberHash(ledger.member.id)}>
                    {formatMoney(ledger.creditBalanceCents)}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function TravelView({ ledgers }: { ledgers: ReturnType<typeof calculateAllLedgers> }) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Epargne voyage</h2>
          <p>Solde initial + mouvements voyage importes ou saisis.</p>
        </div>
      </div>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Ordre</th>
              <th>Nom</th>
              <th>Solde initial</th>
              <th>Mouvements</th>
              <th>Solde</th>
            </tr>
          </thead>
          <tbody>
            {ledgers.map((ledger) => (
              <tr key={ledger.member.id}>
                <td>{ledger.member.successionOrder}</td>
                <td className="member-cell">
                  <MemberLink member={ledger.member} />
                </td>
                <td>{formatMoney(ledger.openingTravelSavingCents)}</td>
                <td>{formatMoney(ledger.travelMovementCents)}</td>
                <td>
                  <a className="text-link" href={memberHash(ledger.member.id)}>
                    {formatMoney(ledger.travelBalanceCents)}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function priorityLabel(priority: number) {
  if (priority >= 3) {
    return 'Urgent'
  }

  if (priority === 2) {
    return 'A verifier'
  }

  if (priority === 1) {
    return 'Brouillon actif'
  }

  return 'OK'
}

function sortCollectiveRows(
  rows: CollectiveFundPeriodRow[],
  sortKey: 'priority' | 'month-desc' | 'saving-gap' | 'insurance-gap',
) {
  return [...rows].sort((first, second) => {
    if (sortKey === 'month-desc') {
      return second.period.month.localeCompare(first.period.month)
    }

    if (sortKey === 'saving-gap') {
      return Math.abs(second.savingGapCents) - Math.abs(first.savingGapCents)
    }

    if (sortKey === 'insurance-gap') {
      return Math.abs(second.mutualInsuranceGapCents) - Math.abs(first.mutualInsuranceGapCents)
    }

    return second.priority - first.priority || second.period.month.localeCompare(first.period.month)
  })
}

function CollectiveFundsView({ dataset }: { dataset: IkiminaDataset }) {
  const [triageFilter, setTriageFilter] = useState<'all' | 'attention' | 'closed' | 'draft'>(
    'all',
  )
  const [sortKey, setSortKey] = useState<'priority' | 'month-desc' | 'saving-gap' | 'insurance-gap'>(
    'priority',
  )
  const rows = useMemo(() => getCollectiveFundRows(dataset), [dataset])
  const summary = useMemo(() => getCollectiveFundSummary(dataset), [dataset])
  const visibleRows = useMemo(() => {
    const filtered = rows.filter((row) => {
      if (triageFilter === 'attention') {
        return row.priority > 0
      }

      if (triageFilter === 'closed') {
        return row.period.status === 'closed'
      }

      if (triageFilter === 'draft') {
        return row.period.status === 'draft'
      }

      return true
    })

    return sortCollectiveRows(filtered, sortKey)
  }, [rows, sortKey, triageFilter])

  return (
    <section className="view-stack">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Fonds collectifs</h2>
            <p>
              L'epargne mensuelle et l'assurance sont pilotees collectivement; chaque ligne membre
              sert de preuve de paiement.
            </p>
          </div>
          <div className="button-row">
            <a className="button-like" href="#/cotisations">
              <BarChart3 size={16} />
              Controle individuel
            </a>
          </div>
        </div>

        <div className="stats-grid wide-summary">
          <StatTile label="Epargne attendue cloturee" value={formatMoney(summary.expectedSavingCents)} />
          <StatTile
            label="Epargne encaissee"
            value={formatMoney(summary.paidSavingCents)}
            tone={summary.savingGapCents === 0 ? 'green' : 'red'}
          />
          <StatTile
            label="Assurance attendue cloturee"
            value={formatMoney(summary.expectedMutualInsuranceCents)}
          />
          <StatTile
            label="Assurance encaissee"
            value={formatMoney(summary.paidMutualInsuranceCents)}
            tone={summary.mutualInsuranceGapCents === 0 ? 'green' : 'red'}
          />
          <StatTile
            label="Mois a verifier"
            value={String(summary.periodsWithAttention)}
            tone={summary.periodsWithAttention === 0 ? 'green' : 'red'}
          />
          <StatTile label="Mois brouillons" value={String(summary.draftPeriods)} tone="amber" />
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Triage des mois</h2>
            <p>Vue de controle inspiree CRM: filtre, tri, statut et action vers Mois 360.</p>
          </div>
          <div className="filter-row">
            <label className="field">
              <span>Vue</span>
              <select
                value={triageFilter}
                onChange={(event) =>
                  setTriageFilter(event.target.value as 'all' | 'attention' | 'closed' | 'draft')
                }
              >
                <option value="all">Tous les mois</option>
                <option value="attention">A verifier</option>
                <option value="closed">Clotures</option>
                <option value="draft">Brouillons</option>
              </select>
            </label>
            <label className="field">
              <span>Tri</span>
              <select
                value={sortKey}
                onChange={(event) =>
                  setSortKey(
                    event.target.value as
                      | 'priority'
                      | 'month-desc'
                      | 'saving-gap'
                      | 'insurance-gap',
                  )
                }
              >
                <option value="priority">Priorite</option>
                <option value="month-desc">Mois recent</option>
                <option value="saving-gap">Ecart epargne</option>
                <option value="insurance-gap">Ecart assurance</option>
              </select>
            </label>
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Mois</th>
                <th>Statut</th>
                <th>Priorite</th>
                <th>Membres actifs</th>
                <th>Epargne attendue</th>
                <th>Epargne encaissee</th>
                <th>Ecart epargne</th>
                <th>Assurance attendue</th>
                <th>Assurance encaissee</th>
                <th>Ecart assurance</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr key={row.period.id}>
                  <td className="member-cell">
                    <PeriodLink period={row.period} />
                  </td>
                  <td>
                    <ContributionStatusBadge status={row.status} />
                  </td>
                  <td>
                    <span className={`priority-pill priority-${row.priority}`}>
                      {priorityLabel(row.priority)}
                    </span>
                  </td>
                  <td>{row.activeMembers}</td>
                  <td>{formatMoney(row.expectedSavingCents)}</td>
                  <td>{formatMoney(row.paidSavingCents)}</td>
                  <td className={row.savingGapCents !== 0 ? 'amount-alert' : ''}>
                    {formatMoney(row.savingGapCents)}
                  </td>
                  <td>{formatMoney(row.expectedMutualInsuranceCents)}</td>
                  <td>{formatMoney(row.paidMutualInsuranceCents)}</td>
                  <td className={row.mutualInsuranceGapCents !== 0 ? 'amount-alert' : ''}>
                    {formatMoney(row.mutualInsuranceGapCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  )
}

function ReportsView({
  dataset,
  selectedPeriod,
  selectedTotals,
  onDownloadPdf,
  onDownloadXlsx,
}: {
  dataset: IkiminaDataset
  selectedPeriod: Period
  selectedTotals: ReturnType<typeof calculatePeriodTotals>
  onDownloadPdf: () => void
  onDownloadXlsx: () => void
}) {
  return (
    <section className="view-stack">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Rapport vivant</h2>
            <p>Consultation dans l'app; export seulement si un document est necessaire.</p>
          </div>
          <div className="button-row">
            <a className="button-like" href={periodHash(selectedPeriod.id)}>
              <CalendarDays size={16} />
              Mois 360
            </a>
            <button onClick={onDownloadPdf}>
              <Download size={16} />
              PDF
            </button>
            <button onClick={onDownloadXlsx}>
              <FileSpreadsheet size={16} />
              Excel
            </button>
          </div>
        </div>
        <div className="report-summary wide-summary">
          <StatTile label="Cotisations" value={formatMoney(selectedTotals.contributionCents)} />
          <StatTile label="Fonds epargne" value={formatMoney(selectedTotals.savingCents)} />
          <StatTile label="Fonds assurance" value={formatMoney(selectedTotals.mutualInsuranceCents)} />
          <StatTile label="Prets" value={formatMoney(selectedTotals.loanCents)} tone="amber" />
          <StatTile
            label="Remboursements"
            value={formatMoney(selectedTotals.repaymentCents)}
            tone="green"
          />
          <StatTile label="Voyage" value={formatMoney(selectedTotals.travelCents)} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Audit</h2>
            <p>Evenements importes et actions locales.</p>
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Acteur</th>
                <th>Action</th>
                <th>Objet</th>
              </tr>
            </thead>
            <tbody>
              {dataset.auditEvents.slice(0, 12).map((event) => (
                <tr key={event.id}>
                  <td>{new Date(event.createdAt).toLocaleString('fr-BE')}</td>
                  <td>{event.actor}</td>
                  <td>{event.action}</td>
                  <td>
                    {event.entityType} / {event.entityId}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  )
}

function ExplorationView({
  dataset,
  ledgers,
  periods,
}: {
  dataset: IkiminaDataset
  ledgers: ReturnType<typeof calculateAllLedgers>
  periods: Period[]
}) {
  return (
    <section className="view-stack">
      <div className="exploration-grid">
        <a className="exploration-tile" href={memberHash(dataset.members[0].id)}>
          <UserRound size={20} />
          <strong>Membre 360</strong>
          <span>Historique complet par personne.</span>
        </a>
        <a className="exploration-tile" href={periodHash(periods[0].id)}>
          <CalendarDays size={20} />
          <strong>Mois 360</strong>
          <span>Tous les membres, statuts et totaux du mois.</span>
        </a>
        <a className="exploration-tile" href="#/cotisations">
          <BarChart3 size={20} />
          <strong>Cotisations</strong>
          <span>Controle individuel des paiements attendus.</span>
        </a>
        <a className="exploration-tile" href="#/collective">
          <Layers size={20} />
          <strong>Fonds collectifs</strong>
          <span>Pilotage collectif de l'epargne et de l'assurance.</span>
        </a>
        <a className="exploration-tile" href="#/rotation">
          <RefreshCcw size={20} />
          <strong>Rotation tontine</strong>
          <span>Calendrier des beneficiaires exemptes.</span>
        </a>
        <a className="exploration-tile" href="#/imports">
          <Upload size={20} />
          <strong>Import & preuves</strong>
          <span>Preparer le tri des extraits, factures et preuves de transfert.</span>
        </a>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Membres 360</h2>
            <p>Acces direct aux fiches individuelles.</p>
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Ordre</th>
                <th>Nom</th>
                <th>Cotisations</th>
                <th>Epargne payee</th>
                <th>Assurance payee</th>
                <th>Credit</th>
                <th>Voyage</th>
              </tr>
            </thead>
            <tbody>
              {ledgers.map((ledger) => (
                <tr key={ledger.member.id}>
                  <td>{ledger.member.successionOrder}</td>
                  <td className="member-cell">
                    <MemberLink member={ledger.member} />
                  </td>
                  <td>{formatMoney(ledger.contributionCents)}</td>
                  <td>{formatMoney(ledger.savingCents)}</td>
                  <td>{formatMoney(ledger.mutualInsuranceCents)}</td>
                  <td>{formatMoney(ledger.creditBalanceCents)}</td>
                  <td>{formatMoney(ledger.travelBalanceCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Mois vivants</h2>
            <p>Chaque mois remplace un document envoye separement.</p>
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Mois</th>
                <th>Statut</th>
                <th>Cotisations</th>
                <th>Fonds epargne</th>
                <th>Fonds assurance</th>
                <th>Prets</th>
                <th>Remboursements</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((period) => {
                const totals = calculatePeriodTotals(
                  getPeriodEntries(dataset.monthlyEntries, period.id),
                )
                return (
                  <tr key={period.id}>
                    <td className="member-cell">
                      <PeriodLink period={period} />
                    </td>
                    <td>{statusLabel(period.status)}</td>
                    <td>{formatMoney(totals.contributionCents)}</td>
                    <td>{formatMoney(totals.savingCents)}</td>
                    <td>{formatMoney(totals.mutualInsuranceCents)}</td>
                    <td>{formatMoney(totals.loanCents)}</td>
                    <td>{formatMoney(totals.repaymentCents)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  )
}

function Member360View({
  dataset,
  memberId,
  selectedPeriodId,
}: {
  dataset: IkiminaDataset
  memberId: string
  selectedPeriodId: string
}) {
  const member = dataset.members.find((item) => item.id === memberId)
  const timeline = getMemberTimeline(dataset, memberId)
  const ledger = member
    ? calculateAllLedgers(dataset, selectedPeriodId).find((item) => item.member.id === member.id)
    : undefined

  if (!member || !ledger) {
    return <EmptyState title="Membre introuvable" href="#/members" label="Retour aux membres" />
  }

  return (
    <section className="view-stack">
      <div className="detail-hero">
        <div>
          <p className="eyebrow">Membre 360</p>
          <h2>{member.name}</h2>
          <p>Ordre de succession {member.successionOrder} - statut {member.status}.</p>
        </div>
        <div className="button-row">
          <a className="button-like" href="#/members">
            <Users size={16} />
            Tous les membres
          </a>
          <a className="button-like" href="#/cotisations">
            <BarChart3 size={16} />
            Cotisations
          </a>
        </div>
      </div>

      <div className="stats-grid wide-summary">
        <StatTile label="Encours credit" value={formatMoney(ledger.creditBalanceCents)} tone="amber" />
        <StatTile label="Epargne voyage" value={formatMoney(ledger.travelBalanceCents)} />
        <StatTile label="Cotisations" value={formatMoney(ledger.contributionCents)} tone="green" />
        <StatTile label="Epargne payee" value={formatMoney(ledger.savingCents)} />
        <StatTile label="Assurance payee" value={formatMoney(ledger.mutualInsuranceCents)} />
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Historique mensuel</h2>
            <p>Trace individuelle des paiements, avec epargne et assurance gerees collectivement.</p>
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Mois</th>
                <th>Statut</th>
                <th>Cotisation</th>
                <th>Epargne payee</th>
                <th>Assurance payee</th>
                <th>Pret</th>
                <th>Remboursement</th>
                <th>Voyage</th>
                <th>Solde credit</th>
                <th>Solde voyage</th>
              </tr>
            </thead>
            <tbody>
              {timeline.map((row) => (
                <tr key={row.period.id}>
                  <td className="member-cell">
                    <PeriodLink period={row.period} />
                  </td>
                  <td>
                    <ContributionStatusBadge status={row.contributionStatus} />
                  </td>
                  <td>{formatMoney(row.contributionCents)}</td>
                  <td>{formatMoney(row.savingCents)}</td>
                  <td>{formatMoney(row.mutualInsuranceCents)}</td>
                  <td>{formatMoney(row.loanCents)}</td>
                  <td>{formatMoney(row.repaymentCents)}</td>
                  <td>{formatMoney(row.travelCents)}</td>
                  <td>{formatMoney(row.creditBalanceCents)}</td>
                  <td>{formatMoney(row.travelBalanceCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  )
}

function Period360View({ dataset, periodId }: { dataset: IkiminaDataset; periodId: string }) {
  const detail = getPeriodDetail(dataset, periodId)

  if (!detail) {
    return <EmptyState title="Mois introuvable" href="#/exploration" label="Retour exploration" />
  }

  const totals = calculatePeriodTotals(getPeriodEntries(dataset.monthlyEntries, periodId))
  const collectiveRow = getCollectiveFundRows(dataset).find((row) => row.period.id === periodId)
  const statusCounts = detail.rows.reduce(
    (counts, row) => {
      counts[row.contributionStatus] += 1
      return counts
    },
    { complete: 0, partial: 0, missing: 0, draft: 0 } satisfies Record<ContributionStatus, number>,
  )

  return (
    <section className="view-stack">
      <div className="detail-hero">
        <div>
          <p className="eyebrow">Mois 360</p>
          <h2>{detail.period.label}</h2>
          <p>{statusLabel(detail.period.status)} - {detail.rows.length} membres.</p>
        </div>
        <div className="button-row">
          <a className="button-like" href="#/cotisations">
            <BarChart3 size={16} />
            Cotisations
          </a>
          <a className="button-like" href="#/exploration">
            <Search size={16} />
            Exploration
          </a>
        </div>
      </div>

      <div className="stats-grid wide-summary">
        <StatTile label="Cotisations" value={formatMoney(totals.contributionCents)} tone="green" />
        <StatTile label="Fonds epargne" value={formatMoney(totals.savingCents)} />
        <StatTile label="Fonds assurance" value={formatMoney(totals.mutualInsuranceCents)} />
        <StatTile label="Prets" value={formatMoney(totals.loanCents)} tone="amber" />
        <StatTile label="Remboursements" value={formatMoney(totals.repaymentCents)} />
      </div>

      {collectiveRow && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Controle collectif</h2>
              <p>Epargne mensuelle et assurance comparees a l'attendu du mois.</p>
            </div>
            <a className="button-like" href="#/collective">
              <Layers size={16} />
              Fonds collectifs
            </a>
          </div>
          <div className="stats-grid wide-summary">
            <StatTile
              label="Epargne attendue"
              value={formatMoney(collectiveRow.expectedSavingCents)}
            />
            <StatTile
              label="Epargne ecart"
              value={formatMoney(collectiveRow.savingGapCents)}
              tone={collectiveRow.savingGapCents === 0 ? 'green' : 'red'}
            />
            <StatTile
              label="Assurance attendue"
              value={formatMoney(collectiveRow.expectedMutualInsuranceCents)}
            />
            <StatTile
              label="Assurance ecart"
              value={formatMoney(collectiveRow.mutualInsuranceGapCents)}
              tone={collectiveRow.mutualInsuranceGapCents === 0 ? 'green' : 'red'}
            />
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Statuts du mois</h2>
            <p>
              Complet {statusCounts.complete} - Partiel {statusCounts.partial} - Absent{' '}
              {statusCounts.missing} - Brouillon {statusCounts.draft}
            </p>
          </div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Ordre</th>
                <th>Membre</th>
                <th>Statut</th>
                <th>Cotisation</th>
                <th>Epargne payee</th>
                <th>Assurance payee</th>
                <th>Pret</th>
                <th>Remboursement</th>
                <th>Credit apres mois</th>
              </tr>
            </thead>
            <tbody>
              {detail.rows.map((row) => (
                <tr key={row.member.id}>
                  <td>{row.member.successionOrder}</td>
                  <td className="member-cell">
                    <MemberLink member={row.member} />
                  </td>
                  <td>
                    <ContributionStatusBadge status={row.contributionStatus} />
                  </td>
                  <td>{formatMoney(row.contributionCents)}</td>
                  <td>{formatMoney(row.savingCents)}</td>
                  <td>{formatMoney(row.mutualInsuranceCents)}</td>
                  <td>{formatMoney(row.loanCents)}</td>
                  <td>{formatMoney(row.repaymentCents)}</td>
                  <td>{formatMoney(row.creditBalanceCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  )
}

function ContributionsView({ dataset }: { dataset: IkiminaDataset }) {
  const [memberFilter, setMemberFilter] = useState('')
  const [periodFilter, setPeriodFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<ContributionStatus | 'all'>('all')
  const [sortKey, setSortKey] = useState<
    'priority' | 'order' | 'name' | 'saving-total' | 'insurance-total'
  >('priority')
  const periods = useMemo(() => sortPeriods(dataset.periods), [dataset.periods])
  const matrix = useMemo(() => getContributionMatrix(dataset), [dataset])
  const visiblePeriods = periods.filter((period) => periodFilter === 'all' || period.id === periodFilter)
  const rows = matrix
    .map((row) => {
      const cells = row.cells.filter(
        (cell) => periodFilter === 'all' || cell.period.id === periodFilter,
      )
      return {
        ...row,
        cells,
        attentionCount: cells.filter((cell) => cell.status === 'missing' || cell.status === 'partial')
          .length,
        contributionTotalCents: cells.reduce((total, cell) => total + cell.contributionCents, 0),
        savingTotalCents: cells.reduce((total, cell) => total + cell.savingCents, 0),
        mutualInsuranceTotalCents: cells.reduce(
          (total, cell) => total + cell.mutualInsuranceCents,
          0,
        ),
      }
    })
    .filter((row) => {
      const matchesMember = row.member.name.toLowerCase().includes(memberFilter.toLowerCase())
      const matchesStatus =
        statusFilter === 'all' || row.cells.some((cell) => cell.status === statusFilter)
      return matchesMember && matchesStatus
    })
    .sort((first, second) => {
      if (sortKey === 'order') {
        return first.member.successionOrder - second.member.successionOrder
      }

      if (sortKey === 'name') {
        return first.member.name.localeCompare(second.member.name, 'fr')
      }

      if (sortKey === 'saving-total') {
        return second.savingTotalCents - first.savingTotalCents
      }

      if (sortKey === 'insurance-total') {
        return second.mutualInsuranceTotalCents - first.mutualInsuranceTotalCents
      }

      return second.attentionCount - first.attentionCount || first.member.successionOrder - second.member.successionOrder
    })

  return (
    <section className="view-stack">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Matrice des cotisations</h2>
            <p>C = cotisation, E = epargne payee, A = assurance payee.</p>
          </div>
          <div className="filter-row">
            <label className="field">
              <span>Membre</span>
              <input
                value={memberFilter}
                onChange={(event) => setMemberFilter(event.target.value)}
                placeholder="Rechercher"
              />
            </label>
            <label className="field">
              <span>Statut</span>
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as ContributionStatus | 'all')
                }
              >
                <option value="all">Tous</option>
                <option value="complete">Complet</option>
                <option value="partial">Partiel</option>
                <option value="missing">Absent</option>
                <option value="draft">Brouillon</option>
              </select>
            </label>
            <label className="field">
              <span>Mois</span>
              <select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)}>
                <option value="all">Tous</option>
                {periods.map((period) => (
                  <option key={period.id} value={period.id}>
                    {period.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Tri</span>
              <select
                value={sortKey}
                onChange={(event) =>
                  setSortKey(
                    event.target.value as
                      | 'priority'
                      | 'order'
                      | 'name'
                      | 'saving-total'
                      | 'insurance-total',
                  )
                }
              >
                <option value="priority">Priorite</option>
                <option value="order">Ordre succession</option>
                <option value="name">Nom</option>
                <option value="saving-total">Epargne payee</option>
                <option value="insurance-total">Assurance payee</option>
              </select>
            </label>
          </div>
        </div>
        <div className="matrix-wrap">
          <table className="matrix-table">
            <thead>
              <tr>
                <th>Membre</th>
                {visiblePeriods.map((period) => (
                  <th key={period.id}>
                    <PeriodLink period={period} />
                  </th>
                ))}
                <th>Total C</th>
                <th>Total E</th>
                <th>Total A</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.member.id}>
                  <td className="member-cell">
                    <MemberLink member={row.member} />
                  </td>
                  {row.cells.map((cell) => (
                    <td key={cell.period.id} className={`matrix-cell ${cell.status}`}>
                      <a href={periodHash(cell.period.id)}>
                        <span>{contributionStatusLabels[cell.status]}</span>
                        <small>
                          C {formatMoney(cell.contributionCents)} / E{' '}
                          {formatMoney(cell.savingCents)} / A{' '}
                          {formatMoney(cell.mutualInsuranceCents)}
                        </small>
                      </a>
                    </td>
                  ))}
                  <td>{formatMoney(row.contributionTotalCents)}</td>
                  <td>{formatMoney(row.savingTotalCents)}</td>
                  <td>{formatMoney(row.mutualInsuranceTotalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  )
}

function SettingsView({
  dataset,
  dashboardTotals,
}: {
  dataset: IkiminaDataset
  dashboardTotals: ReturnType<typeof calculateDashboardTotals>
}) {
  return (
    <section className="view-stack">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Cycle et valeurs par defaut</h2>
            <p>Parametres financiers du cycle importe.</p>
          </div>
        </div>
        <div className="settings-grid">
          <StatTile label="Cotisation par defaut" value={formatMoney(dataset.cycle.defaults.contributionCents)} />
          <StatTile
            label="Epargne mensuelle par membre"
            value={formatMoney(dataset.cycle.defaults.savingCents)}
          />
          <StatTile
            label="Assurance mutuelle"
            value={formatMoney(dataset.cycle.defaults.mutualInsuranceCents)}
          />
          <StatTile label="Mois brouillons" value={String(dashboardTotals.draftPeriods)} tone="amber" />
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Import Excel</h2>
            <p>Le classeur source est archive en lecture seule, sans suppression de feuille.</p>
          </div>
        </div>
        <div className="import-box">
          <p>
            Source: <code>{dataset.importReport.sourceWorkbook}</code>
          </p>
          <p>Formules #REF! ignorees: {dataset.importReport.ignoredFormulaErrors}</p>
          <p>Avertissements: {dataset.importReport.warnings.length}</p>
        </div>
      </section>
    </section>
  )
}

function RotationView({ dataset }: { dataset: IkiminaDataset }) {
  const rotation = useMemo(() => getTontineRotation(dataset), [dataset])

  return (
    <section className="view-stack">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Calendrier de Rotation</h2>
            <p>
              Pourquoi certains ont-ils paye moins ? Le beneficiaire du mois est exempte de sa cotisation de 100€.
            </p>
          </div>
        </div>
      </section>
      <div className="cards-grid">
        {rotation.map((entry) => (
          <div key={entry.period.id} className={`rotation-card ${entry.status}`}>
            <div className="rotation-card-header">
              <h3>{entry.period.label}</h3>
              <span className={`rotation-status ${entry.status}`}>
                {entry.status === 'past' ? 'Cloture' : entry.status === 'current' ? 'Mois en cours' : 'A venir'}
              </span>
            </div>
            <div className="rotation-card-body">
              <div className="rotation-beneficiary">
                <MemberLink member={entry.member} />
              </div>
              <div className="rotation-details">
                <p>Ordre de succession : {entry.member.successionOrder}</p>
                <p>Exempte de cotisation (0€)</p>
                {entry.isPredicted && <span className="predicted-badge">Prediction automatique</span>}
              </div>
            </div>
            <div className="rotation-card-footer">
              <span>Cagnotte estimee</span>
              <span className="rotation-cagnotte">{formatMoney(entry.cagnotteAmountCents)}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

const proofPurposeLabels: Record<ProofCandidate['purpose'], string> = {
  cotisation: 'Cotisation',
  epargne: 'Epargne',
  assurance: 'Assurance',
  cotisation_epargne_assurance: 'Cotisation + epargne + assurance',
  unknown: 'A qualifier',
}

const proofStatusLabels: Record<ProofCandidate['status'], string> = {
  ready: 'Pret',
  needs_review: 'A verifier',
  unsupported: 'Non supporte',
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} o`
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1).replace('.', ',')} Ko`
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`
}

function downloadProofCandidates(candidates: ProofCandidate[]) {
  const exportRows = candidates.map((candidate) => ({
    fileName: candidate.fileName,
    fileType: candidate.fileType,
    memberId: candidate.member?.id ?? null,
    memberName: candidate.member?.name ?? null,
    periodId: candidate.period?.id ?? null,
    periodLabel: candidate.period?.label ?? null,
    amountCents: candidate.amountCents ?? null,
    purpose: candidate.purpose,
    confidence: candidate.confidence,
    status: candidate.status,
    reasons: candidate.reasons,
  }))
  const blob = new Blob([JSON.stringify(exportRows, null, 2)], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'ikimina-preuves-triage.json'
  link.click()
  URL.revokeObjectURL(url)
}

function ProofImportView({ dataset }: { dataset: IkiminaDataset }) {
  const [candidates, setCandidates] = useState<ProofCandidate[]>([])
  const summary = useMemo(() => summarizeProofCandidates(candidates), [candidates])

  async function loadFiles(files: FileList | null) {
    if (!files?.length) {
      return
    }

    const nextCandidates = await Promise.all(
      Array.from(files).map(async (file) => {
        const isTextLike =
          file.type.startsWith('text/') ||
          file.type === 'application/json' ||
          file.name.toLowerCase().endsWith('.csv')
        const text = isTextLike ? await file.text() : undefined

        return buildProofCandidate(dataset, {
          fileName: file.name,
          fileType: file.type,
          sizeBytes: file.size,
          text,
        })
      }),
    )

    setCandidates((current) => [...nextCandidates, ...current])
  }

  return (
    <section className="view-stack">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Loader de justificatifs</h2>
            <p>
              Depot local pour preparer l'import: l'app tente d'attribuer membre, mois, montant et
              categorie avant validation.
            </p>
          </div>
          <div className="button-row">
            <button onClick={() => downloadProofCandidates(candidates)} disabled={!candidates.length}>
              <Download size={16} />
              JSON triage
            </button>
            <button onClick={() => setCandidates([])} disabled={!candidates.length}>
              <RefreshCcw size={16} />
              Vider
            </button>
          </div>
        </div>

        <label className="proof-dropzone">
          <Upload size={22} />
          <strong>Deposer des preuves</strong>
          <span>PDF, images, CSV, TXT ou JSON. Les PDF/images sont analyses par nom en v1.</span>
          <input
            type="file"
            multiple
            accept=".pdf,image/*,.csv,.txt,.json"
            onChange={(event) => loadFiles(event.target.files)}
          />
        </label>
      </section>

      <div className="stats-grid wide-summary">
        <StatTile label="Documents" value={String(summary.total)} />
        <StatTile label="Prets" value={String(summary.ready)} tone="green" />
        <StatTile label="A verifier" value={String(summary.needsReview)} tone="amber" />
        <StatTile label="Non supportes" value={String(summary.unsupported)} tone="red" />
      </div>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Triage des preuves</h2>
            <p>Base de travail avant persistance Supabase et OCR serveur.</p>
          </div>
        </div>
        {candidates.length === 0 ? (
          <div className="empty-state">
            <FileQuestion size={22} />
            <p>Aucun document charge. Le loader est pret pour tester des fichiers locaux.</p>
          </div>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fichier</th>
                  <th>Statut</th>
                  <th>Membre suggere</th>
                  <th>Mois suggere</th>
                  <th>Montant</th>
                  <th>Categorie</th>
                  <th>Confiance</th>
                  <th>Questions</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((candidate) => (
                  <tr key={candidate.id}>
                    <td>
                      <strong>{candidate.fileName}</strong>
                      <small className="muted-cell">
                        {candidate.fileType || 'type inconnu'} - {formatFileSize(candidate.sizeBytes)}
                      </small>
                    </td>
                    <td>
                      <span className={`proof-status ${candidate.status}`}>
                        {proofStatusLabels[candidate.status]}
                      </span>
                    </td>
                    <td>
                      {candidate.member ? <MemberLink member={candidate.member} /> : 'A choisir'}
                    </td>
                    <td>{candidate.period ? <PeriodLink period={candidate.period} /> : 'A choisir'}</td>
                    <td>
                      {candidate.amountCents === undefined
                        ? 'A saisir'
                        : formatMoney(candidate.amountCents)}
                    </td>
                    <td>{proofPurposeLabels[candidate.purpose]}</td>
                    <td>{candidate.confidence}%</td>
                    <td>{candidate.reasons.length ? candidate.reasons.join(' ') : 'OK'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Prochaine etape technique</h2>
            <p>
              En production, ces candidats iront dans Supabase Storage + table de validation, puis
              l'admin confirmera avant d'ecrire dans les entrees mensuelles.
            </p>
          </div>
          <Database size={20} />
        </div>
      </section>
    </section>
  )
}

function EmptyState({ title, href, label }: { title: string; href: string; label: string }) {
  return (
    <section className="panel empty-state">
      <h2>{title}</h2>
      <a className="button-like" href={href}>
        {label}
      </a>
    </section>
  )
}

export default App
