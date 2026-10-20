// Optional local smoke test against a running `dsh web`.
//
// Opens an EXISTING Session (the web client has no per-Session URL route, so
// the script clicks its row in the left session list), clicks the header
// top-right toggle, and screenshots the docked card at 1440x900 in light and
// dark. No API key is needed: the Session only has to exist.
//
//   PLAYWRIGHT=/path/to/node_modules/playwright \
//   DSH_URL='http://127.0.0.1:3080/?token=…' \
//   SESSION_TITLE='/agent-experience 列出可用技能' \
//     node scripts/e2e-screenshot.mjs [outDir]
//
// SESSION_TITLE (substring of the row text) picks the Session; without it the
// first row in the session list is opened. Not part of the build; playwright
// is not a dependency of this package.

import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright')
const url = process.env.DSH_URL
if (!url) throw new Error('set DSH_URL to the tokenized dsh web URL')
const out = resolve(process.argv[2] ?? 'docs/screenshots')
await mkdir(out, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: Number(process.env.DPR ?? 1),
  locale: process.env.LOCALE ?? 'zh-CN',
  colorScheme: 'light',
})
// Start every run from a closed card so the toggle click is what opens it.
await context.addInitScript(() => {
  try { localStorage.setItem('dsh-session-capabilities.open.v1', '0') } catch {}
})
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(String(error)))
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
// Not 'networkidle': the client keeps long polls open.
await page.goto(url, { waitUntil: 'load' })
await page.waitForTimeout(3_000)

// Dismiss the preview notice / "Get started" dialog (no API key is needed).
const notice = page.getByRole('button', { name: /^(继续|Continue)$/ })
if (await notice.count()) await notice.first().click()
if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape')

// Open the existing Session from the session list.
const title = process.env.SESSION_TITLE
const row = title
  ? page.getByText(title, { exact: false }).first()
  : page.locator('[data-session-id], [role="listitem"]').first()
// Sessions sit inside collapsible workspace groups; expand them until the row shows.
for (const group of await page.getByText(/^(未分组|Ungrouped)$/).all()) {
  if (await row.isVisible().catch(() => false)) break
  await group.click()
  await page.waitForTimeout(500)
}
await row.waitFor({ timeout: 20_000 })
await row.click()

const toggle = page.getByRole('button', { name: /会话能力|Session capabilities/ }).first()
await toggle.waitFor({ timeout: 30_000 })
await toggle.click()
const card = page.locator('.dshsc-card').first()
await card.waitFor({ timeout: 15_000 })
await page.waitForFunction(() => document.querySelector('.dshsc-summary') !== null, null, { timeout: 15_000 })
await page.waitForTimeout(1_500)
// Expand the first collapsed healthy server so tool chips show (the failed one opens itself).
const healthy = page.locator('button.dshsc-row[aria-expanded="false"]').first()
if (await healthy.count()) await healthy.click()
await page.mouse.move(0, 0)
await page.waitForTimeout(400)
await page.screenshot({ path: resolve(out, 'light.png') })

await page.emulateMedia({ colorScheme: 'dark' })
await page.waitForTimeout(800)
await page.screenshot({ path: resolve(out, 'dark.png') })

// The same toggle closes the column again.
await toggle.click()
await page.waitForTimeout(800)
console.log('card visible after second toggle:', await page.locator('.dshsc-card').isVisible().catch(() => false))
console.log('page errors:', errors.filter(e => !/favicon/.test(e)).slice(0, 10))
await browser.close()
