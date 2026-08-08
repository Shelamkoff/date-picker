import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DatePickerController,
  dateToParts,
  isValidDate,
  normalizePickerDate,
} from '../dist/core/index.js'

const MIN_DATE_TIME = -8_640_000_000_000_000
const MAX_DATE_TIME = 8_640_000_000_000_000

for (const [name, instant] of [['minimum', MIN_DATE_TIME], ['maximum', MAX_DATE_TIME]]) {
  test(`${name} JavaScript Date can seed the time picker`, () => {
    const source = new Date(instant)
    assert.equal(isValidDate(source), true)
    const controller = new DatePickerController({
      enableTime: true,
      pastYears: 2,
      futureYears: 2,
    }, source)
    controller.open()

    const value = controller.value
    const snapshot = controller.snapshot
    assert.ok(value && isValidDate(value))
    assert.ok(value.getTime() >= MIN_DATE_TIME)
    assert.ok(value.getTime() <= MAX_DATE_TIME)
    assert.ok(snapshot.columns.years.includes(snapshot.parts.year))
    assert.ok(snapshot.columns.months.includes(snapshot.parts.month))
    assert.ok(snapshot.columns.days.includes(snapshot.parts.day))
    assert.ok(snapshot.columns.hours.includes(snapshot.parts.hour))
    assert.ok(snapshot.columns.minutes.includes(snapshot.parts.minute))
  })

  test(`${name} JavaScript Date can seed the date-only picker`, () => {
    const source = new Date(instant)
    const controller = new DatePickerController({
      pastYears: 2,
      futureYears: 2,
    }, source)
    controller.open()
    const value = controller.value
    assert.ok(value && isValidDate(value))
    const parts = dateToParts(value)
    assert.equal(parts.hour >= 0 && parts.hour <= 23, true)
    assert.equal(parts.minute >= 0 && parts.minute <= 59, true)
    assert.ok(controller.snapshot.columns.years.includes(parts.year))
  })
}

test('normalizing every sampled Date-range boundary instant remains ordered', () => {
  for (const instant of [
    MIN_DATE_TIME,
    MIN_DATE_TIME + 1,
    MIN_DATE_TIME + 59_999,
    MIN_DATE_TIME + 300_000,
    MAX_DATE_TIME - 300_000,
    MAX_DATE_TIME - 59_999,
    MAX_DATE_TIME - 1,
    MAX_DATE_TIME,
  ]) {
    const source = new Date(instant)
    const normalized = normalizePickerDate(source, true)
    assert.ok(isValidDate(normalized))
    assert.ok(normalized.getTime() >= MIN_DATE_TIME)
    assert.ok(normalized.getTime() <= MAX_DATE_TIME)
    assert.equal(normalized.getSeconds(), 0)
    assert.equal(normalized.getMilliseconds(), 0)
  }
})
