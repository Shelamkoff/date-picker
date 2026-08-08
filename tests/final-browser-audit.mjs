import assert from 'node:assert/strict'
import { chromium, firefox, webkit } from '@playwright/test'

const browserName = process.env.BROWSER ?? 'chromium'
const browserType = { chromium, firefox, webkit }[browserName]
if (!browserType) throw new Error(`Unsupported browser: ${browserName}`)

const browser = await browserType.launch()
const baseUrl = process.env.AUDIT_URL ?? 'http://127.0.0.1:4173/index.html'

async function installAuditHooks(page) {
  const errors = []
  page.on('pageerror', error => errors.push(`pageerror: ${error.stack ?? error.message}`))
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  page.on('requestfailed', request => {
    errors.push(`requestfailed: ${request.url()} — ${request.failure()?.errorText ?? 'unknown'}`)
  })
  return errors
}

async function createPicker(page, id, source, style = {}) {
  await page.evaluate(async ({ id, source, style }) => {
    const { DatePicker } = await import('./dist/index.js')
    window.__finalAudit ??= { pickers: {}, changes: {} }
    const host = document.createElement('div')
    host.id = id
    Object.assign(host.style, { width: '360px', margin: '16px', ...style })
    document.body.prepend(host)
    const changes = []
    const options = (0, eval)(source)
    options.onChange = (value, reason) => {
      changes.push({ instant: value?.getTime() ?? null, reason })
    }
    const picker = new DatePicker(host, options)
    window.__finalAudit.pickers[id] = picker
    window.__finalAudit.changes[id] = changes
  }, { id, source, style })
}

async function openPicker(page, id) {
  await page.evaluate(id => window.__finalAudit.pickers[id].open(), id)
  await page.waitForFunction(id => {
    const popover = document.querySelector(`#${id} .sdp-datepicker__popover`)
    return popover && !popover.hidden
  }, id)
}

async function dispatchWheel(page, selector, deltaY, count = 1, interval = 0) {
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

async function readThemeState(page) {
  return page.evaluate(() => {
    const host = document.querySelector('#hero-picker')
    const control = host.querySelector('.sdp-datepicker__control')
    return {
      className: host.className,
      variable: getComputedStyle(host).getPropertyValue('--sdp-control-bg').trim(),
      background: getComputedStyle(control).backgroundColor,
      bodyClassName: document.body.className,
      buttonText: document.querySelector('#theme-toggle').textContent,
    }
  })
}

const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  reducedMotion: 'no-preference',
})
const page = await context.newPage()
const errors = await installAuditHooks(page)
await page.goto(baseUrl, { waitUntil: 'networkidle' })
await page.waitForSelector('#hero-picker .sdp-datepicker__trigger')
await page.evaluate(() => { document.body.style.minHeight = '4200px' })

// The real demo must load its built module and stylesheet without hidden 404s.
const demoState = await page.evaluate(() => {
  const control = document.querySelector('#hero-picker .sdp-datepicker__control')
  const trigger = document.querySelector('#hero-picker .sdp-datepicker__trigger')
  return {
    controlBackground: getComputedStyle(control).backgroundColor,
    triggerText: trigger.textContent.trim(),
    styleSheets: [...document.styleSheets].map(sheet => sheet.href).filter(Boolean),
  }
})
assert.notEqual(demoState.controlBackground, 'rgba(0, 0, 0, 0)')
assert.ok(demoState.triggerText.length > 0)
assert.ok(demoState.styleSheets.some(url => url.endsWith('/style.css')))

// Built-in light theme must actually change picker surfaces.
const darkTheme = await readThemeState(page)
await page.locator('#theme-toggle').click()
await page.waitForFunction(() => document.querySelector('#hero-picker')?.classList.contains('sdp-theme-light'))
await page.waitForTimeout(180)
const lightTheme = await readThemeState(page)
console.log(JSON.stringify({ theme: { darkTheme, lightTheme } }, null, 2))
assert.notEqual(lightTheme.variable, darkTheme.variable)
assert.notEqual(lightTheme.background, darkTheme.background)
await page.locator('#theme-toggle').click()
await page.waitForFunction(() => !document.querySelector('#hero-picker')?.classList.contains('sdp-theme-light'))
await page.waitForTimeout(180)

