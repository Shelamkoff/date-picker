import assert from 'node:assert/strict'
import { chromium, firefox, webkit } from '@playwright/test'

const browserName = process.env.BROWSER ?? 'chromium'
const browserType = { chromium, firefox, webkit }[browserName]
if (!browserType) throw new Error(`Unsupported browser: ${browserName}`)

const browser = await browserType.launch()
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  reducedMotion: 'no-preference',
})
const page = await context.newPage()
const runtimeErrors = []
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.stack ?? error.message}`))
page.on('console', message => {
  if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`)
})

const baseUrl = process.env.AUDIT_URL ?? 'http://127.0.0.1:4173/index.html'
await page.goto(baseUrl, { waitUntil: 'networkidle' })
await page.waitForSelector('#hero-picker .sdp-datepicker__trigger')

await page.evaluate(() => {
  document.body.style.minHeight = '3200px'
  window.__datePickerAudit = { pickers: {}, events: {} }
})

async function createPicker(id, source) {
  await page.evaluate(async ({ id, source }) => {
    const { DatePicker } = await import('./dist/index.js')
    const host = document.createElement('div')
    host.id = id
    host.style.width = '360px'
    host.style.margin = '16px'
    document.body.prepend(host)
    const events = []
    const options = (0, eval)(source)
    options.onChange = (value, reason) => {
      events.push({ time: value?.getTime() ?? null, reason })
    }
    const picker = new DatePicker(host, options)
    window.__datePickerAudit.pickers[id] = picker
    window.__datePickerAudit.events[id] = events
  }, { id, source })
}

async function openPicker(id) {
  await page.locator(`#${id} .sdp-datepicker__trigger`).click()
  await page.waitForFunction(id => {
    const popover = document.querySelector(`#${id} .sdp-datepicker__popover`)
    return popover && !popover.hidden
  }, id)
}

async function dispatchWheel(selector, deltaY, count = 1, interval = 0) {
  await page.evaluate(async ({ selector, deltaY, count, interval }) => {
    const target = document.querySelector(selector)
    if (!target) throw new Error(`Missing wheel: ${selector}`)
    for (let index = 0; index < count; index += 1) {
      target.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        deltaY,
      }))
      if (interval > 0) await new Promise(resolve => setTimeout(resolve, interval))
    }
  }, { selector, deltaY, count, interval })
}

// Demo smoke test and baseline accessibility state.
await page.locator('#hero-picker .sdp-datepicker__trigger').click()
assert.equal(await page.locator('#hero-picker .sdp-datepicker__popover').getAttribute('role'), 'dialog')
assert.equal(await page.locator('#hero-picker .sdp-wheel').first().getAttribute('role'), 'listbox')
assert.ok(await page.locator('#hero-picker .sdp-wheel').first().getAttribute('aria-activedescendant'))
await page.keyboard.press('Escape')
assert.equal(await page.locator('#hero-picker .sdp-datepicker__popover').evaluate(node => node.hidden), true)

// Deterministic keyboard, wheel, settle and re-input behavior.
await createPicker('audit-main', `({
  value: new Date(2026, 5, 15, 12, 30, 45, 900),
  enableTime: true,
  minuteStep: 5,
  loop: true,
  clearable: true,
  showNow: true,
  pastYears: 2,
  futureYears: 2,
  ariaLabel: 'Audit picker'
})`)
await openPicker('audit-main')
const dayWheel = page.locator('#audit-main .sdp-wheel[aria-label="Day"]')
await dayWheel.press('ArrowDown')
assert.equal(await page.evaluate(() => window.__datePickerAudit.pickers['audit-main'].value.getDate()), 16)

