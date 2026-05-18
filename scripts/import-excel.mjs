import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const sourceWorkbook =
  process.env.IKIMINA_EXCEL_PATH ??
  path.resolve(projectRoot, '..', '2025', 'IKIMINA 2025_2026REV1.xlsx')
const outputDataPath = path.resolve(projectRoot, 'src', 'data', 'ikimina-import.json')
const outputReportPath = path.resolve(projectRoot, 'docs', 'import-report.md')

const monthlySheetPattern =
  /^(JUIN|JUILLET|AOUT|SEPTEMBRE|OCTOBRE|NOVEMBRE|DECEMBRE|JANVIER|FEVRIER|MARS|AVRIL|MAI)\s+20\d{2}$/i

const monthNumbers = {
  JANVIER: '01',
  FEVRIER: '02',
  MARS: '03',
  AVRIL: '04',
  MAI: '05',
  JUIN: '06',
  JUILLET: '07',
  AOUT: '08',
  SEPTEMBRE: '09',
  OCTOBRE: '10',
  NOVEMBRE: '11',
  DECEMBRE: '12',
}

function slug(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function toCents(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value * 100)
  }

  if (typeof value === 'string') {
    const parsed = Number(value.replace(/\s/g, '').replace(/[€]/g, '').replace(',', '.'))
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0
  }

  return 0
}

function asText(value) {
  if (value === null || value === undefined) {
    return ''
  }
  return String(value).trim()
}

function primitiveCellValue(value) {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'object') {
    return value
  }

  if ('result' in value) {
    return primitiveCellValue(value.result)
  }

  if ('text' in value) {
    return value.text
  }

  if ('richText' in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text ?? '').join('')
  }

  if ('error' in value) {
    return value.error
  }

  return null
}

function cellValue(row, columnIndex) {
  return primitiveCellValue(row.getCell(columnIndex).value)
}

function parseMonth(sheetName) {
  const [monthName, year] = sheetName.trim().split(/\s+/)
  const month = monthNumbers[monthName.toUpperCase()]
  if (!month) {
    throw new Error(`Cannot parse month from sheet "${sheetName}"`)
  }
  return `${year}-${month}-01`
}

function periodStatus(month) {
  const now = new Date()
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const periodDate = new Date(`${month}T00:00:00.000Z`)
  return periodDate < currentMonthStart ? 'closed' : 'draft'
}

function countFormulaErrors(sheet, warnings) {
  let count = 0
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      const value = cell.value
      if (value && typeof value === 'object' && 'formula' in value) {
        const formula = String(value.formula)
        if (formula.includes('#REF!')) {
          count += 1
          warnings.push({
            sheet: sheet.name,
            cell: cell.address,
            message: 'Formule #REF! ignoree; la valeur visible est importee si disponible.',
          })
        }
      }
    })
  })
  return count
}

function parseOpening(workbook, warnings) {
  const openingSheet = workbook.worksheets.find((sheet) =>
    sheet.name.toUpperCase().startsWith('SUTUATION DE DEPART'),
  )
  if (!openingSheet) {
    throw new Error('Opening sheet "SUTUATION DE DEPART" not found')
  }

  const members = []
  const openingBalances = []

  for (let rowIndex = 5; rowIndex <= openingSheet.rowCount; rowIndex += 1) {
    const row = openingSheet.getRow(rowIndex)
    const name = asText(cellValue(row, 2))
    if (!name || name.toUpperCase().startsWith('TOTAL')) {
      break
    }

    const id = `member-${slug(name)}`
    const successionOrder = Number(cellValue(row, 3))
    if (!Number.isFinite(successionOrder)) {
      warnings.push({
        sheet: openingSheet.name,
        message: `Ordre de succession invalide pour ${name}; valeur mise a 0.`,
      })
    }

    members.push({
      id,
      name,
      successionOrder: Number.isFinite(successionOrder) ? successionOrder : 0,
      status: 'active',
    })
    openingBalances.push({
      memberId: id,
      creditCents: toCents(cellValue(row, 4)),
      travelSavingCents: toCents(cellValue(row, 5)),
    })
  }

  return { members, openingBalances }
}