// Baseline semantics and keyboard selection.
await page.locator('#hero-picker .sdp-datepicker__trigger').click()
const firstWheel = page.locator('#hero-picker .sdp-wheel').first()
assert.equal(await firstWheel.getAttribute('role'), 'listbox')
assert.ok(await firstWheel.getAttribute('aria-activedescendant'))
assert.equal(await page.locator('#hero-picker .sdp-datepicker__popover').getAttribute('role'), 'dialog')
await page.keyboard.press('Escape')
assert.equal(await page.locator('#hero-picker .sdp-datepicker__popover').evaluate(node => node.hidden), true)
assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('sdp-datepicker__trigger')), true)

// Heavy wheel bursts must settle once, stay finite and accept new input during snap.
await createPicker(page, 'audit-stress', `({
  value: new Date(2026, 5, 15, 12, 30, 45, 900),
  enableTime: true,
  minuteStep: 5,
  loop: true,
  clearable: true,
  showNow: true,
  pastYears: 4,
  futureYears: 4,
  ariaLabel: 'Stress picker'
})`)
await openPicker(page, 'audit-stress')
const minuteSelector = '#audit-stress .sdp-wheel[aria-label="Minutes"]'
await dispatchWheel(page, minuteSelector, 100, 500)
await page.waitForTimeout(650)
const stress = await page.evaluate(() => {
  const picker = window.__finalAudit.pickers['audit-stress']
  const wheel = document.querySelector('#audit-stress .sdp-wheel[aria-label="Minutes"]')
  return {
    changes: window.__finalAudit.changes['audit-stress'].length,
    value: picker.value?.getTime(),
    scrollTop: wheel.scrollTop,
    maxScroll: wheel.scrollHeight - wheel.clientHeight,
  }
})
assert.ok(Number.isFinite(stress.value))
assert.ok(Number.isFinite(stress.scrollTop))
assert.ok(stress.scrollTop >= 0 && stress.scrollTop <= stress.maxScroll + 1)
assert.ok(stress.changes <= 1, `burst produced ${stress.changes} changes`)

const changesBeforeReinput = stress.changes
await dispatchWheel(page, minuteSelector, 100)
await page.waitForTimeout(110)
await dispatchWheel(page, minuteSelector, 100)
await page.waitForTimeout(550)
const changesAfterReinput = await page.evaluate(() => window.__finalAudit.changes['audit-stress'].length)
assert.equal(changesAfterReinput, changesBeforeReinput + 1)

// A bounded loop wraps from the final value to the first.
await createPicker(page, 'audit-loop', `(() => {
  const minDate = new Date(2026, 0, 1)
  minDate.setHours(0, 0, 0, 0)
  const maxDate = new Date(2026, 0, 3)
  maxDate.setHours(0, 0, 0, 0)
  return { value: maxDate, minDate, maxDate, loop: true, pastYears: 0, futureYears: 0 }
})()`)
await openPicker(page, 'audit-loop')
await dispatchWheel(page, '#audit-loop .sdp-wheel[aria-label="Day"]', 120)
await page.waitForTimeout(500)
assert.equal(await page.evaluate(() => window.__finalAudit.pickers['audit-loop'].value.getDate()), 1)

// A non-looping wheel at its only value must release scrolling to the page.
await createPicker(page, 'audit-edge', `(() => {
  const value = new Date(2026, 0, 2)
  value.setHours(0, 0, 0, 0)
  return { value, minDate: value, maxDate: value, pastYears: 0, futureYears: 0 }
})()`)
await openPicker(page, 'audit-edge')
const edgeWheel = page.locator('#audit-edge .sdp-wheel[aria-label="Day"]')
await edgeWheel.scrollIntoViewIfNeeded()
const edgeBox = await edgeWheel.boundingBox()
assert.ok(edgeBox)
const pageScrollBefore = await page.evaluate(() => window.scrollY)
await page.mouse.move(edgeBox.x + edgeBox.width / 2, edgeBox.y + edgeBox.height / 2)
await page.mouse.wheel(0, 500)
await page.waitForTimeout(150)
assert.ok(await page.evaluate(before => window.scrollY > before, pageScrollBefore), 'edge wheel trapped page scrolling')

// A looping wheel must consume the gesture instead of scrolling the page.
await openPicker(page, 'audit-loop')
const loopWheel = page.locator('#audit-loop .sdp-wheel[aria-label="Day"]')
await loopWheel.scrollIntoViewIfNeeded()
const loopBox = await loopWheel.boundingBox()
assert.ok(loopBox)
const loopScrollBefore = await page.evaluate(() => window.scrollY)
await page.mouse.move(loopBox.x + loopBox.width / 2, loopBox.y + loopBox.height / 2)
await page.mouse.wheel(0, 120)
await page.waitForTimeout(150)
assert.ok(await page.evaluate(before => Math.abs(window.scrollY - before) < 2, loopScrollBefore), 'looping wheel leaked page scrolling')
await page.waitForTimeout(450)

