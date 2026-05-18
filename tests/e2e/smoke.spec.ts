import { expect, test } from '@playwright/test'

test('IKIMINA dashboard loads and navigates to monthly encoding', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1, name: 'Tableau de bord' })).toBeVisible()
  await expect(page.getByText('IKIMINA 2025-2026')).toBeVisible()

  await page.getByRole('link', { name: /Encodage mensuel/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Encodage mensuel' })).toBeVisible()
  await expect(page.getByRole('table')).toBeVisible()
})

test('member links open Membre 360 history', async ({ page }) => {
  await page.goto('/#/members')

  await page.getByRole('link', { name: 'NTACYOBITWAYE FRANCOISE' }).click()

  await expect(
    page.getByRole('heading', { level: 1, name: 'NTACYOBITWAYE FRANCOISE' }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Historique mensuel' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Assurance payee' })).toBeVisible()
})

test('month links open Mois 360 with collective controls', async ({ page }) => {
  await page.goto('/#/exploration')

  await page.getByRole('link', { name: 'JUIN 2025' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'JUIN 2025' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Controle collectif' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Fonds collectifs/ }).first()).toBeVisible()
})

test('contribution matrix supports member, month and status triage', async ({ page }) => {
  await page.goto('/#/cotisations')

  await expect(page.getByRole('heading', { level: 1, name: 'Cotisations' })).toBeVisible()
  await expect(page.locator('.matrix-table tbody tr')).toHaveCount(15)
  await page.getByLabel('Membre').fill('IBAMBASI')
  await expect(page.locator('.matrix-table tbody tr')).toHaveCount(1)
  await page.locator('.filter-row').getByLabel('Mois').selectOption('period-2026-04')
  await expect(page.getByRole('link', { name: 'AVRIL 2026' })).toBeVisible()
})

test('collective funds view exposes Salesforce-like triage', async ({ page }) => {
  await page.goto('/#/collective')

  await expect(page.getByRole('heading', { level: 1, name: 'Fonds collectifs' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Triage des mois' })).toBeVisible()
  await page.getByLabel('Vue').selectOption('closed')
  await page.getByLabel('Tri').selectOption('month-desc')
  await expect(page.getByRole('link', { name: 'AVRIL 2026' })).toBeVisible()
})

test('rotation calendar explains beneficiary exemptions', async ({ page }) => {
  await page.goto('/#/rotation')

  await expect(page.getByRole('heading', { level: 1, name: 'Rotation tontine' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Calendrier de Rotation' })).toBeVisible()
  await expect(page.getByText('NTACYOBITWAYE FRANCOISE')).toBeVisible()
  await expect(page.getByText('Prediction automatique').first()).toBeVisible()
})

test('proof loader triages local transfer evidence', async ({ page }) => {
  await page.goto('/#/imports')

  await expect(page.getByRole('heading', { level: 1, name: 'Import & preuves' })).toBeVisible()
  await page.locator('input[type="file"]').setInputFiles({
    name: 'preuve-IBAMBASI-ANTOINE-janvier-2026-125-eur.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(''),
  })

  await expect(page.getByRole('cell', { name: /IBAMBASI ANTOINE/ })).toBeVisible()
  await expect(page.getByRole('cell', { name: /JANVIER 2026/ })).toBeVisible()
  await expect(page.getByText('Cotisation + epargne + assurance')).toBeVisible()
})

test('browser back returns to the same month detail', async ({ page }) => {
  await page.goto('/#/mois/period-2026-04')

  await expect(page.getByRole('heading', { level: 1, name: 'AVRIL 2026' })).toBeVisible()
  await page.locator('.detail-hero').getByRole('link', { name: /Cotisations/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Cotisations' })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { level: 1, name: 'AVRIL 2026' })).toBeVisible()
})
