import {
  clampDate,
  cloneDate,
  dateToParts,
  dayInterval,
  exactLocalDateTimes,
  daysInMonth,
  integerRange,
  isValidDate,
  monthInterval,
  nearestExistingCivilDateInYear,
  nearestExistingCivilDay,
  normalizeBounds,
  normalizePickerDate,
  partsToDate,
  rangeIntersects,
  yearInterval,
  yearWindow,
} from './calendar.js'
import type {
  DateBounds,
  DatePart,
  DateParts,
  DatePickerColumns,
  DatePickerEvent,
  DatePickerListener,
  DatePickerOptions,
  DatePickerSnapshot,
  ResolvedDatePickerOptions,
} from './types.js'

const DEFAULT_OPTIONS: Omit<ResolvedDatePickerOptions, 'now'> = {
  enableTime: false,
  minDate: null,
  maxDate: null,
  pastYears: 100,
  futureYears: 20,
  minuteStep: 1,
}

function sanitizeWindow(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(1000, Math.max(0, Math.trunc(value)))
}

function sanitizeMinuteStep(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1
  const step = Math.trunc(value)
  return step >= 1 && step <= 30 ? step : 1
}

function resolveDateOption(
  value: Date | null | undefined,
  previous: Date | null | undefined,
  name: 'minDate' | 'maxDate',
): Date | null {
  if (value === undefined) return previous ? cloneDate(previous) : null
  if (value === null) return null
  if (!isValidDate(value)) throw new RangeError(`${name} must be null or a valid Date`)
  return cloneDate(value)
}

function resolveOptions(
  previous: ResolvedDatePickerOptions | null,
  patch: DatePickerOptions,
): ResolvedDatePickerOptions {
  const enableTime = patch.enableTime ?? previous?.enableTime ?? DEFAULT_OPTIONS.enableTime
  const minDate = resolveDateOption(patch.minDate, previous?.minDate, 'minDate')
  const maxDate = resolveDateOption(patch.maxDate, previous?.maxDate, 'maxDate')
  const now = patch.now !== undefined
    ? patch.now ?? (() => new Date())
    : previous?.now ?? (() => new Date())
  if (typeof now !== 'function') throw new TypeError('now must be a function or null')

  normalizeBounds(minDate, maxDate, enableTime)

  return {
    enableTime,
    minDate,
    maxDate,
    pastYears: sanitizeWindow(patch.pastYears, previous?.pastYears ?? DEFAULT_OPTIONS.pastYears),
    futureYears: sanitizeWindow(patch.futureYears, previous?.futureYears ?? DEFAULT_OPTIONS.futureYears),
    minuteStep: sanitizeMinuteStep(patch.minuteStep ?? previous?.minuteStep),
    now,
  }
}

function cloneNullable(date: Date | null): Date | null {
  return date ? cloneDate(date) : null
}

function boundsForOptions(options: ResolvedDatePickerOptions): DateBounds {
  return normalizeBounds(options.minDate, options.maxDate, options.enableTime)
}

function normalizedSeedForOptions(date: Date, options: ResolvedDatePickerOptions): Date {
  return clampDate(normalizePickerDate(date, options.enableTime), boundsForOptions(options))
}

export class DatePickerController {
  #options: ResolvedDatePickerOptions
  #value: Date | null
  #draft: Date
  #open = false
  #listeners = new Set<DatePickerListener>()

