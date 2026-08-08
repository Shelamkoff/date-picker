import test from 'node:test'
import assert from 'node:assert/strict'
import { DatePickerController } from '../dist/core/controller.js'

process.env.TZ = 'Australia/Lord_Howe'

function localDate(year, month, day, hour = 0, minute = 0) {
  return new Date(year, month - 1, day, hour, minute, 0, 0)
}

test('partial DST gaps expose only representable step minutes', () => {
  const controller = new DatePickerController(
    { enableTime: true, minuteStep: 15 },
    localDate(2024, 10, 6, 1, 45),
  )
  controller.open()
  assert.equal(controller.select('hour', 2), true)
  const snapshot = controller.snapshot
  assert.equal(snapshot.parts.hour, 2)
  assert.deepEqual(snapshot.columns.minutes, [30, 45])
})
