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

function countDateConstructions(callback) {
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
    callback()
    return constructions
  }
  finally {
    globalThis.Date = NativeDate
  }
}

test('normalizing an aligned value does not scan the entire day', () => {
  const seed = localDate(2026, 8, 8, 12, 30)
  let controller
  const constructions = countDateConstructions(() => {
    controller = new DatePickerController({ enableTime: true, minuteStep: 1 }, seed)
  })

  assert.equal(controller.value?.getTime(), seed.getTime())
  assert.ok(constructions < 100, `constructed ${constructions} Date objects`)
})

test('normalizing an off-grid value searches candidates lazily', () => {
  const seed = localDate(2026, 8, 8, 12, 31, 59, 999)
  let controller
  const constructions = countDateConstructions(() => {
    controller = new DatePickerController({ enableTime: true, minuteStep: 5 }, seed)
  })

  assert.equal(controller.value?.getMinutes(), 30)
  assert.equal(controller.value?.getSeconds(), 0)
  assert.equal(controller.value?.getMilliseconds(), 0)
  assert.ok(constructions < 150, `constructed ${constructions} Date objects`)
})

test('changing minuteStep invalidates columns and normalizes the value', () => {
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
  assert.throws(
    () => new DatePickerController({ now: () => new Date(Number.NaN) }),
    /valid Date/,
  )
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

test('skipped civil days are excluded from day columns', {
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

test('years 0 through 99 preserve constructor overflow across year boundaries', () => {
  const nextYear = createLocalDate(42, 12, 1)
  assert.equal(nextYear.getFullYear(), 43)
  assert.equal(nextYear.getMonth(), 0)
  assert.equal(nextYear.getDate(), 1)

  const previousYear = createLocalDate(42, 0, 0)
  assert.equal(previousYear.getFullYear(), 41)
  assert.equal(previousYear.getMonth(), 11)
  assert.equal(previousYear.getDate(), 31)
})

test('low years do not inherit a surrogate year DST gap', {
  skip: process.env.TZ !== 'America/New_York',
}, () => {
  const value = createLocalDate(42, 3, 2, 2, 30)
  assert.equal(value.getFullYear(), 42)
  assert.equal(value.getMonth(), 3)
  assert.equal(value.getDate(), 2)
  assert.equal(value.getHours(), 2)
  assert.equal(value.getMinutes(), 30)
})

test('selecting a boundary month clamps lower parts without reverting the month', () => {
  const minDate = localDate(2033, 9, 24, 12, 40)
  const maxDate = localDate(2033, 10, 2, 13, 20)
  const controller = new DatePickerController({
    enableTime: true,
    minDate,
    maxDate,
    minuteStep: 1,
  }, localDate(2033, 9, 27, 13, 1))
  controller.open()

  assert.deepEqual(controller.snapshot.columns.months, [9, 10])
  assert.equal(controller.select('month', 10), true)
  assert.equal(controller.snapshot.parts.month, 10)
  assert.ok((controller.value?.getTime() ?? -Infinity) <= maxDate.getTime())
  assert.ok((controller.value?.getTime() ?? Infinity) >= minDate.getTime())
})

test('cancel invalidates a pending WheelMotion completion', () => {
  const frames = []
  const completed = []
  const motion = new WheelMotion({
    write() {},
    requestFrame(callback) { frames.push(callback) },
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
})

test('enabling reduced motion during a snap completes it exactly once', () => {
  const frames = []
  let completions = 0
  const motion = new WheelMotion({
    write() {},
    requestFrame(callback) { frames.push(callback) },
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
