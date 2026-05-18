import { expect, test } from '@playwright/test'

test('IKIMINA dashboard loads and navigates to monthly encoding', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible()
  await expect(page.getByText('IKIMINA 2025-2026')).toBeVisible()

  await page.getByRole('button', { name: /Encodage mensuel/ }).click()
  await expect(page.getByRole('heading', { name: 'Encodage mensuel' })).toBeVisible()
  await expect(page.getByRole('table')).toBeVisible()
})
