import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import ExcelJS from 'exceljs'
import {
  calculateAllLedgers,
  calculatePeriodTotals,
  getPeriodEntries,
  sortMembers,
} from '../domain/calculations'
import { formatPdfMoney, fromCents } from '../domain/money'
import type { IkiminaDataset, MonthlyEntry, Period } from '../domain/types'

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function fileSafe(label: string) {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function entryFor(entries: MonthlyEntry[], periodId: string, memberId: string) {
  return entries.find((entry) => entry.periodId === periodId && entry.memberId === memberId)
}

export async function exportPeriodToXlsx(dataset: IkiminaDataset, period: Period) {
  const members = sortMembers(dataset.members)
  const periodEntries = getPeriodEntries(dataset.monthlyEntries, period.id)
  const rows = [
    [
      'Ordre',
      'Nom',
      'Cotisation',
      'Epargne',
      'Ass. mutuelle',
      'Pret',
      'Remboursement',
      'Voyage',
      'Note',
    ],
    ...members.map((member) => {
      const entry = entryFor(periodEntries, period.id, member.id)
      return [
        member.successionOrder,
        member.name,
        fromCents(entry?.contributionCents ?? 0),
        fromCents(entry?.savingCents ?? 0),
        fromCents(entry?.mutualInsuranceCents ?? 0),
        fromCents(entry?.loanCents ?? 0),
        fromCents(entry?.repaymentCents ?? 0),
        fromCents(entry?.travelCents ?? 0),
        entry?.notes ?? '',
      ]
    }),
  ]
  const totals = calculatePeriodTotals(periodEntries)
  rows.push([
    '',
    'TOTAL',
    fromCents(totals.contributionCents),
    fromCents(totals.savingCents),
    fromCents(totals.mutualInsuranceCents),
    fromCents(totals.loanCents),
    fromCents(totals.repaymentCents),
    fromCents(totals.travelCents),
    '',
  ])

  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'IKIMINA'
  workbook.created = new Date()
  const worksheet = workbook.addWorksheet(period.label)
  worksheet.addRows(rows)
  worksheet.getRow(1).font = { bold: true }
  worksheet.columns.forEach((column) => {
    column.width = 18
  })
  const buffer = await workbook.xlsx.writeBuffer()
  downloadBlob(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `ikimina-${fileSafe(period.label)}.xlsx`,
  )
}

export function exportPeriodToPdf(dataset: IkiminaDataset, period: Period) {
  const doc = new jsPDF({ orientation: 'landscape' })
  const members = sortMembers(dataset.members)
  const periodEntries = getPeriodEntries(dataset.monthlyEntries, period.id)
  const totals = calculatePeriodTotals(periodEntries)

  doc.setFontSize(16)
  doc.text(`${dataset.cycle.name} - ${period.label}`, 14, 16)
  doc.setFontSize(9)
  doc.text(`Statut: ${period.status === 'closed' ? 'cloture' : 'brouillon'}`, 14, 23)

  autoTable(doc, {
    startY: 30,
    head: [
      [
        'Ordre',
        'Nom',
        'Cotisation',
        'Epargne',
        'Ass. mutuelle',
        'Pret',
        'Remboursement',
        'Voyage',
      ],
    ],
    body: members.map((member) => {
      const entry = entryFor(periodEntries, period.id, member.id)
      return [
        String(member.successionOrder),
        member.name,
        formatPdfMoney(entry?.contributionCents ?? 0),
        formatPdfMoney(entry?.savingCents ?? 0),
        formatPdfMoney(entry?.mutualInsuranceCents ?? 0),
        formatPdfMoney(entry?.loanCents ?? 0),
        formatPdfMoney(entry?.repaymentCents ?? 0),
        formatPdfMoney(entry?.travelCents ?? 0),
      ]
    }),
    foot: [
      [
        '',
        'TOTAL',
        formatPdfMoney(totals.contributionCents),
        formatPdfMoney(totals.savingCents),
        formatPdfMoney(totals.mutualInsuranceCents),
        formatPdfMoney(totals.loanCents),
        formatPdfMoney(totals.repaymentCents),
        formatPdfMoney(totals.travelCents),
      ],
    ],
    styles: { fontSize: 8 },
    headStyles: { fillColor: [31, 41, 55] },
    footStyles: { fillColor: [237, 243, 238], textColor: [17, 24, 39] },
  })

  const ledgers = calculateAllLedgers(dataset, period.id)
  autoTable(doc, {
    startY: (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable
      ? (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable!.finalY + 10
      : 120,
    head: [['Ordre', 'Nom', 'Encours credit', 'Epargne voyage']],
    body: ledgers.map((ledger) => [
      String(ledger.member.successionOrder),
      ledger.member.name,
      formatPdfMoney(ledger.creditBalanceCents),
      formatPdfMoney(ledger.travelBalanceCents),
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [31, 41, 55] },
  })

  doc.save(`ikimina-${fileSafe(period.label)}.pdf`)
}
