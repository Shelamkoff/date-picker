import type { DateBounds, DateParts } from './types.js'

export function cloneDate(date: Date): Date {
  return new Date(Date.prototype.getTime.call(date))
}

export function isValidDate(date: unknown): date is Date {
  if (date === null || typeof date !== 'object') return false
  try {
    return Number.isFinite(Date.prototype.getTime.call(date))
  }
  catch {
    return false
  }
}

const MIN_DATE_TIME = -8_640_000_000_000_000
const MAX_DATE_TIME = 8_640_000_000_000_000

function compareCivilDate(
  leftYear: number, leftMonth: number, leftDay: number,
  rightYear: number, rightMonth: number, rightDay: number,
): number {
  if (leftYear !== rightYear) return leftYear < rightYear ? -1 : 1
  if (leftMonth !== rightMonth) return leftMonth < rightMonth ? -1 : 1
  if (leftDay !== rightDay) return leftDay < rightDay ? -1 : 1
  return 0
}

function representableLocalCivilBounds(): readonly [DateParts, DateParts] {
  const min = new Date(MIN_DATE_TIME)
  const max = new Date(MAX_DATE_TIME)
  return [
    { year: min.getFullYear(), month: min.getMonth() + 1, day: min.getDate(), hour: 0, minute: 0 },
    { year: max.getFullYear(), month: max.getMonth() + 1, day: max.getDate(), hour: 23, minute: 59 },
  ]
}

function civilDateMayBeRepresentable(year: number, month: number, day: number): boolean {
  const [min, max] = representableLocalCivilBounds()
  return compareCivilDate(year, month, day, min.year, min.month, min.day) >= 0
    && compareCivilDate(year, month, day, max.year, max.month, max.day) <= 0
}

function civilMonthMayBeRepresentable(year: number, month: number): boolean {
  const lastDay = daysInMonth(year, month)
  return lastDay > 0
    && (civilDateMayBeRepresentable(year, month, 1)
      || civilDateMayBeRepresentable(year, month, lastDay))
}

function civilYearMayBeRepresentable(year: number): boolean {
  const [min, max] = representableLocalCivilBounds()
  return year >= min.year && year <= max.year
}

/**
 * Constructs a local civil Date without JavaScript's 1900 offset for years 0..99.
 * The picker intentionally works with the host environment's local civil time.
 */
export function localDate(
  year: number,
  monthIndex: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
): Date {
  // Set all civil fields in one constructor operation. Near the ECMAScript
  // Date limits, staging the year and time in separate setter calls can make
  // the intermediate value overflow even when the final local time exists.
  const wholeYear = Math.trunc(year)
  if (Number.isFinite(year) && wholeYear >= 0 && wholeYear <= 99) {
    // The multi-argument Date constructor maps years 0..99 to 1900..1999.
    // Apply the target year through local setters instead, so overflow keeps
    // native Date semantics without borrowing DST rules from a surrogate year.
    const date = new Date(0)
    date.setHours(12, 0, 0, 0)
    date.setFullYear(wholeYear, monthIndex, day)
    date.setHours(hour, minute, second, millisecond)
    return date
  }
  return new Date(year, monthIndex, day, hour, minute, second, millisecond)
}

export function startOfDay(date: Date): Date {
  if (!isValidDate(date)) throw new RangeError('date must be a valid Date')
  const first = firstExactMinuteOfDay(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
  )
  if (!first) {
    throw new RangeError('Local civil day has no representable whole minute')
  }
  return first
}

function isWholeLocalMinute(date: Date): boolean {
  return isValidDate(date) && date.getSeconds() === 0 && date.getMilliseconds() === 0
}

function nearestWholeLocalMinute(date: Date, direction: -1 | 1): Date {
  const instant = Date.prototype.getTime.call(date)
  const alignedSecond = direction < 0
    ? Math.floor(instant / 1000) * 1000
    : Math.ceil(instant / 1000) * 1000

  // Whole local minutes still recur regularly even when a historical zone
  // offset contains seconds or changes at a transition. A five-minute instant
  // window comfortably covers those sub-minute transition edges while keeping
  // normalization bounded and deterministic.
  for (let delta = 0; delta <= 300_000; delta += 1000) {
    const candidateTime = alignedSecond + direction * delta
    if (candidateTime < MIN_DATE_TIME || candidateTime > MAX_DATE_TIME) continue
    const candidate = new Date(candidateTime)
    if (isWholeLocalMinute(candidate)) return candidate
  }

  throw new RangeError('Local minute normalization is outside the representable JavaScript Date range')
}

