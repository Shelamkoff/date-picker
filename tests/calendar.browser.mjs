import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, timezoneId: 'UTC' })
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

  const stylesheets = await page.locator('link[rel="stylesheet"]').evaluateAll(nodes => nodes.map(node => node.href))
  assert.ok(stylesheets.some(url => url.endsWith('/src/style.css')))
  for (const stylesheet of stylesheets) {
    assert.equal((await page.request.get(stylesheet)).status(), 200, 'missing stylesheet: ' + stylesheet)
  }
  await page.locator('#cal-mode').selectOption('multiple')
  await page.locator('#cal-inline').check()
  assert.equal(await page.locator('#cal-live .sdp-datepicker--inline').count(), 1)
  await page.locator('#cal-week').check()
  assert.ok(await page.locator('#cal-live .sdp-calendar__week-number').count() > 0)
  await page.locator('#cal-mode').selectOption('range')
  // Demo controls move focus away from the regression picker; reopen it explicitly.
  await page.evaluate(() => window.__calendarRange.picker.open())
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
  assert.equal(await readOnlyDay.evaluate(button => button.disabled), false, 'read-only cells stay keyboard focusable')
  assert.equal(await readOnlyDay.getAttribute('aria-disabled'), 'true')
  await readOnlyDay.focus()
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.locator('#cal-readonly-regression .sdp-calendar__day:focus').textContent(), '10')
  await page.keyboard.press('Enter')
  assert.equal(await page.evaluate(() => window.__calendarReadonly.value), null, 'read-only rejects selection')
  assert.equal(await day('cal-inline-regression', 11).isDisabled(), true, 'disabledDate is reflected in DOM')
  assert.equal(await page.locator('#cal-inline-regression .sdp-calendar__week-number').count() > 0, true)
  await day('cal-inline-regression', 12).click()
  assert.equal(await page.evaluate(() => window.__calendarInline.value.getDate()), 12)
  assert.equal(await page.locator('#cal-inline-regression .sdp-datepicker__popover').isVisible(), true)

  // A click in another widget closes an open popover, but does not change its value.
  assert.equal(await page.locator('#cal-multiple-regression .sdp-datepicker__popover').isVisible(), false)
  assert.deepEqual(await page.evaluate(() => window.__calendarMultiple.picker.value.map(date => date.getDate())), [9])

  // The upper ECMAScript Date boundary has an existing midnight but no
  // representable noon. A selectable day must also be clickable in the DOM.
  const edge = await page.evaluate(async () => {
    const { CalendarDatePicker } = await import('./dist/index.js')
    const host = document.createElement('div')
    host.style.width = '340px'
    document.body.append(host)
    const maximum = new Date(8_640_000_000_000_000)
    const widget = new CalendarDatePicker(host, {
      inline: true, now: () => maximum, minDate: maximum, maxDate: maximum,
    })
    const available = [...host.querySelectorAll('.sdp-calendar__day')]
      .find(day => day.textContent === '13' && !day.classList.contains('is-outside'))
    const visible = !!available
    const enabled = visible && !available.disabled
    available?.click()
    const selected = widget.value instanceof Date ? widget.value.getTime() : null
    widget.destroy()
    host.remove()
    return { visible, enabled, selected }
  })
  assert.deepEqual(edge, { visible: true, enabled: true, selected: 8_640_000_000_000_000 },
    'last representable civil day must be selectable in calendar DOM')

  // Invalid explicit values in a combined widget update must not leave
  // the controller using half-applied min/max bounds.
  const transaction = await page.evaluate(async () => {
    const { CalendarDatePicker } = await import('./dist/index.js')
    const host = document.createElement('div')
    document.body.append(host)
    const current = new Date(2026, 9, 10)
    const picker = new CalendarDatePicker(host, { inline: true, value: current })
    let failed = false
    try {
      picker.update({ minDate: new Date(2026, 9, 15), value: current })
    }
    catch (error) { failed = error instanceof RangeError }
    const unchanged = picker.value instanceof Date && picker.value.getDate() === 10
    picker.update({ minDate: new Date(2026, 9, 15), value: new Date(2026, 9, 16) })
    const committed = picker.value instanceof Date && picker.value.getDate() === 16
    picker.destroy()
    host.remove()
    return { failed, unchanged, committed }
  })
  assert.deepEqual(transaction, { failed: true, unchanged: true, committed: true })

  const todayButtons = await page.evaluate(async () => {
    const { CalendarDatePicker } = await import('./dist/index.js')
    const host = document.createElement('div')
    document.body.append(host)
    const picker = new CalendarDatePicker(host, {
      inline: true, showToday: true, clearable: false,
      now: () => new Date(2026, 9, 9),
      minDate: new Date(2026, 9, 10),
    })
    const today = host.querySelector('.sdp-calendar__footer .sdp-calendar__action')
    const disabledWhenUnavailable = today.disabled
    picker.update({ minDate: new Date(2026, 9, 1) })
    const enabledWhenAvailable = !today.disabled
    picker.update({ showToday: false, clearable: false })
    const footerHiddenWhenEmpty = host.querySelector('.sdp-calendar__footer').hidden
    picker.destroy()
    host.remove()
    return { disabledWhenUnavailable, enabledWhenAvailable, footerHiddenWhenEmpty }
  })
  assert.deepEqual(todayButtons, {
    disabledWhenUnavailable: true,
    enabledWhenAvailable: true,
    footerHiddenWhenEmpty: true,
  }, 'today and footer states must reflect available actions')

  const localeLabels = await page.evaluate(async () => {
    const { CalendarDatePicker } = await import('./dist/index.js')
    const us = document.createElement('div')
    const ar = document.createElement('div')
    document.body.append(us, ar)
    const jan = new Date(2026, 0, 8, 12)
    const usPicker = new CalendarDatePicker(us, {
      inline: true, locale: 'en-US', showWeekNumbers: true, now: () => jan,
    })
    const arPicker = new CalendarDatePicker(ar, {
      inline: true, locale: 'ar-EG', showWeekNumbers: true, now: () => jan,
    })
    const januaryFifth = [...us.querySelectorAll('.sdp-calendar__week')]
      .find(row => [...row.querySelectorAll('.sdp-calendar__day:not(.is-outside)')]
        .some(day => day.textContent === '5'))
    const isoWeek = januaryFifth?.querySelector('.sdp-calendar__week-number')?.textContent ?? null
    const isoWeekLabel = januaryFifth?.querySelector('.sdp-calendar__week-number')?.getAttribute('aria-label') ?? null
    const arabicCompacts = [...ar.querySelectorAll('[role="columnheader"]')]
      .map(item => item.dataset.compact)
    const arabicNumber = new Intl.NumberFormat('ar-EG', { useGrouping: false })
    const arabicDayDigits = [...ar.querySelectorAll('.sdp-calendar__day:not(.is-outside)')]
      .some(button => button.textContent === arabicNumber.format(5))
    const arabicYearDigits = ar.querySelector('.sdp-calendar__title')
      ?.textContent?.includes(arabicNumber.format(2026)) ?? false
    usPicker.destroy()
    arPicker.destroy()
    us.remove()
    ar.remove()
    return {
      isoWeek, isoWeekLabel,
      distinctArabic: new Set(arabicCompacts).size,
      countArabic: arabicCompacts.length,
      arabicDayDigits, arabicYearDigits,
    }
  })
  assert.deepEqual(localeLabels, {
    isoWeek: '2', isoWeekLabel: 'ISO week 2', distinctArabic: 7, countArabic: 7,
    arabicDayDigits: true, arabicYearDigits: true,
  }, 'ISO week labels and compact localized weekday labels remain meaningful')

  const disposed = await page.evaluate(async () => {
    const { CalendarDatePicker } = await import('./dist/index.js')
    const host = document.createElement('div')
    document.body.append(host)
    let changes = 0
    const picker = new CalendarDatePicker(host, {
      inline: true,
      now: () => new Date(2026, 9, 9, 12),
      onChange() { changes += 1 },
    })
    const oldDay = host.querySelector('.sdp-calendar__day:not(:disabled)')
    const oldMonthNav = host.querySelector('.sdp-calendar__nav')
    picker.destroy()
    picker.destroy()
    oldDay.click()
    oldMonthNav.click()
    const selected = picker.value !== null
    const remaining = host.childElementCount
    host.remove()
    return { changes, selected, remaining }
  })
  assert.deepEqual(disposed, { changes: 0, selected: false, remaining: 0 },
    'detached calendar controls must be inert after destroy()')

  const actionLimits = await page.evaluate(async () => {
    const { CalendarDatePicker } = await import('./dist/index.js')
    const host = document.createElement('div')
    document.body.append(host)
    const today = new Date(2026, 9, 9)
    const picker = new CalendarDatePicker(host, {
      mode: 'multiple', inline: true, maxSelections: 1,
      value: [new Date(2026, 9, 8)], now: () => today,
    })
    const todayAction = host.querySelector('.sdp-calendar__footer .sdp-calendar__action')
    const disabledAtCapacity = todayAction.disabled
    picker.setValue([today])
    const enabledToToggle = !todayAction.disabled
    picker.destroy()
    host.remove()
    return { disabledAtCapacity, enabledToToggle }
  })
  assert.deepEqual(actionLimits, { disabledAtCapacity: true, enabledToToggle: true })


  // Gregorian grid and full accessible labels must refer to the same year even
  // in locales whose default calendar is not Gregorian.
  const localizedCalendar = await page.evaluate(async () => {
    const { CalendarDatePicker } = await import('./dist/index.js')
    const actual = []
    for (const locale of ['th-TH', 'fa-IR', 'ja-JP-u-ca-japanese']) {
      const host = document.createElement('div')
      document.body.append(host)
      const date = new Date(2026, 9, 9, 12)
      const picker = new CalendarDatePicker(host, { inline: true, locale, now: () => date })
      const today = host.querySelector('.sdp-calendar__day[aria-current="date"]')
      const label = today?.getAttribute('aria-label')
      const expected = new Intl.DateTimeFormat(locale, { dateStyle: 'full', calendar: 'gregory' }).format(date)
      actual.push({ locale, label, expected })
      picker.destroy()
      host.remove()
    }
    return actual
  })
  for (const item of localizedCalendar) {
    assert.equal(item.label, item.expected, `calendar date label must stay Gregorian for ${item.locale}`)
  }

  // CSS grid items are laid out right-to-left for dir=rtl: ArrowLeft should
  // advance visually towards the next day, ArrowRight should go back.
  await page.evaluate(async () => {
    const { CalendarDatePicker, civilDayNumber } = await import('./dist/index.js')
    const host = document.createElement('div')
    host.id = 'rtl-keyboard-regression'
    host.dir = 'rtl'
    document.body.append(host)
    const picker = new CalendarDatePicker(host, {
      inline: true, locale: 'ar-EG', now: () => new Date(2026, 9, 9, 12),
    })
    window.__rtlKeyboard = { picker, todayOrdinal: civilDayNumber(2026, 10, 9) }
  })
  const rtlToday = page.locator('#rtl-keyboard-regression .sdp-calendar__day[aria-current="date"]')
  await rtlToday.focus()
  await page.keyboard.press('ArrowLeft')
  assert.equal(await page.locator('#rtl-keyboard-regression .sdp-calendar__day:focus').getAttribute('data-day-ordinal'),
    String(await page.evaluate(() => window.__rtlKeyboard.todayOrdinal + 1)))
  await page.keyboard.press('ArrowRight')
  assert.equal(await page.locator('#rtl-keyboard-regression .sdp-calendar__day:focus').getAttribute('data-day-ordinal'),
    String(await page.evaluate(() => window.__rtlKeyboard.todayOrdinal)))
  await page.evaluate(() => {
    window.__rtlKeyboard.picker.destroy()
    document.querySelector('#rtl-keyboard-regression').remove()
  })


  // Keyboard range selection must expose the same preview as pointer hover,
  // and a committed range must mark interior grid cells aria-selected.
  await page.evaluate(async () => {
    const { CalendarDatePicker } = await import('./dist/index.js')
    const host = document.createElement('div')
    host.id = 'keyboard-range-preview'
    host.style.width = '340px'
    document.body.append(host)
    window.__keyboardRange = new CalendarDatePicker(host, {
      mode: 'range', inline: true, clearable: true,
      now: () => new Date(2026, 9, 9, 12),
      value: { start: new Date(2026, 9, 9, 12), end: null },
    })
  })
  const keyRange = page.locator('#keyboard-range-preview')
  await keyRange.locator('.sdp-calendar__day[aria-current="date"]').focus()
  await page.keyboard.press('ArrowRight')
  const focusedRangeDay = keyRange.locator('.sdp-calendar__day:focus')
  assert.equal(await focusedRangeDay.textContent(), '10')
  assert.equal(await focusedRangeDay.evaluate(node => node.classList.contains('is-preview')), true,
    'keyboard focus should preview a valid pending range')
  assert.equal(await focusedRangeDay.locator('xpath=..').getAttribute('aria-selected'), 'false',
    'hover preview must not be announced as committed selection')
  await page.keyboard.press('Tab')
  assert.equal(await keyRange.locator('.sdp-calendar__day:not(.is-outside)').filter({ hasText: /^10$/ })
    .evaluate(node => node.classList.contains('is-preview')), false,
  'preview should clear after focus leaves the grid')
  await page.evaluate(() => window.__keyboardRange.setValue({
    start: new Date(2026, 9, 9, 12), end: new Date(2026, 9, 12, 12),
  }))
  const interiorCell = keyRange.locator('.sdp-calendar__day:not(.is-outside)').filter({ hasText: /^10$/ })
    .locator('xpath=..')
  assert.equal(await interiorCell.getAttribute('aria-selected'), 'true',
    'interior days of a completed inclusive range must be announced as selected')
  await page.evaluate(() => {
    window.__keyboardRange.destroy()
    document.querySelector('#keyboard-range-preview').remove()
  })


  // A throwing disabledDate callback during the first inline render must not
  // leave a partial picker tree on the caller's host.
  const constructorFailure = await page.evaluate(async () => {
    const { CalendarDatePicker } = await import('./dist/index.js')
    const host = document.createElement('div')
    document.body.append(host)
    let rejected = false
    try {
      new CalendarDatePicker(host, {
        inline: true, now: () => new Date(2026, 9, 9, 12),
        disabledDate: () => { throw new Error('predicate failure') },
      })
    }
    catch (error) { rejected = error?.message === 'predicate failure' }
    const leftover = host.childElementCount
    host.remove()
    return { rejected, leftover }
  })
  assert.deepEqual(constructorFailure, { rejected: true, leftover: 0 },
    'failed calendar construction must not modify the host')


  // The widget must recover from a disabledDate callback that only throws
  // while rendering its visible month (with no selected value to validate).
  const transactionalPredicate = await page.evaluate(async () => {
    const { CalendarDatePicker } = await import('./dist/index.js')
    const host = document.createElement('div')
    document.body.append(host)
    const picker = new CalendarDatePicker(host, {
      inline: true, now: () => new Date(2026, 9, 9, 12),
    })
    let rejected = false
    try {
      picker.update({
        disabledDate: date => {
          if (date.getMonth() === 9 && date.getDate() === 20) throw new Error('grid callback failed')
          return false
        },
      })
    }
    catch (error) { rejected = error?.message === 'grid callback failed' }
    const canStillSelect = picker.snapshot.days.some(day =>
      day.month === 10 && day.day === 20 && !day.disabled)
    picker.destroy()
    host.remove()
    return { rejected, canStillSelect }
  })
  assert.deepEqual(transactionalPredicate, { rejected: true, canStillSelect: true })


  // A callback which throws only when a popup grid is built must not leave
  // isOpen/aria-expanded/popup visibility or listeners in an inconsistent state.
  const failedOpenRecovery = await page.evaluate(async () => {
    const { CalendarDatePicker } = await import('./dist/index.js')
    const host = document.createElement('div')
    document.body.append(host)
    const widget = new CalendarDatePicker(host, {
      now: () => new Date(2026, 9, 9, 12),
      disabledDate() { throw new Error('render interrupted') },
    })
    let threw = false
    try { widget.open() }
    catch (error) { threw = error?.message === 'render interrupted' }
    const safelyClosed = !widget.isOpen
      && host.querySelector('.sdp-datepicker__popover').hidden
      && host.querySelector('.sdp-datepicker__trigger').getAttribute('aria-expanded') === 'false'
    widget.update({ disabledDate: null })
    widget.open()
    const recovered = widget.isOpen && !host.querySelector('.sdp-datepicker__popover').hidden
    widget.destroy()
    host.remove()
    return { threw, safelyClosed, recovered }
  })
  assert.deepEqual(failedOpenRecovery, { threw: true, safelyClosed: true, recovered: true })

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