const minuteSelector = '#audit-main .sdp-wheel[aria-label="Minutes"]'
const beforeStress = await page.evaluate(() => window.__datePickerAudit.events['audit-main'].length)
await dispatchWheel(minuteSelector, 100, 300)
await page.waitForTimeout(500)
const stressState = await page.evaluate(() => {
  const wheel = document.querySelector('#audit-main .sdp-wheel[aria-label="Minutes"]')
  const picker = window.__datePickerAudit.pickers['audit-main']
  return {
    events: window.__datePickerAudit.events['audit-main'].length,
    scrollTop: wheel.scrollTop,
    scrollHeight: wheel.scrollHeight,
    clientHeight: wheel.clientHeight,
    value: picker.value.getTime(),
  }
})
assert.ok(Number.isFinite(stressState.scrollTop))
assert.ok(stressState.scrollTop >= 0)
assert.ok(stressState.scrollTop <= stressState.scrollHeight - stressState.clientHeight + 1)
assert.ok(Number.isFinite(stressState.value))
assert.ok(stressState.events <= beforeStress + 1, `stress emitted ${stressState.events - beforeStress} changes`)

const beforeReinput = await page.evaluate(() => window.__datePickerAudit.events['audit-main'].length)
await dispatchWheel(minuteSelector, 100)
await page.waitForTimeout(105)
await dispatchWheel(minuteSelector, 100)
await page.waitForTimeout(500)
const afterReinput = await page.evaluate(() => window.__datePickerAudit.events['audit-main'].length)
assert.equal(afterReinput, beforeReinput + 1, 're-input during snap must commit once')

// Exact loop wrap across a three-day bounded range.
await createPicker('audit-loop', `(() => {
  const minDate = new Date(2026, 0, 1)
  minDate.setHours(0, 0, 0, 0)
  const maxDate = new Date(2026, 0, 3)
  maxDate.setHours(0, 0, 0, 0)
  return {
    value: maxDate,
    minDate,
    maxDate,
    loop: true,
    pastYears: 0,
    futureYears: 0,
    ariaLabel: 'Loop picker'
  }
})()`)
await openPicker('audit-loop')
await dispatchWheel('#audit-loop .sdp-wheel[aria-label="Day"]', 120)
await page.waitForTimeout(450)
assert.equal(await page.evaluate(() => window.__datePickerAudit.pickers['audit-loop'].value.getDate()), 1)

// A non-looping one-value wheel must release the page scroll at its edge.
await createPicker('audit-edge', `(() => {
  const value = new Date(2026, 0, 2)
  value.setHours(0, 0, 0, 0)
  return {
    value,
    minDate: value,
    maxDate: value,
    loop: false,
    pastYears: 0,
    futureYears: 0,
    ariaLabel: 'Edge picker'
  }
})()`)
await openPicker('audit-edge')
const edgeWheel = page.locator('#audit-edge .sdp-wheel[aria-label="Day"]')
await edgeWheel.scrollIntoViewIfNeeded()
const edgeBox = await edgeWheel.boundingBox()
assert.ok(edgeBox)
const edgeScrollBefore = await page.evaluate(() => window.scrollY)
await page.mouse.move(edgeBox.x + edgeBox.width / 2, edgeBox.y + edgeBox.height / 2)
await page.mouse.wheel(0, 500)
await page.waitForTimeout(120)
assert.ok(
  await page.evaluate(before => window.scrollY > before, edgeScrollBefore),
  'edge wheel trapped page scrolling',
)

// A looping wheel consumes the wheel gesture rather than moving the page.
const loopWheel = page.locator('#audit-loop .sdp-wheel[aria-label="Day"]')
await loopWheel.scrollIntoViewIfNeeded()
const loopBox = await loopWheel.boundingBox()
assert.ok(loopBox)
const loopScrollBefore = await page.evaluate(() => window.scrollY)
await page.mouse.move(loopBox.x + loopBox.width / 2, loopBox.y + loopBox.height / 2)
await page.mouse.wheel(0, 120)
await page.waitForTimeout(120)
assert.ok(
  await page.evaluate(before => Math.abs(window.scrollY - before) < 2, loopScrollBefore),
  'looping wheel leaked page scrolling',
)
await page.waitForTimeout(400)

