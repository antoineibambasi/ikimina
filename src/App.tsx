import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Download,
  FileSpreadsheet,
  Gauge,
  Landmark,
  Lock,
  PiggyBank,
  RefreshCcw,
  Save,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react'
import './App.css'
import importedDataset from './data/ikimina-import.json'
import {
  calculateAllLedgers,
  calculateDashboardTotals,
  calculatePeriodTotals,
  getCurrentPeriod,
  getPeriodEntries,
  sortMembers,
  sortPeriods,
  upsertMonthlyEntry,
} from './domain/calculations'
import { formatInputMoney, formatMoney, parseMoneyInput } from './domain/money'
import type { AuditEvent, IkiminaDataset, MonthlyEntry, Period } from './domain/types'
import { isSupabaseConfigured, supabase } from './lib/supabase'

type ViewKey =
  | 'dashboard'
  | 'encoding'
  | 'members'
  | 'credits'
  | 'travel'
  | 'reports'
  | 'settings'

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
  { key: 'reports', label: 'Rapports', icon: BarChart3 },
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

function cloneInitialDataset(): IkiminaDataset {
  return structuredClone(importedDataset) as IkiminaDataset
}

function statusLabel(status: Period['status']) {
  return status === 'closed' ? 'Cloture' : 'Brouillon'
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
}: {
  label: string
  value: string
  tone?: 'neutral' | 'green' | 'amber' | 'red'
}) {
  return (
    <div className={`stat-tile tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
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
  const [activeView, setActiveView] = useState<ViewKey>('dashboard')
  const [selectedPeriodId, setSelectedPeriodId] = useState(
    () => getCurrentPeriod(cloneInitialDataset().periods).id,
  )
  const [notice, setNotice] = useState<string | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [isAuthLoading, setIsAuthLoading] = useState(isSupabaseConfigured)

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
    setNotice('Donnees locales rechargees depuis l’import Excel.')
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
              <button
                key={item.key}
                className={activeView === item.key ? 'active' : ''}
                onClick={() => setActiveView(item.key)}
              >
                <Icon size={18} />
                {item.label}
              </button>
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
            <h1>{viewItems.find((item) => item.key === activeView)?.label}</h1>
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
              onChange={setSelectedPeriodId}
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
              Mode local: les donnees viennent de l’import Excel. Configure Supabase pour activer
              l’authentification par lien email et la persistence cloud.
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

        {activeView === 'dashboard' && (
          <section className="view-stack">
            <div className="stats-grid">
              <StatTile
                label={`Cotisations ${selectedPeriod.label}`}
                value={formatMoney(dashboardTotals.contributionCents)}
                tone="green"
              />
              <StatTile
                label="Encours credit total"
                value={formatMoney(dashboardTotals.creditBalanceCents)}
                tone="amber"
              />
              <StatTile
                label="Epargne voyage totale"
                value={formatMoney(dashboardTotals.travelBalanceCents)}
              />
              <StatTile label="Membres actifs" value={String(dashboardTotals.activeMembers)} />
            </div>

            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Situation du mois</h2>
                  <p>Totaux importes ou saisis pour {selectedPeriod.label}.</p>
                </div>
                <div className="button-row">
                  <button onClick={downloadPdf}>
                    <Download size={16} />
                    PDF
                  </button>
                  <button onClick={downloadXlsx}>
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
        )}

        {activeView === 'encoding' && (
          <section className="panel wide-panel">
            <div className="panel-heading">
              <div>
                <h2>Grille mensuelle</h2>
                <p>
                  Saisie par membre. Les montants sont verrouilles quand le mois est cloture.
                </p>
              </div>
              <div className="button-row">
                <button onClick={closeSelectedPeriod} disabled={selectedPeriod.status === 'closed'}>
                  <CheckCircle2 size={16} />
                  Cloturer
                </button>
                <button onClick={resetLocalData}>
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
                        <td className="member-cell">{member.name}</td>
                        {moneyFields.map((field) => (
                          <td key={field.key}>
                            <input
                              aria-label={`${field.label} ${member.name}`}
                              disabled={selectedPeriod.status === 'closed'}
                              value={formatInputMoney(entry[field.key])}
                              onChange={(event) =>
                                updateEntryMoney(member.id, field.key, event.target.value)
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
        )}

        {activeView === 'members' && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Participants</h2>
                <p>Ordre de succession et soldes calcules jusqu’a {selectedPeriod.label}.</p>
              </div>
            </div>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Ordre</th>
                    <th>Nom</th>
                    <th>Statut</th>
                    <th>Encours credit</th>
                    <th>Epargne voyage</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgers.map((ledger) => (
                    <tr key={ledger.member.id}>
                      <td>{ledger.member.successionOrder}</td>
                      <td className="member-cell">{ledger.member.name}</td>
                      <td>{ledger.member.status === 'active' ? 'Actif' : 'Inactif'}</td>
                      <td>{formatMoney(ledger.creditBalanceCents)}</td>
                      <td>{formatMoney(ledger.travelBalanceCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeView === 'credits' && (
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
                      <td className="member-cell">{ledger.member.name}</td>
                      <td>{formatMoney(ledger.openingCreditCents)}</td>
                      <td>{formatMoney(ledger.loanCents)}</td>
                      <td>{formatMoney(ledger.repaymentCents)}</td>
                      <td className={ledger.creditBalanceCents > 0 ? 'amount-alert' : ''}>
                        {formatMoney(ledger.creditBalanceCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeView === 'travel' && (
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
                      <td className="member-cell">{ledger.member.name}</td>
                      <td>{formatMoney(ledger.openingTravelSavingCents)}</td>
                      <td>{formatMoney(ledger.travelMovementCents)}</td>
                      <td>{formatMoney(ledger.travelBalanceCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeView === 'reports' && (
          <section className="view-stack">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Rapport publie</h2>
                  <p>Export du mois selectionne en PDF ou Excel.</p>
                </div>
                <div className="button-row">
                  <button onClick={downloadPdf}>
                    <Download size={16} />
                    PDF
                  </button>
                  <button onClick={downloadXlsx}>
                    <FileSpreadsheet size={16} />
                    Excel
                  </button>
                </div>
              </div>
              <div className="report-summary">
                <StatTile label="Cotisations" value={formatMoney(selectedTotals.contributionCents)} />
                <StatTile label="Prets" value={formatMoney(selectedTotals.loanCents)} tone="amber" />
                <StatTile
                  label="Remboursements"
                  value={formatMoney(selectedTotals.repaymentCents)}
                  tone="green"
                />
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
        )}

        {activeView === 'settings' && (
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
                <StatTile label="Epargne par defaut" value={formatMoney(dataset.cycle.defaults.savingCents)} />
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
        )}
      </main>
    </div>
  )
}

export default App
