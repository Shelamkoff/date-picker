import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DatePickerController,
  dateToParts,
  exactLocalDateTimes,
  formatDatePickerValue,
  isValidDate,
  localDate,
  normalizeBounds,
  normalizePickerDate,
} from '../dist/core/index.js'

function generator(seed = 0x71a11e5) {
  let state = seed >>> 0
  return max => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) % max
  }
}

function sortedUnique(values) {
  return values.every((value, index) => index === 0 || values[index - 1] < value)
}

function columnFor(snapshot, part) {
  switch (part) {
    case 'year': return snapshot.columns.years
    case 'month': return snapshot.columns.months
    case 'day': return snapshot.columns.days
    case 'hour': return snapshot.columns.hours
    case 'minute': return snapshot.columns.minutes
    default: throw new Error(`Unknown part: ${part}`)
  }
}

test('randomized bounded selections keep snapshots and selected parts consistent', () => {
  const random = generator()
  const steps = [1, 5, 10, 15, 30]

  for (let index = 0; index < 180; index += 1) {
    const enableTime = random(2) === 1
    const minuteStep = steps[random(steps.length)]
    const base = new Date(
      1995 + random(60),
      random(12),
      1 + random(28),
      random(24),
      random(60),
      random(60),
      random(1000),
    )
    const minDate = new Date(base.getTime() - (1 + random(40)) * 86_400_000 - random(3_600_000))
    const maxDate = new Date(base.getTime() + (1 + random(40)) * 86_400_000 + random(3_600_000))
    const supplied = new Date(base.getTime() + (random(101) - 50) * 86_400_000)

    const controller = new DatePickerController({
      enableTime,
      minDate,
      maxDate,
      minuteStep,
      pastYears: 3,
      futureYears: 3,
    }, supplied)
    controller.open()

    const effective = normalizeBounds(minDate, maxDate, enableTime)
    const initial = controller.snapshot
    assert.ok(initial.value && isValidDate(initial.value))
    assert.ok(isValidDate(initial.draft))
    assert.ok(!effective.min || initial.value.getTime() >= effective.min.getTime())
    assert.ok(!effective.max || initial.value.getTime() <= effective.max.getTime())

    for (const values of Object.values(initial.columns)) {
      assert.ok(sortedUnique(values), `column is not sorted and unique: ${values}`)
    }

    const parts = enableTime
      ? ['year', 'month', 'day', 'hour', 'minute']
      : ['year', 'month', 'day']

    for (const part of parts) {
      const before = controller.snapshot
      const values = columnFor(before, part)
      assert.ok(values.length > 0, `${part} column unexpectedly empty`)
      const chosen = values[random(values.length)]
      assert.equal(controller.select(part, chosen), true)
      const after = controller.snapshot
      assert.equal(after.parts[part], chosen, JSON.stringify({
        index,
        part,
        chosen,
        before: before.parts,
        after: after.parts,
        bounds: [effective.min?.toISOString(), effective.max?.toISOString()],
      }))
      assert.ok(after.value && isValidDate(after.value))
      assert.ok(!effective.min || after.value.getTime() >= effective.min.getTime())
      assert.ok(!effective.max || after.value.getTime() <= effective.max.getTime())
      assert.ok(after.columns.years.includes(after.parts.year))
      assert.ok(after.columns.months.includes(after.parts.month))
      assert.ok(after.columns.days.includes(after.parts.day))
      if (enableTime) {
        assert.ok(after.columns.hours.includes(after.parts.hour))
        assert.ok(after.columns.minutes.includes(after.parts.minute))
      }
    }
  }
})

test('invalid selections are side-effect free', () => {
  const controller = new DatePickerController(
    { enableTime: true, minuteStep: 5 },
    new Date(2026, 0, 15, 12, 30),
  )
  controller.open()
  const before = controller.snapshot

  assert.equal(controller.select('minute', 31), false)
  assert.equal(controller.select('hour', Number.NaN), false)
  assert.equal(controller.select('month', 13), false)

  const after = controller.snapshot
  assert.equal(after.value?.getTime(), before.value?.getTime())
  assert.equal(after.draft.getTime(), before.draft.getTime())
  assert.deepEqual(after.parts, before.parts)
})

