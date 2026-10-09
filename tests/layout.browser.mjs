import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

// Visual regression probe for the real demo and its bundled CSS.
// Screenshots are uploaded as CI artifacts, not committed to the repository.
const browser = await chromium.launch()
const output = 'layout-audit'
mkdirSync(output, { recursive: true })
const failures = []
const metrics = []
try {
  const page = await browser.newPage({ deviceScaleFactor: 1, reducedMotion: 'reduce' })
  page.on('pageerror', error => failures.push('JavaScript: ' + error.message))
  for (const width of [320, 375, 768, 900, 1280]) {
    await page.setViewportSize({ width, height: width <= 375 ? 640 : 850 })
    await page.goto(process.env.AUDIT_URL ?? 'http://127.0.0.1:4173/index.html', { waitUntil: 'networkidle' })
    for (const theme of ['dark', 'light']) {
      if (theme === 'light') {
        const toggle = page.locator('#theme-toggle')
        if (!(await toggle.isVisible())) failures.push(`Theme toggle hidden at ${width}`)
        else await toggle.click()
      }
      await page.locator('#calendar-modes').scrollIntoViewIfNeeded()
      await page.screenshot({ path: `${output}/${width}-${theme}-calendar.png` })
      const base = await page.evaluate(() => {
        const box = selector => {
          const node = document.querySelector(selector)
          if (!node) return null
          const rect = node.getBoundingClientRect()
          return { x: rect.left, y: rect.top, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom }
        }
        return {
          windowWidth: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
          live: box('#cal-live'),
          liveRegion: box('.calendar-live'),
          example: box('.calendar-examples .demo-panel'),
          sampleFont: getComputedStyle(document.querySelector('#calendar-single .sdp-datepicker__value')).fontSize,
        }
      })
      if (base.scrollWidth > width + 1) {
        const overflowing = await page.evaluate(() => [...document.querySelectorAll('*')]
          .map(node => {
            const rect = node.getBoundingClientRect()
            const style = getComputedStyle(node)
            return { node: node.tagName.toLowerCase(), id: node.id, className: typeof node.className === 'string' ? node.className.slice(0, 80) : '',
              x: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), overflow: style.overflowX,
              scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, display: style.display }
          })
          .filter(item => item.right > innerWidth + 2 && item.width > 0 && item.display !== 'none')
          .sort((a, b) => b.right - a.right).slice(0, 15))
        failures.push(`Horizontal document overflow at ${width}/${theme}: ${base.scrollWidth}; offenders ${JSON.stringify(overflowing)}`)
      }
      await page.locator('#cal-mode').selectOption('range')
      await page.locator('#cal-inline').check()
      await page.locator('#cal-week').check()
      await page.locator('#cal-live').scrollIntoViewIfNeeded()
      const inline = await page.evaluate(() => {
        const view = document.querySelector('#cal-live .sdp-datepicker__calendar-popover')
        const first = document.querySelector('#cal-live .sdp-calendar__week')
        const rect = view.getBoundingClientRect()
        const days = [...document.querySelectorAll('#cal-live .sdp-calendar__day')]
        const widths = days.map(x => x.getBoundingClientRect().width)
        return {
          width: rect.width, right: rect.right, viewportWidth: innerWidth,
          clientWidth: view.clientWidth, scrollWidth: view.scrollWidth,
          dayMin: Math.min(...widths), dayMax: Math.max(...widths),
          gridWidth: first?.getBoundingClientRect().width,
        }
      })
      if (inline.scrollWidth > inline.clientWidth + 2) failures.push(`Inline calendar overflow at ${width}/${theme}: ${inline.scrollWidth}/${inline.clientWidth}`)
      if (inline.right > width + 2) failures.push(`Inline calendar outside viewport at ${width}/${theme}: ${inline.right}`)
      if (inline.dayMin < 22) failures.push(`Calendar day too small at ${width}/${theme}: ${inline.dayMin.toFixed(1)}px`)
      await page.screenshot({ path: `${output}/${width}-${theme}-inline-weeknumbers.png` })
      await page.locator('#cal-inline').uncheck()
      await page.locator('#cal-week').uncheck()
      await page.locator('#cal-live .sdp-datepicker__trigger').click()
      await page.locator('#cal-live .sdp-datepicker__popover').waitFor({ state: 'visible' })
      await page.waitForTimeout(150)
      const popup = await page.evaluate(() => {
        const node = document.querySelector('#cal-live .sdp-datepicker__popover')
        const rect = node.getBoundingClientRect()
        const grid = node.querySelector('.sdp-calendar__grid').getBoundingClientRect()
        const footer = node.querySelector('.sdp-calendar__footer').getBoundingClientRect()
        return {
          x: rect.left, y: rect.top, right: rect.right, bottom: rect.bottom,
          width: rect.width, height: rect.height, viewWidth: innerWidth, viewHeight: innerHeight,
          contentWidth: node.scrollWidth, viewportContentWidth: node.clientWidth,
          gridWidth: grid.width, footerTop: footer.top, footerBottom: footer.bottom,
        }
      })
      if (popup.x < -2 || popup.right > width + 2) failures.push(`Popover horizontal clipping at ${width}/${theme}: ${JSON.stringify(popup)}`)
      if (popup.y < -2 || popup.bottom > (width <= 375 ? 640 : 850) + 2) failures.push(`Popover vertical clipping at ${width}/${theme}: ${JSON.stringify(popup)}`)
      if (popup.contentWidth > popup.viewportContentWidth + 2) failures.push(`Popover inner overflow at ${width}/${theme}`)
      if (popup.footerTop < popup.y - 2 || popup.footerBottom > popup.bottom + 2) {
        failures.push(`Popover actions are clipped at ${width}/${theme}: ${JSON.stringify(popup)}`)
      }
      await page.screenshot({ path: `${output}/${width}-${theme}-popup.png` })
      await page.keyboard.press('Escape')
      await page.locator('#playground').scrollIntoViewIfNeeded()
      await page.locator('#playground-picker .sdp-datepicker__trigger').click()
      await page.locator('#playground-picker .sdp-datepicker__popover').waitFor({ state: 'visible' })
      await page.waitForTimeout(150)
      const wheel = await page.evaluate(() => {
        const node = document.querySelector('#playground-picker .sdp-datepicker__popover')
        const rect = node.getBoundingClientRect()
        const scroller = node.querySelector('.sdp-datepicker__wheels')
        const scrollerRect = scroller.getBoundingClientRect()
        const columns = [...node.querySelectorAll('.sdp-datepicker__columns > .sdp-wheel')]
          .filter(column => getComputedStyle(column).display !== 'none')
          .map(column => {
            const b = column.getBoundingClientRect()
            return { name: column.getAttribute('aria-label'), left: b.left, right: b.right, width: b.width }
          })
        return { x: rect.left, y: rect.top, right: rect.right, bottom: rect.bottom,
          width: rect.width, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
          scrollerLeft: scrollerRect.left, scrollerRight: scrollerRect.right,
          scrollerWidth: scroller.scrollWidth, scrollerClientWidth: scroller.clientWidth,
          columns }
      })
      if (wheel.x < -2 || wheel.right > width + 2) failures.push(`Wheel popover clipping at ${width}/${theme}: ${JSON.stringify(wheel)}`)
      if (width <= 375 && wheel.scrollerWidth > wheel.scrollerClientWidth + 2) {
        failures.push(`Wheel columns require horizontal scrolling at ${width}/${theme}: ${JSON.stringify(wheel)}`)
      }
      if (width <= 375 && wheel.columns.some(column => column.left < wheel.scrollerLeft - 2 || column.right > wheel.scrollerRight + 2)) {
        failures.push(`Wheel column obscured at ${width}/${theme}: ${JSON.stringify(wheel)}`)
      }
      await page.screenshot({ path: `${output}/${width}-${theme}-wheel.png` })
      metrics.push({ width, theme, ...base, inline, popup, wheel })
    }
  }
  // Arabic right-to-left calendar: verify that its popover stays within the
  // viewport and weekday/number labels remain distinct and readable.
  await page.setViewportSize({ width: 375, height: 720 })
  await page.goto(process.env.AUDIT_URL ?? 'http://127.0.0.1:4173/index.html', { waitUntil: 'networkidle' })
  await page.evaluate(async () => {
    const { CalendarDatePicker } = await import('./dist/index.js')
    const host = document.createElement('div')
    host.id = 'rtl-calendar-audit'
    host.dir = 'rtl'
    host.style.cssText = 'position: relative; width: 320px; max-width: calc(100vw - 24px); margin: 12px;'
    document.body.prepend(host)
    const picker = new CalendarDatePicker(host, {
      locale: 'ar-EG', mode: 'range', showWeekNumbers: true, clearable: true,
      now: () => new Date(2026, 9, 9, 12),
    })
    window.__rtlAuditPicker = picker
    picker.open()
  })
  await page.locator('#rtl-calendar-audit .sdp-datepicker__popover').waitFor({ state: 'visible' })
  await page.waitForTimeout(150)
  const rtl = await page.evaluate(() => {
    const node = document.querySelector('#rtl-calendar-audit .sdp-datepicker__popover')
    const rect = node.getBoundingClientRect()
    const weekHeader = node.querySelector('.sdp-calendar__weekdays')
    const digits = [...node.querySelectorAll('.sdp-calendar__day')].map(day => day.textContent)
    return {
      left: rect.left, right: rect.right, width: rect.width,
      viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
      scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
      gridScroll: weekHeader.scrollWidth, gridWidth: weekHeader.clientWidth,
      hasArabicDigits: digits.includes(new Intl.NumberFormat('ar-EG', {useGrouping: false}).format(9)),
    }
  })
  await page.screenshot({ path: `${output}/375-dark-rtl-calendar.png` })
  if (rtl.left < -2 || rtl.right > rtl.viewport + 2
    || rtl.documentWidth > rtl.viewport + 1
    || rtl.scrollWidth > rtl.clientWidth + 2
    || rtl.gridScroll > rtl.gridWidth + 2
    || !rtl.hasArabicDigits) {
    failures.push(`RTL calendar clipping or localization failure: ${JSON.stringify(rtl)}`)
  }
  await page.evaluate(() => {
    window.__rtlAuditPicker.destroy()
    document.querySelector('#rtl-calendar-audit').remove()
  })
  metrics.push({ rtl })

  console.log('LAYOUT_METRICS=' + JSON.stringify(metrics))
  console.log('LAYOUT_FAILURES=' + JSON.stringify(failures))
  assert.deepEqual(failures, [])
}
finally { await browser.close() }