function parsePeriodsAndEntries(workbook, members, warnings) {
  const memberByName = new Map(members.map((member) => [member.name.toUpperCase(), member]))
  const periods = []
  const monthlyEntries = []
  const periodTotals = []
  let ignoredFormulaErrors = 0

  for (const sheet of workbook.worksheets.filter((worksheet) =>
    monthlySheetPattern.test(worksheet.name),
  )) {
    ignoredFormulaErrors += countFormulaErrors(sheet, warnings)
    const month = parseMonth(sheet.name)
    const periodId = `period-${month.slice(0, 7)}`
    const status = periodStatus(month)
    periods.push({
      id: periodId,
      cycleId: 'cycle-2025-2026',
      label: sheet.name,
      month,
      status,
      closedAt: status === 'closed' ? `${month}T18:00:00.000Z` : undefined,
    })

    const entriesForTotals = []
    for (let rowIndex = 5; rowIndex <= sheet.rowCount; rowIndex += 1) {
      const row = sheet.getRow(rowIndex)
      const name = asText(cellValue(row, 2))
      if (!name || name.toUpperCase().includes('TOT')) {
        break
      }

      const member = memberByName.get(name.toUpperCase())
      if (!member) {
        warnings.push({
          sheet: sheet.name,
          message: `Membre "${name}" absent de la situation de depart; ligne ignoree.`,
        })
        continue
      }

      const entry = {
        id: `entry-${periodId}-${member.id}`,
        periodId,
        memberId: member.id,
        contributionCents: toCents(cellValue(row, 4)),
        savingCents: toCents(cellValue(row, 5)),
        mutualInsuranceCents: toCents(cellValue(row, 6)),
        loanCents: toCents(cellValue(row, 7)),
        repaymentCents: toCents(cellValue(row, 8)),
        travelCents: toCents(cellValue(row, 9)),
        notes: '',
      }
      monthlyEntries.push(entry)
      entriesForTotals.push(entry)
    }

    periodTotals.push({
      periodId,
      label: sheet.name,
      contributionCents: entriesForTotals.reduce((sum, entry) => sum + entry.contributionCents, 0),
      savingCents: entriesForTotals.reduce((sum, entry) => sum + entry.savingCents, 0),
      mutualInsuranceCents: entriesForTotals.reduce(
        (sum, entry) => sum + entry.mutualInsuranceCents,
        0,
      ),
      loanCents: entriesForTotals.reduce((sum, entry) => sum + entry.loanCents, 0),
      repaymentCents: entriesForTotals.reduce((sum, entry) => sum + entry.repaymentCents, 0),
      travelCents: entriesForTotals.reduce((sum, entry) => sum + entry.travelCents, 0),
    })
  }

  return { periods, monthlyEntries, periodTotals, ignoredFormulaErrors }
}

function centsToEuro(cents) {
  return (cents / 100).toLocaleString('fr-BE', {
    style: 'currency',
    currency: 'EUR',
  })
}

function writeReport(dataset) {
  const lines = [
    '# Rapport d’import IKIMINA',
    '',
    `Source: \`${dataset.importReport.sourceWorkbook}\``,
    `Generation: ${dataset.importReport.generatedAt}`,
    '',
    'Le fichier Excel source est lu en lecture seule. Aucune feuille Excel n’est supprimee ou modifiee.',
    '',
    '## Resume',
    '',
    `- Membres importes: ${dataset.members.length}`,
    `- Mois importes: ${dataset.periods.length}`,
    `- Lignes mensuelles importees: ${dataset.monthlyEntries.length}`,
    `- Formules #REF! ignorees: ${dataset.importReport.ignoredFormulaErrors}`,
    '',
    '## Totaux mensuels importes',
    '',
    '| Mois | Cotisations | Epargne | Ass. mutuelle | Prets | Remboursements | Voyage |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...dataset.importReport.periodTotals.map(
      (total) =>
        `| ${total.label} | ${centsToEuro(total.contributionCents)} | ${centsToEuro(
          total.savingCents,
        )} | ${centsToEuro(total.mutualInsuranceCents)} | ${centsToEuro(
          total.loanCents,
        )} | ${centsToEuro(total.repaymentCents)} | ${centsToEuro(total.travelCents)} |`,
    ),
    '',
    '## Avertissements',
    '',
    ...(dataset.importReport.warnings.length
      ? dataset.importReport.warnings.map(
          (warning) =>
            `- ${warning.sheet}${warning.cell ? ` ${warning.cell}` : ''}: ${warning.message}`,
        )
      : ['- Aucun avertissement.']),
    '',
  ]

  fs.mkdirSync(path.dirname(outputReportPath), { recursive: true })
  fs.writeFileSync(outputReportPath, `${lines.join('\n')}\n`, 'utf8')
}

if (!fs.existsSync(sourceWorkbook)) {
  throw new Error(`Workbook not found: ${sourceWorkbook}`)
}

const workbook = new ExcelJS.Workbook()
await workbook.xlsx.readFile(sourceWorkbook)

const warnings = []
const { members, openingBalances } = parseOpening(workbook, warnings)
const { periods, monthlyEntries, periodTotals, ignoredFormulaErrors } = parsePeriodsAndEntries(
  workbook,
  members,
  warnings,
)

const dataset = {
  cycle: {
    id: 'cycle-2025-2026',
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
  members,
  periods: periods.sort((first, second) => first.month.localeCompare(second.month)),
  openingBalances,
  monthlyEntries,
  auditEvents: [
    {
      id: 'audit-import-2025-2026',
      actor: 'system',
      action: 'import_excel',
      entityType: 'cycle',
      entityId: 'cycle-2025-2026',
      after: {
        members: members.length,
        periods: periods.length,
        monthlyEntries: monthlyEntries.length,
      },
      createdAt: new Date().toISOString(),
    },
  ],
  exports: [],
  importReport: {
    sourceWorkbook,
    generatedAt: new Date().toISOString(),
    ignoredFormulaErrors,
    warnings,
    periodTotals,
  },
}

fs.mkdirSync(path.dirname(outputDataPath), { recursive: true })
fs.writeFileSync(outputDataPath, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8')
writeReport(dataset)

console.log(`Imported ${members.length} members, ${periods.length} periods.`)
console.log(`Wrote ${path.relative(projectRoot, outputDataPath)}`)
console.log(`Wrote ${path.relative(projectRoot, outputReportPath)}`)
