import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DatePickerController,
  dateToParts,
  dayInterval,
  exactLocalDateTimes,
  floorToMinute,
  ceilToMinute,
  isValidDate,
  localDate,
  normalizeBounds,
} from '../dist/core/index.js'

function sortedUnique(values) {
  return values.every((value, index) => index === 0 || values[index - 1] < value)
}

function generator(seed = 0x5eed1234) {
  let state = seed >>> 0
  return max => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) % max
  }
}

test('localDate preserves Date-constructor overflow semantics for years 0 through 99', () => {
  const nextYear = localDate(42, 12, 1)
  assert.equal(nextYear.getFullYear(), 43)
  assert.equal(nextYear.getMonth(), 0)
  assert.equal(nextYear.getDate(), 1)

  const previousYear = localDate(42, 0, 0)
  assert.equal(previousYear.getFullYear(), 41)
  assert.equal(previousYear.getMonth(), 11)
  assert.equal(previousYear.getDate(), 31)

  const leapOverflow = localDate(0, 1, 30)
  assert.equal(leapOverflow.getFullYear(), 0)
  assert.equal(leapOverflow.getMonth(), 2)
  assert.equal(leapOverflow.getDate(), 1)
})

test('minute rounding is ordered and produces whole local minutes', () => {
  const random = generator()
  for (let index = 0; index < 250; index += 1) {
    const date = new Date(
      2000 + random(50),
      random(12),
      1 + random(28),
      random(24),
      random(60),
      random(60),
      random(1000),
    )
    const floor = floorToMinute(date)
    const ceil = ceilToMinute(date)
    assert.ok(floor.getTime() <= date.getTime())
    assert.ok(ceil.getTime() >= date.getTime())
    assert.equal(floor.getSeconds(), 0)
    assert.equal(floor.getMilliseconds(), 0)
    assert.equal(ceil.getSeconds(), 0)
    assert.equal(ceil.getMilliseconds(), 0)
  }
})

test('exactLocalDateTimes only returns exact, ordered and unique occurrences', () => {
  const random = generator(0x12345678)
  for (let index = 0; index < 300; index += 1) {
    const year = 1990 + random(60)
    const month = 1 + random(12)
    const day = 1 + random(28)
    const hour = random(24)
    const minute = random(60)
    const occurrences = exactLocalDateTimes(year, month, day, hour, minute)
    assert.ok(occurrences.length <= 2)
    assert.ok(sortedUnique(occurrences.map(value => value.getTime())))
    for (const occurrence of occurrences) {
      assert.deepEqual(dateToParts(occurrence), { year, month, day, hour, minute })
    }
  }
})

test('controller snapshots remain internally consistent across randomized bounds and selections', () => {
  const random = generator(0xc0ffee)
  const steps = [1, 5, 10, 15, 30]

  for (let index = 0; index < 120; index += 1) {
    const enableTime = random(2) === 1
    const step = steps[random(steps.length)]
    const year = 2010 + random(30)
    const month = random(12)
    const day = 1 + random(25)
    const base = new Date(year, month, day, random(24), random(60), random(60), random(1000))
    const minDate = new Date(base.getTime() - (1 + random(7)) * 86_400_000 - random(3_600_000))
    const maxDate = new Date(base.getTime() + (1 + random(7)) * 86_400_000 + random(3_600_000))
    const supplied = new Date(base.getTime() + (random(5) - 2) * 86_400_000)

    const controller = new DatePickerController({
      enableTime,
      minuteStep: step,
      minDate,
      maxDate,
      pastYears: 2,
      futureYears: 2,
    }, supplied)
    controller.open()

    const bounds = normalizeBounds(minDate, maxDate, enableTime)
    const snapshot = controller.snapshot
    assert.ok(isValidDate(snapshot.draft))
    assert.ok(snapshot.value && isValidDate(snapshot.value))
    assert.ok(!bounds.min || snapshot.value.getTime() >= bounds.min.getTime())
    assert.ok(!bounds.max || snapshot.value.getTime() <= bounds.max.getTime())

    for (const values of Object.values(snapshot.columns)) {
      assert.ok(sortedUnique(values), `column is not sorted/unique: ${values}`)
    }

    assert.ok(snapshot.columns.years.includes(snapshot.parts.year))
    assert.ok(snapshot.columns.months.includes(snapshot.parts.month))
    assert.ok(snapshot.columns.days.includes(snapshot.parts.day))
    if (enableTime) {
      assert.ok(snapshot.columns.hours.includes(snapshot.parts.hour))
      assert.ok(snapshot.columns.minutes.includes(snapshot.parts.minute))
    }
    else {
      assert.deepEqual(snapshot.columns.hours, [])
      assert.deepEqual(snapshot.columns.minutes, [])
    }

    const parts = enableTime
      ? ['year', 'month', 'day', 'hour', 'minute']
      : ['year', 'month', 'day']
    for (const part of parts) {
      const current = controller.snapshot
      const values = current.columns[`${part}s`]
      if (!values.length) continue
      const chosen = values[Math.floor(values.length / 2)]
      assert.equal(controller.select(part, chosen), true)
      assert.equal(controller.snapshot.parts[part], chosen)
      const value = controller.value
      assert.ok(value && isValidDate(value))
      assert.ok(!bounds.min || value.getTime() >= bounds.min.getTime())
      assert.ok(!bounds.max || value.getTime() <= bounds.max.getTime())
    }
  }
})

test('day intervals stay on the requested civil day and remain ordered', () => {
  const random = generator(0xabcdef01)
  for (let index = 0; index < 120; index += 1) {
    const year = 1990 + random(60)
    const month = 1 + random(12)
    const day = 1 + random(28)
    const interval = dayInterval(year, month, day, true)
    if (!interval) continue
    const [start, end] = interval
    assert.ok(start.getTime() <= end.getTime())
    for (const value of [start, end]) {
      assert.equal(value.getFullYear(), year)
      assert.equal(value.getMonth() + 1, month)
      assert.equal(value.getDate(), day)
      assert.equal(value.getSeconds(), 0)
      assert.equal(value.getMilliseconds(), 0)
    }
  }
})