test('listener payloads and option dates cannot mutate controller state', () => {
  const minDate = new Date(2026, 0, 1, 10, 0)
  const maxDate = new Date(2026, 0, 2, 10, 0)
  const controller = new DatePickerController(
    { enableTime: true, minDate, maxDate },
    new Date(2026, 0, 1, 12, 0),
  )

  minDate.setFullYear(2040)
  maxDate.setFullYear(2040)
  controller.open()
  let secondListenerValue = null
  controller.subscribe((event, snapshot) => {
    if (event.type === 'change' && event.value) event.value.setFullYear(2050)
    snapshot.value?.setFullYear(2050)
    snapshot.draft.setFullYear(2050)
    snapshot.options.minDate?.setFullYear(2050)
  })
  controller.subscribe((event, snapshot) => {
    if (event.type === 'change') secondListenerValue = event.value?.getFullYear() ?? null
    assert.notEqual(snapshot.draft.getFullYear(), 2050)
  })

  controller.select('hour', 13)
  assert.equal(controller.value?.getFullYear(), 2026)
  assert.equal(secondListenerValue, 2026)
  assert.equal(controller.snapshot.options.minDate?.getFullYear(), 2026)
})

test('all sampled low years preserve literal civil fields and overflow', () => {
  const random = generator(0x42)
  for (let index = 0; index < 300; index += 1) {
    const year = random(100)
    const monthIndex = random(16) - 2
    const day = random(40) - 4
    const hour = random(32) - 4
    const minute = random(80) - 10
    const value = localDate(year, monthIndex, day, hour, minute)
    assert.ok(isValidDate(value))

    const reference = new Date(0)
    reference.setHours(12, 0, 0, 0)
    reference.setFullYear(year, monthIndex, day)
    reference.setHours(hour, minute, 0, 0)

    assert.deepEqual(dateToParts(value), dateToParts(reference))
  }
})

test('exact local times are exact, ordered and unique', () => {
  const random = generator(0x1234abcd)
  for (let index = 0; index < 400; index += 1) {
    const expected = {
      year: 1970 + random(100),
      month: 1 + random(12),
      day: 1 + random(28),
      hour: random(24),
      minute: random(60),
    }
    const occurrences = exactLocalDateTimes(
      expected.year,
      expected.month,
      expected.day,
      expected.hour,
      expected.minute,
    )
    assert.ok(occurrences.length <= 2)
    for (let occurrence = 0; occurrence < occurrences.length; occurrence += 1) {
      assert.deepEqual(dateToParts(occurrences[occurrence]), expected)
      if (occurrence > 0) {
        assert.ok(occurrences[occurrence - 1].getTime() < occurrences[occurrence].getTime())
      }
    }
  }
})

test('Date range endpoints remain usable with every supported minute step', () => {
  const endpoints = [
    new Date(-8_640_000_000_000_000),
    new Date(8_640_000_000_000_000),
  ]

  for (const endpoint of endpoints) {
    for (const minuteStep of [1, 5, 10, 15, 30]) {
      const controller = new DatePickerController({
        enableTime: true,
        minuteStep,
        pastYears: 2,
        futureYears: 2,
      }, endpoint)
      controller.open()
      const snapshot = controller.snapshot
      assert.ok(snapshot.value && isValidDate(snapshot.value))
      assert.ok(snapshot.columns.years.includes(snapshot.parts.year))
      assert.ok(snapshot.columns.months.includes(snapshot.parts.month))
      assert.ok(snapshot.columns.days.includes(snapshot.parts.day))
      assert.ok(snapshot.columns.hours.includes(snapshot.parts.hour))
      assert.ok(snapshot.columns.minutes.includes(snapshot.parts.minute))
    }
  }
})

test('minute normalization stays inside the JavaScript Date range', () => {
  for (const instant of [
    -8_640_000_000_000_000,
    -8_640_000_000_000_000 + 1,
    -8_640_000_000_000_000 + 59_999,
    8_640_000_000_000_000 - 59_999,
    8_640_000_000_000_000 - 1,
    8_640_000_000_000_000,
  ]) {
    const normalized = normalizePickerDate(new Date(instant), true)
    assert.ok(isValidDate(normalized))
    assert.ok(normalized.getTime() >= -8_640_000_000_000_000)
    assert.ok(normalized.getTime() <= 8_640_000_000_000_000)
    assert.equal(normalized.getSeconds(), 0)
    assert.equal(normalized.getMilliseconds(), 0)
  }
})

test('formatting handles common-era and BCE values without throwing', () => {
  const common = localDate(42, 0, 2, 3, 4)
  const bce = localDate(-1, 0, 2, 3, 4)
  assert.ok(formatDatePickerValue(common, true, 'en-US').length > 0)
  assert.ok(formatDatePickerValue(bce, true, 'en-US').length > 0)
})
