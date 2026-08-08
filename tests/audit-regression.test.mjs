import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DatePickerController,
  exactLocalDateTimes,
  localDate as createLocalDate,
} from '../dist/core/index.js'
import { WheelMotion } from '../dist/dom/WheelMotion.js'

function localDate(year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
  const date = new Date(2000, month - 1, day, hour, minute, second, millisecond)
  date.setFullYear(year)
  return date
}

function withCountingDate(callback) {
  const NativeDate = globalThis.Date
  let constructions = 0

  class CountingDate extends NativeDate {
    constructor(...args) {
      super(...args)
      constructions += 1
    }
  }

  globalThis.Date = CountingDate
  try {
    callback(() => constructions)
  }
  finally {
    globalThis.Date = NativeDate
  }
}

test('an already valid aligned value is normalized without scanning the whole day', () => {
  const seed = localDate(2026, 8, 8, 12, 30)

  withCountingDate(getConstructions => {
    const controller = new DatePickerController(
      { enableTime: true, minuteStep: 1 },
      seed,
    )

    assert.equal(controller.value?.getTime(), seed.getTime())
    assert.ok(
      getConstructions() < 200,
      `normalizing one valid minute constructed ${getConstructions()} Date objects`,
    )
  })
})

test('in-range seconds and milliseconds are removed from external values', () => {
  const controller = new DatePickerController(
    { enableTime: true, minuteStep: 5 },
    localDate(2026, 8, 8, 12, 31, 59, 999),
  )

  assert.equal(controller.value?.getSeconds(), 0)
  assert.equal(controller.value?.getMilliseconds(), 0)
  assert.equal(controller.value?.getMinutes(), 30)
})

test('changing minuteStep invalidates minute columns and normalizes the value', () => {
  const controller = new DatePickerController(
    { enableTime: true, minuteStep: 5 },
    localDate(2026, 8, 8, 12, 25),
  )
  controller.open()
  assert.ok(controller.snapshot.columns.minutes.includes(25))

  controller.setOptions({ minuteStep: 15 })
  assert.deepEqual(controller.snapshot.columns.minutes, [0, 15, 30, 45])
  assert.equal(controller.value?.getMinutes(), 30)
})

test('external Date mutations cannot change controller state', () => {
  const source = localDate(2026, 8, 8, 12, 30)
  const controller = new DatePickerController({ enableTime: true }, source)
  source.setFullYear(2040)
  assert.equal(controller.value?.getFullYear(), 2026)
})

test('snapshot bound dates are defensive copies', () => {
  const min = localDate(2026, 1, 1)
  const controller = new DatePickerController({ minDate: min }, localDate(2026, 2, 1))
  const snapshot = controller.snapshot
  snapshot.options.minDate?.setFullYear(2040)
  assert.equal(controller.snapshot.options.minDate?.getFullYear(), 2026)
})

test('clear is idempotent and emits at most one change', () => {
  const controller = new DatePickerController({}, localDate(2026, 1, 1))
  const changes = []
  controller.subscribe(event => {
    if (event.type === 'change') changes.push(event)
  })
  controller.clear()
  controller.clear()
  assert.equal(changes.length, 1)
})

test('invalid now callbacks are rejected when read', () => {
  const controller = new DatePickerController({ now: () => new Date(Number.NaN) })
  assert.throws(() => controller.open(), /valid Date/)
})

test('repeated local minutes preserve the supplied occurrence', {
  skip: process.env.TZ !== 'America/New_York',
}, () => {
  const secondOccurrence = new Date('2024-11-03T06:30:00.000Z')
  const occurrences = exactLocalDateTimes(2024, 11, 3, 1, 30)
  assert.equal(occurrences.length, 2)

  const controller = new DatePickerController(
    { enableTime: true, minuteStep: 5 },
    secondOccurrence,
  )
  assert.equal(controller.value?.getTime(), secondOccurrence.getTime())
})

test('skipped civil days are excluded from the day column', {
  skip: process.env.TZ !== 'Pacific/Apia',
}, () => {
  const controller = new DatePickerController({}, localDate(2011, 12, 29))
  controller.open()
  assert.equal(controller.select('year', 2011), true)
  assert.equal(controller.select('month', 12), true)
  assert.equal(controller.snapshot.columns.days.includes(30), false)
})

test('years 0 through 99 retain their literal year', () => {
  const year = createLocalDate(42, 0, 1)
  assert.equal(year.getFullYear(), 42)
})

test('cancel invalidates a pending WheelMotion completion', () => {
  const frames = []
  const writes = []
  const completed = []
  const motion = new WheelMotion({
    write: value => writes.push(value),
    requestFrame: callback => frames.push(callback),
    responseTime: 32,
    epsilon: 0.01,
  })

  const generation = motion.input(40, value => value)
  motion.snap(40, generation, value => completed.push(value))
  motion.cancel()

  let timestamp = 0
  while (frames.length) {
    timestamp += 16.67
    frames.shift()(timestamp)
  }

  assert.deepEqual(completed, [])
  assert.equal(motion.phase, 'idle')
  assert.ok(writes.length <= 1)
})

test('enabling reduced motion during a snap completes it once', () => {
  const frames = []
  let completions = 0
  const motion = new WheelMotion({
    write() {},
    requestFrame: callback => frames.push(callback),
  })

  const generation = motion.input(40, value => value)
  motion.snap(40, generation, () => { completions += 1 })
  motion.setReducedMotion(true)
  motion.setReducedMotion(true)

  let timestamp = 0
  while (frames.length) {
    timestamp += 16.67
    frames.shift()(timestamp)
  }

  assert.equal(completions, 1)
  assert.equal(motion.position, 40)
  assert.equal(motion.phase, 'idle')
})