export function floorToMinute(date: Date): Date {
  if (!isValidDate(date)) throw new RangeError('date must be a valid Date')
  if (isWholeLocalMinute(date)) return cloneDate(date)

  const millisecondsIntoLocalMinute = date.getSeconds() * 1000 + date.getMilliseconds()
  const fast = new Date(Date.prototype.getTime.call(date) - millisecondsIntoLocalMinute)
  if (isWholeLocalMinute(fast) && fast.getTime() <= date.getTime()) return fast
  return nearestWholeLocalMinute(date, -1)
}

export function ceilToMinute(date: Date): Date {
  if (!isValidDate(date)) throw new RangeError('date must be a valid Date')
  if (isWholeLocalMinute(date)) return cloneDate(date)

  const millisecondsIntoLocalMinute = date.getSeconds() * 1000 + date.getMilliseconds()
  const fast = new Date(Date.prototype.getTime.call(date) + (60_000 - millisecondsIntoLocalMinute))
  if (isWholeLocalMinute(fast) && fast.getTime() >= date.getTime()) return fast
  return nearestWholeLocalMinute(date, 1)
}

export function normalizePickerDate(date: Date, enableTime: boolean): Date {
  if (!isValidDate(date)) throw new RangeError('value must be a valid Date')
  if (!enableTime) return startOfDay(date)
  try {
    return floorToMinute(date)
  }
  catch (error) {
    if (!(error instanceof RangeError)) throw error
    // At the lower ECMAScript Date boundary, historical local offsets may put
    // the first representable instant part-way through a wall-clock minute.
    // The minute-resolution picker must seed the first complete minute that
    // actually exists instead of rejecting an otherwise valid Date.
    return ceilToMinute(date)
  }
}

export function normalizeBounds(
  minDate: Date | null | undefined,
  maxDate: Date | null | undefined,
  enableTime: boolean,
): DateBounds {
  if (minDate != null && !isValidDate(minDate)) {
    throw new RangeError('minDate must be a valid Date')
  }
  if (maxDate != null && !isValidDate(maxDate)) {
    throw new RangeError('maxDate must be a valid Date')
  }

  const min = minDate
    ? enableTime ? ceilToMinute(minDate) : startOfDay(minDate)
    : null
  const max = maxDate
    ? enableTime ? floorToMinute(maxDate) : startOfDay(maxDate)
    : null

  if (min && max && min.getTime() > max.getTime()) {
    throw new RangeError('minDate must be earlier than or equal to maxDate')
  }

  return { min, max }
}

export function clampDate(date: Date, bounds: DateBounds): Date {
  if (!isValidDate(date)) throw new RangeError('date must be a valid Date')
  const time = date.getTime()
  if (bounds.min && time < bounds.min.getTime()) return cloneDate(bounds.min)
  if (bounds.max && time > bounds.max.getTime()) return cloneDate(bounds.max)
  return cloneDate(date)
}

export function isLeapYear(year: number): boolean {
  const value = Math.trunc(year)
  return value % 4 === 0 && (value % 100 !== 0 || value % 400 === 0)
}

/** Nominal proleptic-Gregorian month length, independent of host time zone. */
export function daysInMonth(year: number, month: number): number {
  if (!Number.isFinite(year) || !Number.isFinite(month)) return 0
  const safeMonth = Math.trunc(month)
  if (safeMonth < 1 || safeMonth > 12) return 0

  if (safeMonth === 2) return isLeapYear(year) ? 29 : 28
  if (safeMonth === 4 || safeMonth === 6 || safeMonth === 9 || safeMonth === 11) return 30
  return 31
}

export function dateToParts(date: Date): DateParts {
  if (!isValidDate(date)) throw new RangeError('date must be a valid Date')
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
  }
}

export function partsToDate(parts: DateParts, enableTime: boolean): Date {
  const year = Math.trunc(parts.year)
  const month = Math.min(12, Math.max(1, Math.trunc(parts.month)))
  const day = Math.min(
    daysInMonth(year, month),
    Math.max(1, Math.trunc(parts.day)),
  )

  if (!enableTime) {
    const first = firstExactMinuteOfDay(year, month, day)
    if (!first) throw new RangeError('Local civil day has no representable whole minute')
    return first
  }

  const hour = Math.min(23, Math.max(0, Math.trunc(parts.hour)))
  const minute = Math.min(59, Math.max(0, Math.trunc(parts.minute)))
  const exact = exactLocalDateTimes(year, month, day, hour, minute)
  const first = exact[0]
  if (!first) throw new RangeError('Local civil minute does not exist')
  return cloneDate(first)
}