// Shadow DOM: focus, selection and composed change event must cross the boundary.
const shadowResult = await page.evaluate(async () => {
  const { DatePicker } = await import('./dist/index.js')
  const shell = document.createElement('section')
  document.body.prepend(shell)
  const shadow = shell.attachShadow({ mode: 'open' })
  const host = document.createElement('div')
  shadow.append(host)
  let composedEvents = 0
  const listener = event => {
    if (event.target === host) composedEvents += 1
  }
  document.addEventListener('date-picker-change', listener)
  const picker = new DatePicker(host, {
    value: new Date(2026, 3, 10),
    loop: true,
    pastYears: 0,
    futureYears: 0,
  })
  picker.open()
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const wheel = shadow.querySelector('.sdp-wheel[aria-label="Day"]')
  wheel.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
  await Promise.resolve()
  const result = {
    open: picker.isOpen,
    day: picker.value.getDate(),
    composedEvents,
    activeInside: shadow.activeElement === wheel,
  }
  picker.destroy()
  document.removeEventListener('date-picker-change', listener)
  shell.remove()
  return result
})
assert.equal(shadowResult.open, true)
assert.equal(shadowResult.day, 11)
assert.equal(shadowResult.composedEvents, 1)
assert.equal(shadowResult.activeInside, true)

// Popup flip and collision correction near the lower-right viewport edge.
const popupRect = await page.evaluate(async () => {
  const { DatePicker } = await import('./dist/index.js')
  const host = document.createElement('div')
  Object.assign(host.style, {
    position: 'fixed',
    right: '2px',
    bottom: '2px',
    width: '330px',
    zIndex: '1000',
  })
  document.body.append(host)
  const picker = new DatePicker(host, {
    value: new Date(2026, 6, 15, 12, 30),
    enableTime: true,
    minuteStep: 5,
    loop: true,
  })
  picker.open()
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const popover = host.querySelector('.sdp-datepicker__popover')
  const rect = popover.getBoundingClientRect()
  const result = {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
    openedUp: popover.style.bottom !== '',
  }
  picker.destroy()
  host.remove()
  return result
})
assert.equal(popupRect.openedUp, true)
assert.ok(popupRect.left >= 7)
assert.ok(popupRect.right <= popupRect.viewportWidth - 7)
assert.ok(popupRect.top >= -1)
assert.ok(popupRect.bottom <= popupRect.viewportHeight + 1)

// Clear restores trigger focus and destroy releases the DOM subtree safely.
await page.locator('#audit-main .sdp-datepicker__clear').click()
await page.waitForTimeout(0)
assert.equal(await page.locator('#audit-main .sdp-datepicker__popover').evaluate(node => node.hidden), true)
assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('sdp-datepicker__trigger')), true)
await page.evaluate(() => {
  const picker = window.__datePickerAudit.pickers['audit-main']
  picker.destroy()
  window.dispatchEvent(new Event('resize'))
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
})
assert.equal(await page.locator('#audit-main .sdp-datepicker').count(), 0)

// Opening the maximum documented year window should stay responsive.
const openDuration = await page.evaluate(async () => {
  const { DatePicker } = await import('./dist/index.js')
  const host = document.createElement('div')
  host.style.width = '360px'
  document.body.append(host)
  const picker = new DatePicker(host, {
    value: new Date(2026, 0, 1),
    pastYears: 200,
    futureYears: 200,
    loop: true,
  })
  const started = performance.now()
  picker.open()
  await new Promise(resolve => requestAnimationFrame(resolve))
  const duration = performance.now() - started
  const options = host.querySelectorAll('.sdp-wheel__option').length
  picker.destroy()
  host.remove()
  return { duration, options }
})
assert.ok(openDuration.duration < 1500, `opening took ${openDuration.duration.toFixed(1)} ms`)
assert.ok(openDuration.options < 1400, `rendered ${openDuration.options} wheel options`)

assert.deepEqual(runtimeErrors, [], runtimeErrors.join('\n'))
console.log(JSON.stringify({ browser: browserName, openDuration }, null, 2))
await browser.close()
