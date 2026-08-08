import test from 'node:test'
import assert from 'node:assert/strict'
import { DatePickerController } from '../dist/core/controller.js'

function localDate(year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
  const date = new Date(2000, month - 1, day, hour, minute, second, millisecond)
  date.setFullYear(year)
  return date
}

test('external values are normalized to picker precision and bounds', () => {
  const min = localDate(2026, 1, 1, 10, 0)
  const max = localDate(2026, 1, 1, 11, 0)
  const controller = new DatePickerController(
    { enableTime: true, minDate: min, maxDate: max, minuteStep: 5 },
    localDate(2026, 1, 1, 9, 42, 59, 900),
  )

  assert.equal(controller.value?.getTime(), min.getTime())
  assert.equal(controller.snapshot.parts.second, undefined)
  assert.equal(controller.snapshot.parts.hour, 10)
  assert.equal(controller.snapshot.parts.minute, 0)
})

test('minuteStep is enforced while exact min/max boundary minutes remain selectable', () => {
  const min = localDate(2026, 1, 1, 10, 7)
  const max = localDate(2026, 1, 1, 10, 38)
  const controller = new DatePickerController(
    { enableTime: true, minDate: min, maxDate: max, minuteStep: 15 },
    localDate(2026, 1, 1, 10, 7),
  )
  controller.open()

  assert.deepEqual(controller.snapshot.columns.minutes, [7, 15, 30, 38])
  assert.equal(controller.select('minute', 22), false)
  assert.equal(controller.select('minute', 15), true)
  assert.equal(controller.value?.getMinutes(), 15)
})

test('selecting the existing value does not emit a duplicate change', () => {
  const value = localDate(2026, 4, 5, 12, 30)
  const controller = new DatePickerController({ enableTime: true, minuteStep: 5 }, value)
  controller.open()
  const events = []
  controller.subscribe(event => {
    if (event.type === 'change') events.push(event)
  })

  assert.equal(controller.select('minute', 30), true)
  assert.equal(events.length, 0)
})

test('year windows are bounded to avoid pathological wheel sizes', () => {
  const value = localDate(2026, 1, 1)
  const controller = new DatePickerController({ pastYears: 1000, futureYears: 1000 }, value)
  controller.open()
  assert.equal(controller.snapshot.columns.years.length, 401)
})

test('snapshot results are defensive copies', () => {
  const controller = new DatePickerController({}, localDate(2026, 1, 1))
  controller.open()
  const first = controller.snapshot
  const second = controller.snapshot
  assert.notEqual(first, second)
  assert.notEqual(first.columns.years, second.columns.years)
  assert.deepEqual(first.columns.years, second.columns.years)
})
