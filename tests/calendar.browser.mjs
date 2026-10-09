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
    const readonly = document.createElement('div')
    readonly.id = 'cal-readonly-regression'
    document.body.append(readonly)
    const readonlyPicker = new CalendarDatePicker(readonly, {
      inline: true, readOnly: true, now: () => new Date(2026, 9, 9, 12),
    })
    window.__calendarReadonly = readonlyPicker
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
    // Regional first-day-of-week follows Intl.Locale on both old and new APIs.
    const us = document.createElement('div')
    document.body.append(us)
    const usPicker = new CalendarDatePicker(us, {
      locale: 'en-US', inline: true, now: () => new Date(2026, 9, 9, 12),
    })
    const gb = document.createElement('div')
    document.body.append(gb)
    const gbPicker = new CalendarDatePicker(gb, {
      locale: 'en-GB', inline: true, now: () => new Date(2026, 9, 9, 12),
    })
    window.__calendarLocales = { usPicker, gbPicker }
  })

  const day = (host, date) => page.locator('#' + host + ' .sdp-calendar__day:not(.is-outside)')
    .filter({ hasText: new RegExp('^' + date + '$') })
  const rangePopover = page.locator('#cal-range-regression .sdp-datepicker__popover')
  await day('cal-range-regression', 12).click()
  assert.deepEqual(await page.evaluate(() => {
    const value = window.__calendarRange.picker.value
    return { start: value.start?.getDate() ?? null, end: value.end?.getDate() ?? null }
  }), { start: 12, end: null }, 'first range click commits a partial range')
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

  assert.deepEqual(await page.evaluate(() => ({
    us: window.__calendarLocales.usPicker.snapshot.weekStartsOn,
    gb: window.__calendarLocales.gbPicker.snapshot.weekStartsOn,
  })), { us: 0, gb: 1 }, 'week starts on Sunday in the US and Monday in Great Britain')
  const readOnlyDay = day('cal-readonly-regression', 9)
  assert.equal(await readOnlyDay.isDisabled(), false, 'read-only cells stay keyboard focusable')
  assert.equal(await readOnlyDay.getAttribute('aria-disabled'), 'true')
  await readOnlyDay.focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.locator('#cal-readonly-regression .sdp-calendar__day:focus').textContent(), '10')
  await day('cal-readonly-regression', 10).click()
  assert.equal(await page.evaluate(() => window.__calendarReadonly.value), null, 'read-only rejects selection')
  assert.equal(await day('cal-inline-regression', 11).isDisabled(), true, 'disabledDate is reflected in DOM')
  assert.equal(await page.locator('#cal-inline-regression .sdp-calendar__week-number').count() > 0, true)
  await day('cal-inline-regression', 12).click()
  assert.equal(await page.evaluate(() => window.__calendarInline.value.getDate()), 12)
  assert.equal(await page.locator('#cal-inline-regression .sdp-datepicker__popover').isVisible(), true)

  // A click in another widget closes an open popover, but does not change its value.
  assert.equal(await page.locator('#cal-multiple-regression .sdp-datepicker__popover').isVisible(), false)
  assert.deepEqual(await page.evaluate(() => window.__calendarMultiple.picker.value.map(date => date.getDate())), [9])

  await page.evaluate(() => {
    window.__calendarRange.picker.destroy()
    window.__calendarMultiple.picker.destroy()
    window.__calendarInline.destroy()
    window.__calendarReadonly.destroy()
    window.__calendarLocales.usPicker.destroy()
    window.__calendarLocales.gbPicker.destroy()
  })
  assert.deepEqual(errors, [], 'browser console must contain no uncaught errors')
  console.log('Calendar browser regressions passed')
}
finally { await browser.close() }
