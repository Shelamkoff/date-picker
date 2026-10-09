import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(process.env.AUDIT_URL ?? 'http://127.0.0.1:4173/index.html', { waitUntil: 'networkidle' })

  await page.evaluate(async () => {
    const { CalendarDatePicker, createDatePickerWidget } = await import('./dist/index.js')
    const host = document.createElement('div')
    host.id = 'cal-range-regression'
    host.style.width = '340px'
    document.body.append(host)
    const changes = []
    const picker = createDatePickerWidget(host, {
      view: 'calendar', mode: 'range', clearable: true,
      now: () => new Date(2026, 9, 9, 12),
      onChange(value, reason) {
        changes.push({ start: value.start?.getDate() ?? null, end: value.end?.getDate() ?? null, reason })
      },
    })
    window.__calendarRange = { picker, changes }
    picker.open()
    const multiple = document.createElement('div')
    multiple.id = 'cal-multiple-regression'
    multiple.style.width = '340px'
    document.body.append(multiple)
    const multiChanges = []
    const multiPicker = new CalendarDatePicker(multiple, {
      mode: 'multiple', maxSelections: 2, clearable: true,
      now: () => new Date(2026, 9, 9, 12),
      onChange(value) { multiChanges.push(value.map(date => date.getDate())) },
    })
    window.__calendarMultiple = { picker: multiPicker, changes: multiChanges }
    const inline = document.createElement('div')
    inline.id = 'cal-inline-regression'
    inline.style.width = '340px'
    document.body.append(inline)
    const inlinePicker = new CalendarDatePicker(inline, {
      inline: true, showWeekNumbers: true, mode: 'single',
      disabledDate: date => date.getDay() === 0,
      now: () => new Date(2026, 9, 9, 12),
    })
    window.__calendarInline = inlinePicker
  })

  const day = (host, date) => page.locator('#' + host + ' .sdp-calendar__day:not(.is-outside)')
    .filter({ hasText: new RegExp('^' + date + '$') })
  const rangePopover = page.locator('#cal-range-regression .sdp-datepicker__popover')
  console.log('calendar-before-range-selection', await page.evaluate(() => {
    const root = document.getElementById('cal-range-regression')
    return { open: window.__calendarRange.picker.isOpen, hidden: root.querySelector('.sdp-datepicker__popover').hidden,
      active: document.activeElement?.className ?? '' }
  }))
  await page.evaluate(() => {
    const root = document.getElementById('cal-range-regression')
    window.__calEvents = []
    for (const type of ['focusout','focusin','pointerdown','pointerup','click']) {
      root.addEventListener(type, event => window.__calEvents.push({
        type, target: event.target?.className ?? '', related: event.relatedTarget?.className ?? '',
        active: document.activeElement?.className ?? ''
      }), true)
    }
  })
  await day('cal-range-regression', 12).click()
  console.log('calendar-events-first-selection', await page.evaluate(() => window.__calEvents))
  console.log('calendar-range-first-selection', await page.evaluate(() => {
    const root = document.getElementById('cal-range-regression')
    const picker = window.__calendarRange.picker
    return { open: picker.isOpen, hidden: root.querySelector('.sdp-datepicker__popover').hidden,
      start: picker.value.start?.getDate() ?? null, end: picker.value.end?.getDate() ?? null,
      active: document.activeElement?.tagName }
  }))
  assert.equal(await rangePopover.isVisible(), true, 'start of range must keep the calendar open')
  await day('cal-range-regression', 18).hover()
  assert.equal(await day('cal-range-regression', 15).evaluate(element => element.classList.contains('is-preview')), true, 'hover previews the range')
  await day('cal-range-regression', 18).click()
  assert.equal(await rangePopover.isVisible(), false, 'completed range closes the popover')
  assert.deepEqual(await page.evaluate(() => window.__calendarRange.changes), [
    { start: 12, end: null, reason: 'select' },
    { start: 12, end: 18, reason: 'select' },
  ])

  await page.locator('#cal-range-regression .sdp-datepicker__trigger').click()
  await day('cal-range-regression', 16).focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.locator('#cal-range-regression .sdp-calendar__day:focus').textContent(), '17')
  await page.keyboard.press('Enter')
  assert.equal(await rangePopover.isVisible(), true, 'first click restarts a range')
  await page.keyboard.press('Escape')
  assert.equal(await rangePopover.isVisible(), false)

  await page.evaluate(() => window.__calendarMultiple.picker.open())
  await day('cal-multiple-regression', 11).click()
  await day('cal-multiple-regression', 9).click()
  await day('cal-multiple-regression', 15).click()
  assert.deepEqual(await page.evaluate(() => window.__calendarMultiple.picker.value.map(value => value.getDate())), [9, 11])
  assert.equal(await page.locator('#cal-multiple-regression .sdp-datepicker__popover').isVisible(), true)
  await day('cal-multiple-regression', 11).click()
  assert.deepEqual(await page.evaluate(() => window.__calendarMultiple.changes), [[11], [9, 11], [9]])

  assert.equal(await day('cal-inline-regression', 11).isDisabled(), true, 'disabledDate is reflected in DOM')
  assert.equal(await page.locator('#cal-inline-regression .sdp-calendar__week-number').count() > 0, true)
  await day('cal-inline-regression', 12).click()
  assert.equal(await page.evaluate(() => window.__calendarInline.value.getDate()), 12)
  assert.equal(await page.locator('#cal-inline-regression .sdp-datepicker__popover').isVisible(), true)

  await page.evaluate(() => {
    window.__calendarRange.picker.destroy()
    window.__calendarMultiple.picker.destroy()
    window.__calendarInline.destroy()
  })
  assert.deepEqual(errors, [], 'browser console must contain no uncaught errors')
  console.log('Calendar browser regressions passed')
}
finally { await browser.close() }