  constructor(options: DatePickerOptions = {}, value: Date | null = null) {
    this.#options = resolveOptions(null, options)
    if (value != null && !isValidDate(value)) {
      throw new RangeError('value must be null or a valid Date')
    }
    const seed = value ?? this.#readNow()
    const draft = normalizedSeedForOptions(seed, this.#options)
    this.#value = cloneNullable(value)
    this.#draft = draft
  }

  subscribe(listener: DatePickerListener): () => void {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function')
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  get value(): Date | null {
    return cloneNullable(this.#value)
  }

  get isOpen(): boolean {
    return this.#open
  }

  get enableTime(): boolean {
    return this.#options.enableTime
  }

  get isOutOfRange(): boolean {
    return this.#isOutOfRange(this.#bounds())
  }

  get snapshot(): DatePickerSnapshot {
    const bounds = this.#bounds()
    const parts = dateToParts(this.#draft)
    return {
      value: cloneNullable(this.#value),
      draft: cloneDate(this.#draft),
      parts,
      columns: this.#columns(parts, bounds),
      isOpen: this.#open,
      isOutOfRange: this.#isOutOfRange(bounds),
      options: {
        enableTime: this.#options.enableTime,
        minDate: cloneNullable(this.#options.minDate),
        maxDate: cloneNullable(this.#options.maxDate),
        pastYears: this.#options.pastYears,
        futureYears: this.#options.futureYears,
        minuteStep: this.#options.minuteStep,
      },
    }
  }

  setValue(value: Date | null): void {
    if (value != null && !isValidDate(value)) {
      throw new RangeError('value must be null or a valid Date')
    }

    const nextValue = cloneNullable(value)
    const nextDraft = this.#normalizedSeed(nextValue ?? this.#draft)
    this.#value = nextValue
    this.#draft = nextDraft
    this.#emit({ type: 'state', reason: 'external' })
  }

  setOptions(options: DatePickerOptions): void {
    this.configure(options)
  }

  /**
   * Atomically applies option changes and, when supplied, an external value.
   * Validation and local-time normalization complete before observable state is committed.
   */
  configure(options: DatePickerOptions, state?: { readonly value: Date | null }): void {
    const nextOptions = resolveOptions(this.#options, options)
    const hasValue = state !== undefined
    const requestedValue = hasValue ? state.value : this.#value
    if (requestedValue != null && !isValidDate(requestedValue)) {
      throw new RangeError('value must be null or a valid Date')
    }

    const nextValue = cloneNullable(requestedValue)
    const source = nextValue ?? this.#draft
    const nextDraft = normalizedSeedForOptions(source, nextOptions)

    this.#options = nextOptions
    if (hasValue) this.#value = nextValue
    this.#draft = nextDraft
    this.#emit({ type: 'state', reason: hasValue ? 'external' : 'options' })
  }

  open(seed?: Date): void {
    const source = this.#value ?? seed ?? this.#readNow()
    this.#draft = this.#normalizedSeed(source)
    this.#open = true
    this.#emit({ type: 'state', reason: 'open' })
  }

  close(): void {
    if (!this.#open) return
    this.#open = false
    this.#emit({ type: 'state', reason: 'close' })
  }

  resetDraft(seed?: Date): void {
    const source = this.#value ?? seed ?? this.#readNow()
    this.#draft = this.#normalizedSeed(source)
    this.#emit({ type: 'state', reason: 'draft' })
  }

  clear(): void {
    this.#value = null
    this.#emit({ type: 'change', reason: 'clear', value: null })
  }

  selectNow(): Date {
    return this.#commit(this.#readNow(), 'now')
  }

  select(part: DatePart, value: number): boolean {
    const bounds = this.#bounds()
    const parts = dateToParts(this.#draft)
    if (!this.#partAllowed(part, value, parts, bounds)) return false

    const changed: DateParts = { ...parts, [part]: value }
    const next: DateParts = part === 'year' || part === 'month'
      ? {
          ...changed,
          day: Math.min(changed.day, daysInMonth(changed.year, changed.month)),
        }
      : changed

    const date = this.#dateFromParts(next, part)
    this.#commit(date, 'select')
    return true
  }

  #partAllowed(part: DatePart, value: number, parts: DateParts, bounds: DateBounds): boolean {
    if (!Number.isInteger(value)) return false

    switch (part) {
      case 'year': {
        const [start, end] = yearWindow(
          parts.year,
          bounds.min?.getFullYear(),
          bounds.max?.getFullYear(),
          this.#options.pastYears,
          this.#options.futureYears,
        )
        if (value < start || value > end) return false
        const interval = yearInterval(value, this.#options.enableTime)
        return interval !== null && rangeIntersects(interval[0], interval[1], bounds)
      }
      case 'month': {
        if (value < 1 || value > 12) return false
        const interval = monthInterval(parts.year, value, this.#options.enableTime)
        return interval !== null && rangeIntersects(interval[0], interval[1], bounds)
      }
      case 'day': {
        if (value < 1 || value > daysInMonth(parts.year, parts.month)) return false
        const interval = dayInterval(parts.year, parts.month, value, this.#options.enableTime)
        return interval !== null && rangeIntersects(interval[0], interval[1], bounds)
      }
      case 'hour': {
        if (!this.#options.enableTime || value < 0 || value > 23) return false
        return integerRange(0, 59).some(minute => this.#minuteAllowed(
          parts.year,
          parts.month,
          parts.day,
          value,
          minute,
          bounds,
        ))
      }
      case 'minute': {
        if (!this.#options.enableTime || value < 0 || value > 59) return false
        const followsStep = value % this.#options.minuteStep === 0
        if (!followsStep && value !== parts.minute) return false
        return this.#minuteAllowed(
          parts.year,
          parts.month,
          parts.day,
          parts.hour,
          value,
          bounds,
        )
      }
      default: return false
    }
  }

  #emit(event: DatePickerEvent): void {
    if (this.#listeners.size === 0) return
    const snapshot = this.snapshot
    for (const listener of [...this.#listeners]) {
      listener(cloneEvent(event), cloneSnapshot(snapshot))
    }
  }

  #readNow(): Date {
    const value = this.#options.now()
    if (!isValidDate(value)) throw new RangeError('options.now() must return a valid Date')
    return cloneDate(value)
  }

  #bounds(): DateBounds {
    return boundsForOptions(this.#options)
  }

  #normalizedSeed(date: Date): Date {
    return normalizedSeedForOptions(date, this.#options)
  }

  #isOutOfRange(bounds: DateBounds): boolean {
    if (!this.#value) return false
    const value = normalizePickerDate(this.#value, this.#options.enableTime)
    const time = value.getTime()
    return Boolean(
      (bounds.min && time < bounds.min.getTime())
      || (bounds.max && time > bounds.max.getTime()),
    )
  }

  #commit(date: Date, reason: 'select' | 'now'): Date {
    const next = this.#normalizedSeed(date)
    this.#draft = cloneDate(next)
    this.#value = cloneDate(next)
    const emitted = cloneDate(next)
    this.#emit({ type: 'change', reason, value: emitted })
    return cloneDate(next)
  }

  #minuteCandidates(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    bounds: DateBounds,
  ): Date[] {
    return exactLocalDateTimes(year, month, day, hour, minute).filter(candidate => {
      const time = candidate.getTime()
      return (!bounds.min || time >= bounds.min.getTime())
        && (!bounds.max || time <= bounds.max.getTime())
    })
  }

  #minuteAllowed(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    bounds: DateBounds,
  ): boolean {
    return this.#minuteCandidates(year, month, day, hour, minute, bounds).length > 0
  }

  #dateForMinute(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    bounds: DateBounds,
  ): Date | null {
    const candidates = this.#minuteCandidates(year, month, day, hour, minute, bounds)
    if (!candidates.length) return null
    const reference = this.#draft.getTime()
    let best = candidates[0] ?? null
    for (const candidate of candidates.slice(1)) {
      if (best && Math.abs(candidate.getTime() - reference) < Math.abs(best.getTime() - reference)) {
        best = candidate
      }
    }
    return best ? cloneDate(best) : null
  }

  #dateFromParts(parts: DateParts, changedPart?: DatePart): Date {
    const day = nearestExistingCivilDay(parts.year, parts.month, parts.day)
    let safeParts: DateParts = day === null ? parts : { ...parts, day }

    if (day === null && changedPart === 'year') {
      const nearest = nearestExistingCivilDateInYear(parts.year, parts.month, parts.day)
      if (nearest) safeParts = { ...parts, ...nearest }
    }

    if (!this.#options.enableTime) {
      const interval = dayInterval(safeParts.year, safeParts.month, safeParts.day, false)
      if (interval) return cloneDate(interval[0])
      throw new RangeError('Selected local civil day has no representable whole minute')
    }
    const bounds = this.#bounds()
    const exact = this.#dateForMinute(
      safeParts.year,
      safeParts.month,
      safeParts.day,
      safeParts.hour,
      safeParts.minute,
      bounds,
    )
    if (exact) return exact

    const requested = safeParts.hour * 60 + safeParts.minute

    // When the user explicitly selected an hour that only partially exists
    // (for example Lord Howe's 30-minute spring-forward gap), keep that hour
    // and choose the nearest valid minute inside it. Searching the whole day
    // could otherwise undo the hour selection by preferring 01:59 over 02:30.
    if (changedPart === 'hour') {
      let bestMinute: { readonly distance: number; readonly date: Date } | null = null
      for (let minute = 0; minute <= 59; minute += 1) {
        if (!this.#minuteAllowed(
          safeParts.year,
          safeParts.month,
          safeParts.day,
          safeParts.hour,
          minute,
          bounds,
        )) {
          continue
        }
        const candidate = this.#dateForMinute(
          safeParts.year,
          safeParts.month,
          safeParts.day,
          safeParts.hour,
          minute,
          bounds,
        )
        if (!candidate) continue
        const distance = Math.abs(minute - safeParts.minute)
        if (!bestMinute || distance < bestMinute.distance) {
          bestMinute = { distance, date: candidate }
        }
      }
      if (bestMinute) return bestMinute.date
    }

    let best: { readonly distance: number; readonly date: Date } | null = null
    for (let hour = 0; hour <= 23; hour += 1) {
      for (let minute = 0; minute <= 59; minute += 1) {
        if (!this.#minuteAllowed(safeParts.year, safeParts.month, safeParts.day, hour, minute, bounds)) {
          continue
        }
        const candidate = this.#dateForMinute(
          safeParts.year,
          safeParts.month,
          safeParts.day,
          hour,
          minute,
          bounds,
        )
        if (!candidate) continue
        const distance = Math.abs(hour * 60 + minute - requested)
        if (!best || distance < best.distance) {
          best = { distance, date: candidate }
        }
      }
    }

    return best?.date ?? partsToDate(safeParts, true)
  }

  #columns(parts: DateParts, bounds: DateBounds): DatePickerColumns {
    const [yearStart, yearEnd] = yearWindow(
      parts.year,
      bounds.min?.getFullYear(),
      bounds.max?.getFullYear(),
      this.#options.pastYears,
      this.#options.futureYears,
    )

    const years = integerRange(yearStart, yearEnd).filter(year => {
      const interval = yearInterval(year, this.#options.enableTime)
      return interval !== null && rangeIntersects(interval[0], interval[1], bounds)
    })

    const months = integerRange(1, 12).filter(month => {
      const interval = monthInterval(parts.year, month, this.#options.enableTime)
      return interval !== null && rangeIntersects(interval[0], interval[1], bounds)
    })

    const days = integerRange(1, daysInMonth(parts.year, parts.month)).filter(day => {
      const interval = dayInterval(parts.year, parts.month, day, this.#options.enableTime)
      return interval !== null && rangeIntersects(interval[0], interval[1], bounds)
    })

    if (!this.#options.enableTime) {
      return { years, months, days, hours: [], minutes: [] }
    }

    const minuteAllowedCache = new Map<number, boolean>()
    const minuteAllowed = (hour: number, minute: number): boolean => {
      const key = hour * 60 + minute
      const cached = minuteAllowedCache.get(key)
      if (cached !== undefined) return cached
      const allowed = this.#minuteAllowed(
        parts.year,
        parts.month,
        parts.day,
        hour,
        minute,
        bounds,
      )
      minuteAllowedCache.set(key, allowed)
      return allowed
    }

    const hours = integerRange(0, 23).filter(hour => (
      integerRange(0, 59).some(minute => minuteAllowed(hour, minute))
    ))

    const minuteValues = integerRange(0, 59, this.#options.minuteStep)
    if (!minuteValues.includes(parts.minute)) {
      minuteValues.push(parts.minute)
      minuteValues.sort((left, right) => left - right)
    }
    const minutes = minuteValues.filter(minute => minuteAllowed(parts.hour, minute))

    return { years, months, days, hours, minutes }
  }
}

function cloneEvent(event: DatePickerEvent): DatePickerEvent {
  return event.type === 'change'
    ? { type: 'change', reason: event.reason, value: cloneNullable(event.value) }
    : { type: 'state', reason: event.reason }
}

function cloneSnapshot(snapshot: DatePickerSnapshot): DatePickerSnapshot {
  return {
    value: cloneNullable(snapshot.value),
    draft: cloneDate(snapshot.draft),
    parts: { ...snapshot.parts },
    columns: {
      years: [...snapshot.columns.years],
      months: [...snapshot.columns.months],
      days: [...snapshot.columns.days],
      hours: [...snapshot.columns.hours],
      minutes: [...snapshot.columns.minutes],
    },
    isOpen: snapshot.isOpen,
    isOutOfRange: snapshot.isOutOfRange,
    options: {
      enableTime: snapshot.options.enableTime,
      minDate: cloneNullable(snapshot.options.minDate),
      maxDate: cloneNullable(snapshot.options.maxDate),
      pastYears: snapshot.options.pastYears,
      futureYears: snapshot.options.futureYears,
      minuteStep: snapshot.options.minuteStep,
    },
  }
}

export function createDatePicker(
  options: DatePickerOptions = {},
  value: Date | null = null,
): DatePickerController {
  return new DatePickerController(options, value)
}
