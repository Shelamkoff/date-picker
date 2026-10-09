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
      if (theme === 'light') await page.locator('#theme-toggle').click()
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
      if (base.scrollWidth > width + 1) failures.push(`Horizontal document overflow at ${width}/${theme}: ${base.scrollWidth}`)
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
        return {
          x: rect.left, y: rect.top, right: rect.right, bottom: rect.bottom,
          width: rect.width, height: rect.height, viewWidth: innerWidth, viewHeight: innerHeight,
          contentWidth: node.scrollWidth, viewportContentWidth: node.clientWidth,
          gridWidth: grid.width,
        }
      })
      if (popup.x < -2 || popup.right > width + 2) failures.push(`Popover horizontal clipping at ${width}/${theme}: ${JSON.stringify(popup)}`)
      if (popup.y < -2 || popup.bottom > (width <= 375 ? 640 : 850) + 2) failures.push(`Popover vertical clipping at ${width}/${theme}: ${JSON.stringify(popup)}`)
      if (popup.contentWidth > popup.viewportContentWidth + 2) failures.push(`Popover inner overflow at ${width}/${theme}`)
      await page.screenshot({ path: `${output}/${width}-${theme}-popup.png` })
      await page.keyboard.press('Escape')
      await page.locator('#playground').scrollIntoViewIfNeeded()
      await page.locator('#playground-picker .sdp-datepicker__trigger').click()
      await page.locator('#playground-picker .sdp-datepicker__popover').waitFor({ state: 'visible' })
      await page.waitForTimeout(150)
      const wheel = await page.evaluate(() => {
        const node = document.querySelector('#playground-picker .sdp-datepicker__popover')
        const rect = node.getBoundingClientRect()
        return { x: rect.left, y: rect.top, right: rect.right, bottom: rect.bottom,
          width: rect.width, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth }
      })
      if (wheel.x < -2 || wheel.right > width + 2) failures.push(`Wheel popover clipping at ${width}/${theme}: ${JSON.stringify(wheel)}`)
      await page.screenshot({ path: `${output}/${width}-${theme}-wheel.png` })
      metrics.push({ width, theme, ...base, inline, popup, wheel })
    }
  }
  console.log('LAYOUT_METRICS=' + JSON.stringify(metrics))
  console.log('LAYOUT_FAILURES=' + JSON.stringify(failures))
  assert.deepEqual(failures, [])
}
finally { await browser.close() }
