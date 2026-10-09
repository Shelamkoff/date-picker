import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CalendarSelectionController, civilDayNumber, civilDayParts, civilWeekday,
  shiftCalendarMonth,
} from '../dist/core/calendar-selection.js'

function date(year, month, day, hour = 12) {
  const value = new Date(0)
  value.setHours(12, 0, 0, 0)
  value.setFullYear(year, month - 1, day)
  value.setHours(hour, 0, 0, 0)
  return value
}
const day = value => [value.getFullYear(), value.getMonth() + 1, value.getDate()]

test('Gregorian ordinal round trips without relying on Date.UTC years 0..99', () => {
  for (const year of [-271000, -400, -1, 0, 1, 4, 99, 100, 1900, 2000, 2026, 2400, 275000]) {
    for (let month = 1; month <= 12; month += 1) {
      for (const last of [1, 28]) {
        const ordinal = civilDayNumber(year, month, last)
        assert.deepEqual(civilDayParts(ordinal), { year, month, day: last })
      }
    }
  }
  assert.equal(civilWeekday(civilDayNumber(1970, 1, 1)), 4)
  assert.equal(civilWeekday(civilDayNumber(2026, 10, 9)), 5)
  assert.deepEqual(shiftCalendarMonth(2026, 1, -1), { year: 2025, month: 12 })
  assert.deepEqual(shiftCalendarMonth(0, 1, -1), { year: -1, month: 12 })
})

test('single selection normalizes days, clones inputs, and suppresses unchanged selections', () => {
  const initial = date(2026, 10, 8, 19)
  const picker = new CalendarSelectionController({ now: () => date(2026, 10, 9) }, initial)
  assert.deepEqual(day(picker.value), [2026, 10, 8])
  initial.setDate(1)
  assert.deepEqual(day(picker.value), [2026, 10, 8])
  const events = []
  picker.subscribe(event => { if (event.type === 'change') events.push(event) })
  assert.equal(picker.select(date(2026, 10, 8)), false)
  assert.equal(picker.select(date(2026, 10, 9)), true)
  assert.equal(events.length, 1)
  picker.value.setDate(2)
  assert.deepEqual(day(picker.value), [2026, 10, 9])
  assert.equal(picker.clear(), true)
  assert.equal(picker.clear(), false)
  assert.equal(picker.value, null)
  assert.deepEqual(events.map(event => event.reason), ['select', 'clear'])
})

test('range selection supports reversed endpoints, preview, min/max lengths and disabled days', () => {
  const picker = new CalendarSelectionController({
    mode: 'range', minRangeDays: 2, maxRangeDays: 8,
    disabledDate: value => value.getDate() === 15,
    now: () => date(2026, 10, 9),
  })
  assert.equal(picker.select(date(2026, 10, 12)), true)
  assert.equal(picker.isRangePending, true)
  assert.equal(picker.select(date(2026, 10, 12)), false)
  assert.equal(picker.select(date(2026, 10, 16)), false, 'cannot cross a disabled day')
  picker.hover(date(2026, 10, 14))
  assert.equal(picker.getMonth().days.find(item => item.day === 13 && !item.outside).preview, true)
  assert.equal(picker.select(date(2026, 10, 10)), true)
  assert.deepEqual(day(picker.value.start), [2026, 10, 10])
  assert.deepEqual(day(picker.value.end), [2026, 10, 12])
  assert.equal(picker.isRangePending, false)
  assert.equal(picker.select(date(2026, 10, 20)), true, 'third selection restarts range')
  assert.equal(picker.value.end, null)
  assert.equal(picker.select(date(2026, 10, 30)), false, 'maximum inclusive span enforced')
  assert.throws(() => picker.setValue({ start: date(2026, 10, 12), end: date(2026, 10, 16) }), RangeError)
})

test('multiple selection toggles, sorts, deduplicates and respects maxSelections', () => {
  const picker = new CalendarSelectionController({ mode: 'multiple', maxSelections: 2 }, [])
  assert.equal(picker.select(date(2026, 1, 9)), true)
  assert.equal(picker.select(date(2026, 1, 3)), true)
  assert.deepEqual(picker.value.map(item => item.getDate()), [3, 9])
  assert.equal(picker.select(date(2026, 1, 10)), false)
  assert.equal(picker.select(date(2026, 1, 9)), true)
  assert.deepEqual(picker.value.map(item => item.getDate()), [3])
  picker.setValue([date(2026, 1, 3), date(2026, 1, 3)])
  assert.equal(picker.value.length, 1)
  assert.throws(() => picker.setValue([date(2026, 1, 1), date(2026, 1, 2), date(2026, 1, 3)]), RangeError)
})

test('min/max bounds are date-inclusive, and navigation respects month bounds', () => {
  const picker = new CalendarSelectionController({
    minDate: date(2026, 5, 10, 23), maxDate: date(2026, 6, 20, 1),
    now: () => date(2026, 5, 10), fixedWeeks: true,
  })
  assert.equal(picker.isSelectable(date(2026, 5, 10, 0)), true)
  assert.equal(picker.isSelectable(date(2026, 5, 9)), false)
  assert.equal(picker.canNavigate(-1), false)
  assert.equal(picker.navigate(1), true)
  assert.equal(picker.navigate(1), false)
  assert.equal(picker.getMonth().days.length, 42)
  assert.ok(picker.getMonth().days.every(item => typeof item.disabled === 'boolean'))
  picker.select(date(2026, 6, 15))
  picker.update({ maxDate: date(2026, 6, 10) })
  assert.equal(picker.value, null, 'selection removed if constraints change')
})

test('rejected inputs do not corrupt state or change the mode', () => {
  const picker = new CalendarSelectionController({ mode: 'range' })
  assert.throws(() => picker.setValue(new Date()), TypeError)
  assert.throws(() => picker.setValue({ start: null, end: new Date() }), RangeError)
  assert.throws(() => picker.update({ mode: 'multiple' }), RangeError)
  assert.equal(picker.mode, 'range')
  assert.deepEqual(picker.value, { start: null, end: null })
})

test('skipped civil days in Pacific/Apia cannot be selected', () => {
  if (process.env.TZ !== 'Pacific/Apia') return
  const picker = new CalendarSelectionController({ now: () => date(2011, 12, 29) })
  const days = picker.getMonth().days
  const skipped = days.find(value => value.year === 2011 && value.month === 12 && value.day === 30)
  assert.equal(skipped?.disabled, true)
})


test('range cannot cover a skipped civil day, even without disabledDate callback', () => {
  if (process.env.TZ !== 'Pacific/Apia') return
  const picker = new CalendarSelectionController({ mode: 'range' })
  assert.equal(picker.select(date(2011, 12, 29)), true)
  assert.equal(picker.select(date(2011, 12, 31)), false)
  assert.deepEqual(day(picker.value.start), [2011, 12, 29])
  assert.equal(picker.value.end, null)
})

test('initial and updated month are clamped to the allowed month interval', () => {
  const picker = new CalendarSelectionController({ minDate: date(2040, 4, 3), maxDate: date(2040, 5, 15), now: () => date(2026, 10, 9) })
  assert.equal(picker.year, 2040)
  assert.equal(picker.month, 4)
  assert.equal(picker.canNavigate(-1), false)
  picker.update({ minDate: date(2050, 2, 10), maxDate: date(2050, 4, 15) })
  assert.equal(picker.year, 2050)
  assert.equal(picker.month, 2)
  assert.equal(picker.canNavigate(1), true)
})