// Shadow DOM focus and composed events must cross the boundary safely.
const shadowResult = await page.evaluate(async () => {
  const { DatePicker } = await import('./dist/index.js')
  const shell = document.createElement('section')
  document.body.prepend(shell)
  const shadow = shell.attachShadow({ mode: 'open' })
  const host = document.createElement('div')
  shadow.append(host)
  let events = 0
  const listener = event => {
    if (event.composedPath().includes(host)) events += 1
  }
  document.addEventListener('date-picker-change', listener)
  const picker = new DatePicker(host, { value: new Date(2026, 3, 10), loop: true, pastYears: 0, futureYears: 0 })
  picker.open()
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const wheel = shadow.querySelector('.sdp-wheel[aria-label="Day"]')
  wheel.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
  await Promise.resolve()
  const result = {
    day: picker.value.getDate(),
    events,
    focused: shadow.activeElement === wheel,
  }
  picker.destroy()
  document.removeEventListener('date-picker-change', listener)
  shell.remove()
  return result
})
assert.deepEqual(shadowResult, { day: 11, events: 1, focused: true })

// Clear closes, emits once and restores focus; destroy releases the subtree.
await page.locator('#audit-stress .sdp-datepicker__clear').click()
await page.waitForTimeout(0)
assert.equal(await page.locator('#audit-stress .sdp-datepicker__popover').evaluate(node => node.hidden), true)
assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('sdp-datepicker__trigger')), true)
assert.equal(await page.evaluate(() => window.__finalAudit.changes['audit-stress'].at(-1)?.reason), 'clear')
await page.evaluate(() => {
  window.__finalAudit.pickers['audit-stress'].destroy()
  window.dispatchEvent(new Event('resize'))
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
})
assert.equal(await page.locator('#audit-stress .sdp-datepicker').count(), 0)

assert.deepEqual(errors, [], errors.join('\n'))
await context.close()

// Reduced-motion users must receive an immediate, stable wheel position.
const reducedContext = await browser.newContext({
  viewport: { width: 800, height: 600 },
  reducedMotion: 'reduce',
})
const reducedPage = await reducedContext.newPage()
const reducedErrors = await installAuditHooks(reducedPage)
await reducedPage.goto(baseUrl, { waitUntil: 'networkidle' })
await createPicker(reducedPage, 'audit-reduced', `({
  value: new Date(2026, 0, 1, 12, 0),
  enableTime: true,
  minuteStep: 5,
  loop: true
})`)
await openPicker(reducedPage, 'audit-reduced')
await dispatchWheel(reducedPage, '#audit-reduced .sdp-wheel[aria-label="Minutes"]', 100)
await reducedPage.waitForTimeout(160)
assert.equal(await reducedPage.evaluate(() => window.__finalAudit.changes['audit-reduced'].length), 1)
assert.deepEqual(reducedErrors, [], reducedErrors.join('\n'))
await reducedContext.close()

// On a short viewport the popup must remain fully reachable instead of escaping above or below it.
const compactContext = await browser.newContext({ viewport: { width: 390, height: 320 } })
const compactPage = await compactContext.newPage()
const compactErrors = await installAuditHooks(compactPage)
await compactPage.goto(baseUrl, { waitUntil: 'networkidle' })
await createPicker(compactPage, 'audit-compact', `({
  value: new Date(2026, 6, 15, 12, 30),
  enableTime: true,
  minuteStep: 5,
  loop: true,
  showNow: true
})`, {
  position: 'fixed',
  left: '24px',
  top: '145px',
  width: '320px',
  zIndex: '1000',
})
await openPicker(compactPage, 'audit-compact')
await compactPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const compactRect = await compactPage.locator('#audit-compact .sdp-datepicker__popover').evaluate(node => {
  const rect = node.getBoundingClientRect()
  return {
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
  }
})
assert.ok(compactRect.left >= 7, `popover left edge is ${compactRect.left}`)
assert.ok(compactRect.right <= compactRect.viewportWidth - 7, `popover right edge is ${compactRect.right}`)
assert.ok(compactRect.top >= 7, `popover top edge is ${compactRect.top}`)
assert.ok(compactRect.bottom <= compactRect.viewportHeight - 7, `popover bottom edge is ${compactRect.bottom}`)
assert.deepEqual(compactErrors, [], compactErrors.join('\n'))
await compactContext.close()

console.log(JSON.stringify({ browser: browserName, compactRect }, null, 2))
await browser.close()
