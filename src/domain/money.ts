import type { MoneyCents } from './types'

const eurFormatter = new Intl.NumberFormat('fr-BE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
})

export function toCents(value: unknown): MoneyCents {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value * 100)
  }

  if (typeof value === 'string') {
    const normalized = value
      .replace(/\s/g, '')
      .replace(/[€]/g, '')
      .replace(',', '.')
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0
  }

  return 0
}

export function fromCents(cents: MoneyCents): number {
  return cents / 100
}

export function formatMoney(cents: MoneyCents): string {
  return eurFormatter.format(fromCents(cents))
}

export function formatPdfMoney(cents: MoneyCents): string {
  return formatMoney(cents).replace(/[\u00a0\u202f]/g, ' ')
}

export function parseMoneyInput(value: string): MoneyCents {
  return toCents(value)
}

export function formatInputMoney(cents: MoneyCents): string {
  return fromCents(cents).toFixed(2).replace('.', ',')
}

export function sumCents(values: MoneyCents[]): MoneyCents {
  return values.reduce((total, value) => total + value, 0)
}
