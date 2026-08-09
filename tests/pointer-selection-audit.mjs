import assert from 'node:assert/strict'
import { chromium, firefox, webkit } from '@playwright/test'

const browserName = process.env.BROWSER ?? 'chromium'
const browserType = { chromium, firefox, webkit }[browserName]
if (!browserType) throw new Error(`Unsupported browser: ${browserName}`)

const browser = await browserType.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', error => errors.push(`pageerror: ${error.stack ?? error.message}`))
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`)
})

await page.goto(process.env.AUDIT_URL ?? 'http://127.0.0.1:4173/index.html', { waitUntil: 'networkidle' })
await page.evaluate(async () => {
  const { DatePicker } = await import('./dist/index.js')
  const host = document.createElement('div')
  host.id = 'pointer-audit'
  host.style.width = '360px'
  document.body.prepend(host)
  const changes = []
  const picker = new DatePicker(host, {
    value: new Date(2026, 5, 15, 12, 30),
    enableTime: true,
    minuteStep: 5,
    loop: false,
    showNow: true,
    pastYears: 2,
    futureYears: 3,
    now: () => new Date(2028, 1, 3, 14, 45),
    onChange(value, reason) {
      changes.push({ value: value?.getTime() ?? null, reason })
    },
  })
  window.__pointerAudit = { picker, changes }
  picker.open()
})

const popover = page.locator('#pointer-audit .sdp-datepicker__popover')
await popover.waitFor({ state: 'visible' })

function optionFor(label, value) {
  return page.locator(`#pointer-audit .sdp-wheel[aria-label="${label}"] [role="option"][data-value="${value}"]`)
}

async function clickOption(label, value, assertion) {
  await optionFor(label, value).click()
  assert.equal(await popover.evaluate(node => !node.hidden), true, `${label} click closed the popover`)
  await assertion()
}

async function holdAndClickOption(label, value, assertion) {
  const option = optionFor(label, value)
  await option.scrollIntoViewIfNeeded()
  const box = await option.boundingBox()
  assert.ok(box)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(150)
  assert.equal(await popover.evaluate(node => !node.hidden), true, `${label} pointerdown closed the popover`)
  await page.mouse.up()
  assert.equal(await popover.evaluate(node => !node.hidden), true, `${label} click closed the popover`)
  await assertion()
}

await holdAndClickOption('Month', 7, async () => {
  assert.equal(await page.evaluate(() => window.__pointerAudit.picker.value.getMonth() + 1), 7)
})
await clickOption('Year', 2027, async () => {
  assert.equal(await page.evaluate(() => window.__pointerAudit.picker.value.getFullYear()), 2027)
})
await clickOption('Hours', 13, async () => {
  assert.equal(await page.evaluate(() => window.__pointerAudit.picker.value.getHours()), 13)
})
await clickOption('Minutes', 35, async () => {
  assert.equal(await page.evaluate(() => window.__pointerAudit.picker.value.getMinutes()), 35)
})

await page.locator('#pointer-audit .sdp-datepicker__now').click()
assert.equal(await popover.evaluate(node => !node.hidden), true, 'Now click closed the popover')
const nowState = await page.evaluate(() => {
  const value = window.__pointerAudit.picker.value
  return {
    year: value.getFullYear(),
    month: value.getMonth() + 1,
    day: value.getDate(),
    hour: value.getHours(),
    minute: value.getMinutes(),
    reasons: window.__pointerAudit.changes.map(change => change.reason),
  }
})
assert.deepEqual(nowState, {
  year: 2028,
  month: 2,
  day: 3,
  hour: 14,
  minute: 45,
  reasons: ['select', 'select', 'select', 'select', 'now'],
})

assert.deepEqual(errors, [], errors.join('\n'))
console.log(JSON.stringify({ browser: browserName, nowState }, null, 2))
await browser.close()
