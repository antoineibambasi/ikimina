import type {
  IkiminaDataset,
  MoneyCents,
  Period,
  ProofCandidate,
  ProofCandidatePurpose,
  ProofDocumentInput,
  ProofTriageSummary,
} from './types'
import { toCents } from './money'
import { sortPeriods } from './calculations'

const supportedTextTypes = new Set(['text/plain', 'text/csv', 'application/json'])

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokenScore(source: string, target: string): number {
  const tokens = target.split(' ').filter((token) => token.length >= 3)
  if (tokens.length === 0) {
    return 0
  }

  const matches = tokens.filter((token) => source.includes(token)).length
  return matches / tokens.length
}

function inferPeriod(dataset: IkiminaDataset, text: string): Period | undefined {
  const normalized = normalize(text)
  const ranked = sortPeriods(dataset.periods)
    .map((period) => ({
      period,
      score: Math.max(
        normalized.includes(normalize(period.label)) ? 1 : 0,
        normalized.includes(period.month.slice(0, 7)) ? 1 : 0,
        tokenScore(normalized, period.label),
      ),
    }))
    .sort((first, second) => second.score - first.score)[0]

  return ranked?.score >= 0.5 ? ranked.period : undefined
}

function inferMember(dataset: IkiminaDataset, text: string) {
  const normalized = normalize(text)
  const ranked = dataset.members
    .map((member) => {
      const memberName = normalize(member.name)
      return {
        member,
        score: Math.max(normalized.includes(memberName) ? 1 : 0, tokenScore(normalized, memberName)),
      }
    })
    .sort((first, second) => second.score - first.score)[0]

  return ranked?.score >= 0.5 ? ranked : undefined
}

function inferAmount(text: string): MoneyCents | undefined {
  const currencyMatches = [
    ...text.matchAll(/(?:€\s*)?(\d{1,3}(?:[ .]\d{3})*|\d+)(?:[,.](\d{2}))?[\s_-]*(?:€|eur)\b/gi),
  ]
  const fallbackMatches = [
    ...text.matchAll(/(?:€\s*)?(\d{1,3}(?:[ .]\d{3})*|\d+)(?:[,.](\d{2}))?/gi),
  ].filter((match) => {
    const whole = match[1].replace(/[ .]/g, '')
    const numeric = Number(whole)
    return numeric < 1900 || numeric > 2099
  })
  const matches = currencyMatches.length ? currencyMatches : fallbackMatches
  const amounts = matches
    .map((match) => {
      const whole = match[1].replace(/[ .]/g, '')
      const decimals = match[2] ?? '00'
      return toCents(`${whole},${decimals}`)
    })
    .filter((amount) => amount > 0)

  return amounts.sort((first, second) => second - first)[0]
}

function inferPurpose(dataset: IkiminaDataset, amountCents?: MoneyCents): ProofCandidatePurpose {
  if (!amountCents) {
    return 'unknown'
  }

  const defaults = dataset.cycle.defaults
  const fullMonthlyExpected =
    defaults.contributionCents + defaults.savingCents + defaults.mutualInsuranceCents

  if (amountCents === fullMonthlyExpected) {
    return 'cotisation_epargne_assurance'
  }

  if (amountCents === defaults.contributionCents) {
    return 'cotisation'
  }

  if (amountCents === defaults.savingCents) {
    return 'epargne'
  }

  if (amountCents === defaults.mutualInsuranceCents) {
    return 'assurance'
  }

  return 'unknown'
}

function isSupported(input: ProofDocumentInput): boolean {
  const type = (input.fileType || '').toLowerCase()
  return (
    supportedTextTypes.has(type) ||
    type.startsWith('image/') ||
    type === 'application/pdf' ||
    input.fileName.toLowerCase().endsWith('.pdf')
  )
}

export function buildProofCandidate(
  dataset: IkiminaDataset,
  input: ProofDocumentInput,
): ProofCandidate {
  const fileType = input.fileType || 'application/octet-stream'
  const searchableText = `${input.fileName}\n${input.text ?? ''}`
  const period = inferPeriod(dataset, searchableText)
  const memberMatch = inferMember(dataset, searchableText)
  const amountCents = inferAmount(searchableText)
  const purpose = inferPurpose(dataset, amountCents)
  const supported = isSupported({ ...input, fileType })
  const reasons: string[] = []

  if (!supported) {
    reasons.push('Format non supporte pour le loader v1.')
  }

  if (!memberMatch) {
    reasons.push('Membre non reconnu automatiquement.')
  }

  if (!period) {
    reasons.push('Mois non reconnu automatiquement.')
  }

  if (!amountCents) {
    reasons.push('Montant non reconnu automatiquement.')
  }

  if (purpose === 'unknown' && amountCents) {
    reasons.push('Montant reconnu mais categorie de paiement incertaine.')
  }

  const confidence =
    (memberMatch ? memberMatch.score * 0.4 : 0) +
    (period ? 0.3 : 0) +
    (amountCents ? 0.2 : 0) +
    (purpose !== 'unknown' ? 0.1 : 0)

  return {
    id: `proof-${normalize(input.fileName).replace(/\s+/g, '-') || Date.now()}`,
    fileName: input.fileName,
    fileType,
    sizeBytes: input.sizeBytes ?? 0,
    member: memberMatch?.member,
    period,
    amountCents,
    purpose,
    confidence: Math.round(confidence * 100),
    status: !supported ? 'unsupported' : reasons.length === 0 ? 'ready' : 'needs_review',
    reasons,
  }
}

export function summarizeProofCandidates(candidates: ProofCandidate[]): ProofTriageSummary {
  return {
    total: candidates.length,
    ready: candidates.filter((candidate) => candidate.status === 'ready').length,
    needsReview: candidates.filter((candidate) => candidate.status === 'needs_review').length,
    unsupported: candidates.filter((candidate) => candidate.status === 'unsupported').length,
  }
}