export function isExactLocalDateTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): boolean {
  const date = minuteDate(year, month, day, hour, minute)
  return isValidDate(date)
    && date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day
    && date.getHours() === hour
    && date.getMinutes() === minute
}

export function minuteDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  return localDate(year, month - 1, day, hour, minute)
}

/**
 * Returns every representable instant for one local civil minute. Most wall
 * minutes have one occurrence; an autumn clock rollback can have two.
 */

function utcCivilMilliseconds(date: Date): number {
  const year = date.getFullYear()
  const month = date.getMonth()
  const day = date.getDate()
  const hour = date.getHours()
  const minute = date.getMinutes()
  const second = date.getSeconds()
  const millisecond = date.getMilliseconds()

  if (year >= 0 && year <= 99) {
    const surrogate = new Date(Date.UTC(2000 + year, month, day, hour, minute, second, millisecond))
    surrogate.setUTCFullYear(year)
    return surrogate.getTime()
  }
  return Date.UTC(year, month, day, hour, minute, second, millisecond)
}

function exactOffsetMilliseconds(date: Date): number {
  return Date.prototype.getTime.call(date) - utcCivilMilliseconds(date)
}

export function exactLocalDateTimes(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date[] {
  const primary = minuteDate(year, month, day, hour, minute)
  if (
    !isValidDate(primary)
    || primary.getFullYear() !== year
    || primary.getMonth() !== month - 1
    || primary.getDate() !== day
    || primary.getHours() !== hour
    || primary.getMinutes() !== minute
  ) {
    return []
  }

  const results = [primary]
  const primaryOffset = exactOffsetMilliseconds(primary)
  const probeOffsets = new Set<number>([primaryOffset])
  // Historical IANA offsets were not always minute-aligned (for example
  // Paris used GMT+00:09:21). Use an exact millisecond offset derived from
  // the civil fields instead of getTimezoneOffset(), which truncates to
  // whole minutes and can miss repeated wall times.
  for (const delta of [-172_800_000, -86_400_000, 86_400_000, 172_800_000]) {
    const probe = new Date(primary.getTime() + delta)
    if (isValidDate(probe)) probeOffsets.add(exactOffsetMilliseconds(probe))
  }

  for (const offset of probeOffsets) {
    if (offset === primaryOffset) continue
    const candidate = new Date(primary.getTime() + (offset - primaryOffset))
    if (
      isValidDate(candidate)
      && candidate.getFullYear() === year
      && candidate.getMonth() === month - 1
      && candidate.getDate() === day
      && candidate.getHours() === hour
      && candidate.getMinutes() === minute
      && !results.some(existing => existing.getTime() === candidate.getTime())
    ) {
      results.push(candidate)
    }
  }

  results.sort((left, right) => left.getTime() - right.getTime())
  return results
}

function firstExactMinuteOfDay(year: number, month: number, day: number): Date | null {
  for (let minuteOfDay = 0; minuteOfDay < 24 * 60; minuteOfDay += 1) {
    const hour = Math.floor(minuteOfDay / 60)
    const minute = minuteOfDay % 60
    const occurrences = exactLocalDateTimes(year, month, day, hour, minute)
    const first = occurrences[0]
    if (first) return cloneDate(first)
  }
  return null
}

function lastExactMinuteOfDay(year: number, month: number, day: number): Date | null {
  for (let minuteOfDay = 24 * 60 - 1; minuteOfDay >= 0; minuteOfDay -= 1) {
    const hour = Math.floor(minuteOfDay / 60)
    const minute = minuteOfDay % 60
    const occurrences = exactLocalDateTimes(year, month, day, hour, minute)
    const last = occurrences.at(-1)
    if (last) return cloneDate(last)
  }
  return null
}

export function civilDayExists(year: number, month: number, day: number): boolean {
  if (day < 1 || day > daysInMonth(year, month)) return false
  if (!civilDateMayBeRepresentable(year, month, day)) return false

  for (let hour = 0; hour <= 23; hour += 1) {
    if (isExactLocalDateTime(year, month, day, hour, 0)) return true
  }

  return firstExactMinuteOfDay(year, month, day) !== null
}

export function nearestExistingCivilDay(
  year: number,
  month: number,
  requestedDay: number,
): number | null {
  const lastDay = daysInMonth(year, month)
  if (lastDay <= 0) return null
  const start = Math.min(lastDay, Math.max(1, Math.trunc(requestedDay)))
  if (civilDayExists(year, month, start)) return start

  for (let distance = 1; distance < lastDay; distance += 1) {
    const before = start - distance
    const after = start + distance
    if (before >= 1 && civilDayExists(year, month, before)) return before
    if (after <= lastDay && civilDayExists(year, month, after)) return after
  }
  return null
}

export function nearestExistingCivilDateInYear(
  year: number,
  requestedMonth: number,
  requestedDay: number,
): Readonly<Pick<DateParts, 'month' | 'day'>> | null {
  const startMonth = Math.min(12, Math.max(1, Math.trunc(requestedMonth)))

  for (let distance = 0; distance < 12; distance += 1) {
    const before = startMonth - distance
    const after = startMonth + distance
    const candidates = distance === 0 ? [startMonth] : [before, after]
    for (const month of candidates) {
      if (month < 1 || month > 12) continue
      const day = nearestExistingCivilDay(year, month, requestedDay)
      if (day !== null) return { month, day }
    }
  }
  return null
}

export function rangeIntersects(start: Date, end: Date, bounds: DateBounds): boolean {
  if (!isValidDate(start) || !isValidDate(end)) return false
  if (bounds.min && end.getTime() < bounds.min.getTime()) return false
  if (bounds.max && start.getTime() > bounds.max.getTime()) return false
  return true
}

export function dayInterval(
  year: number,
  month: number,
  day: number,
  enableTime: boolean,
): readonly [Date, Date] | null {
  if (day < 1 || day > daysInMonth(year, month)) return null
  if (!civilDateMayBeRepresentable(year, month, day)) return null
  const first = firstExactMinuteOfDay(year, month, day)
  if (!first) return null
  if (!enableTime) return [first, first]
  const last = lastExactMinuteOfDay(year, month, day)
  return last ? [first, last] : null
}

export function monthInterval(
  year: number,
  month: number,
  enableTime: boolean,
): readonly [Date, Date] | null {
  if (!civilMonthMayBeRepresentable(year, month)) return null
  const lastDay = daysInMonth(year, month)
  if (lastDay <= 0) return null

  let first: Date | null = null
  for (let day = 1; day <= lastDay; day += 1) {
    const interval = dayInterval(year, month, day, enableTime)
    if (interval) {
      first = interval[0]
      break
    }
  }
  if (!first) return null

  for (let day = lastDay; day >= 1; day -= 1) {
    const interval = dayInterval(year, month, day, enableTime)
    if (interval) return [first, interval[1]]
  }
  return null
}

export function yearInterval(year: number, enableTime: boolean): readonly [Date, Date] | null {
  if (!civilYearMayBeRepresentable(year)) return null
  let first: Date | null = null
  for (let month = 1; month <= 12; month += 1) {
    const interval = monthInterval(year, month, enableTime)
    if (interval) {
      first = interval[0]
      break
    }
  }
  if (!first) return null

  for (let month = 12; month >= 1; month -= 1) {
    const interval = monthInterval(year, month, enableTime)
    if (interval) return [first, interval[1]]
  }
  return null
}

export function integerRange(start: number, end: number, step = 1): number[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(step) || step <= 0) {
    return []
  }
  const values: number[] = []
  const safeStart = Math.trunc(start)
  const safeEnd = Math.trunc(end)
  const safeStep = Math.max(1, Math.trunc(step))
  for (let value = safeStart; value <= safeEnd; value += safeStep) values.push(value)
  return values
}

export function yearWindow(
  selectedYear: number,
  minYear: number | undefined,
  maxYear: number | undefined,
  pastYears: number,
  futureYears: number,
): readonly [number, number] {
  const safePast = Number.isFinite(pastYears)
    ? Math.min(1000, Math.max(0, Math.trunc(pastYears)))
    : 100
  const safeFuture = Number.isFinite(futureYears)
    ? Math.min(1000, Math.max(0, Math.trunc(futureYears)))
    : 20
  const selected = Math.trunc(selectedYear)

  let start = selected - safePast
  let end = selected + safeFuture
  if (minYear !== undefined && Number.isFinite(minYear)) start = Math.max(start, Math.trunc(minYear))
  if (maxYear !== undefined && Number.isFinite(maxYear)) end = Math.min(end, Math.trunc(maxYear))
  if (start <= end) return [start, end]

  const lower = minYear !== undefined && Number.isFinite(minYear) ? Math.trunc(minYear) : -Infinity
  const upper = maxYear !== undefined && Number.isFinite(maxYear) ? Math.trunc(maxYear) : Infinity
  const fallback = Math.min(upper, Math.max(lower, selected))
  return [fallback, fallback]
}
