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

const MAX_YEAR_WINDOW = 200

const DEFAULT_OPTIONS: Omit<ResolvedDatePickerOptions, 'now'> = {
  enableTime: false,
  minDate: null,
  maxDate: null,
  pastYears: 100,
  futureYears: 20,
  minuteStep: 1,
}

interface ResolvedConfiguration {
  readonly options: ResolvedDatePickerOptions
  readonly bounds: DateBounds
}

interface ColumnCache {
  key: string
  values: readonly number[]
}

interface SnapshotCache {
  revision: number
  snapshot: DatePickerSnapshot
}

type MinuteResolver = (hour: number, minute: number) => readonly Date[]

function sanitizeWindow(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(MAX_YEAR_WINDOW, Math.max(0, Math.trunc(value)))
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

function resolveConfiguration(
  previous: ResolvedDatePickerOptions | null,
  patch: DatePickerOptions,
): ResolvedConfiguration {
  const enableTime = patch.enableTime ?? previous?.enableTime ?? DEFAULT_OPTIONS.enableTime
  const minDate = resolveDateOption(patch.minDate, previous?.minDate, 'minDate')
  const maxDate = resolveDateOption(patch.maxDate, previous?.maxDate, 'maxDate')
  const now = patch.now !== undefined
    ? patch.now ?? (() => new Date())
    : previous?.now ?? (() => new Date())
  if (typeof now !== 'function') throw new TypeError('now must be a function or null')

  const options: ResolvedDatePickerOptions = {
    enableTime,
    minDate,
    maxDate,
    pastYears: sanitizeWindow(patch.pastYears, previous?.pastYears ?? DEFAULT_OPTIONS.pastYears),
    futureYears: sanitizeWindow(patch.futureYears, previous?.futureYears ?? DEFAULT_OPTIONS.futureYears),
    minuteStep: sanitizeMinuteStep(patch.minuteStep ?? previous?.minuteStep),
    now,
  }

  return {
    options,
    bounds: normalizeBounds(minDate, maxDate, enableTime),
  }
}

function cloneNullable(date: Date | null): Date | null {
  return date ? cloneDate(date) : null
}

function sameCivilDate(date: Date, year: number, month: number, day: number): boolean {
  return date.getFullYear() === year
    && date.getMonth() + 1 === month
    && date.getDate() === day
}

function sameInstant(left: Date | null, right: Date | null): boolean {
  if (left === null || right === null) return left === right
  return left.getTime() === right.getTime()
}

function nearestCandidate(candidates: readonly Date[], reference: number): Date | null {
  let best: Date | null = null
  for (const candidate of candidates) {
    if (!best || Math.abs(candidate.getTime() - reference) < Math.abs(best.getTime() - reference)) {
      best = candidate
    }
  }
  return best ? cloneDate(best) : null
}

export class DatePickerController {
  #options: ResolvedDatePickerOptions
  #boundsValue: DateBounds
  #value: Date | null
  #draft: Date
  #open = false
  #listeners = new Set<DatePickerListener>()
  #revision = 0
  #snapshotCache: SnapshotCache | null = null
  #yearsCache: ColumnCache | null = null
  #monthsCache: ColumnCache | null = null
  #daysCache: ColumnCache | null = null
  #hoursCache: ColumnCache | null = null
  #minutesCache: ColumnCache | null = null

  constructor(options: DatePickerOptions = {}, value: Date | null = null) {
    const configuration = resolveConfiguration(null, options)
    this.#options = configuration.options
    this.#boundsValue = configuration.bounds

    if (value != null && !isValidDate(value)) {
      throw new RangeError('value must be null or a valid Date')
    }

    const seed = value ?? this.#readNow()
    const normalized = this.#normalizeSelectableSeed(seed, this.#options, this.#boundsValue)
    this.#value = value === null ? null : cloneDate(normalized)
    this.#draft = cloneDate(normalized)
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
    return this.#isOutOfRange()
  }

  get snapshot(): DatePickerSnapshot {
    if (this.#snapshotCache?.revision === this.#revision) {
      return cloneSnapshot(this.#snapshotCache.snapshot)
    }

    const parts = dateToParts(this.#draft)
    const snapshot: DatePickerSnapshot = {
      value: cloneNullable(this.#value),
      draft: cloneDate(this.#draft),
      parts,
      columns: this.#columns(parts),
      isOpen: this.#open,
      isOutOfRange: this.#isOutOfRange(),
      options: {
        enableTime: this.#options.enableTime,
        minDate: cloneNullable(this.#options.minDate),
        maxDate: cloneNullable(this.#options.maxDate),
        pastYears: this.#options.pastYears,
        futureYears: this.#options.futureYears,
        minuteStep: this.#options.minuteStep,
      },
    }
    this.#snapshotCache = { revision: this.#revision, snapshot }
    return cloneSnapshot(snapshot)
  }

  setValue(value: Date | null): void {
    if (value != null && !isValidDate(value)) {
      throw new RangeError('value must be null or a valid Date')
    }

    const normalized = value === null
      ? this.#normalizeSelectableSeed(this.#draft, this.#options, this.#boundsValue)
      : this.#normalizeSelectableSeed(value, this.#options, this.#boundsValue)

    this.#value = value === null ? null : cloneDate(normalized)
    this.#draft = cloneDate(normalized)
    this.#touch()
    this.#emit({ type: 'state', reason: 'external' })
  }

  setOptions(options: DatePickerOptions): void {
    this.configure(options)
  }

  configure(options: DatePickerOptions, state?: { readonly value: Date | null }): void {
    const configuration = resolveConfiguration(this.#options, options)
    const hasValue = state !== undefined
    const requestedValue = hasValue ? state.value : this.#value
    if (requestedValue != null && !isValidDate(requestedValue)) {
      throw new RangeError('value must be null or a valid Date')
    }

    const source = requestedValue ?? this.#draft
    const normalized = this.#normalizeSelectableSeed(
      source,
      configuration.options,
      configuration.bounds,
    )

    this.#options = configuration.options
    this.#boundsValue = configuration.bounds
    if (hasValue) this.#value = requestedValue === null ? null : cloneDate(normalized)
    else if (this.#value) this.#value = cloneDate(normalized)
    this.#draft = cloneDate(normalized)
    this.#touch()
    this.#emit({ type: 'state', reason: hasValue ? 'external' : 'options' })
  }

  open(seed?: Date): void {
    const source = this.#value ?? seed ?? this.#readNow()
    this.#draft = this.#normalizeSelectableSeed(source, this.#options, this.#boundsValue)
    this.#open = true
    this.#touch()
    this.#emit({ type: 'state', reason: 'open' })
  }

  close(): void {
    if (!this.#open) return
    this.#open = false
    this.#touch()
    this.#emit({ type: 'state', reason: 'close' })
  }

  resetDraft(seed?: Date): void {
    const source = this.#value ?? seed ?? this.#readNow()
    this.#draft = this.#normalizeSelectableSeed(source, this.#options, this.#boundsValue)
    this.#touch()
    this.#emit({ type: 'state', reason: 'draft' })
  }

  clear(): void {
    if (this.#value === null) return
    this.#value = null
    this.#touch()
    this.#emit({ type: 'change', reason: 'clear', value: null })
  }

  selectNow(): Date {
    return this.#commit(this.#readNow(), 'now')
  }

  select(part: DatePart, value: number): boolean {
    const parts = dateToParts(this.#draft)
    if (!this.#partAllowed(part, value, parts)) return false

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

  #partAllowed(part: DatePart, value: number, parts: DateParts): boolean {
    if (!Number.isInteger(value)) return false

    switch (part) {
      case 'year': return this.#years(parts).includes(value)
      case 'month': return this.#months(parts).includes(value)
      case 'day': return this.#days(parts).includes(value)
      case 'hour': return this.#options.enableTime && this.#hours(parts).includes(value)
      case 'minute': return this.#options.enableTime && this.#minutes(parts).includes(value)
    }
  }

  #emit(event: DatePickerEvent): void {
    if (this.#listeners.size === 0) return
    const snapshot = this.snapshot
    for (const listener of [...this.#listeners]) {
      listener(cloneEvent(event), cloneSnapshot(snapshot))
    }
  }

  #touch(): void {
    this.#revision += 1
    this.#snapshotCache = null
  }

  #readNow(): Date {
    const value = this.#options.now()
    if (!isValidDate(value)) throw new RangeError('options.now() must return a valid Date')
    return cloneDate(value)
  }

  #isOutOfRange(): boolean {
    if (!this.#value) return false
    const time = this.#value.getTime()
    return Boolean(
      (this.#boundsValue.min && time < this.#boundsValue.min.getTime())
      || (this.#boundsValue.max && time > this.#boundsValue.max.getTime()),
    )
  }

  #commit(date: Date, reason: 'select' | 'now'): Date {
    const next = this.#normalizeSelectableSeed(date, this.#options, this.#boundsValue)
    const previous = this.#value
    this.#draft = cloneDate(next)
    this.#value = cloneDate(next)
    this.#touch()

    if (!sameInstant(previous, next)) {
      this.#emit({ type: 'change', reason, value: cloneDate(next) })
    }
    return cloneDate(next)
  }

  #minuteResolver(
    year: number,
    month: number,
    day: number,
    bounds: DateBounds,
  ): MinuteResolver {
    const cache = new Map<number, readonly Date[]>()
    return (hour, minute) => {
      const key = hour * 60 + minute
      const cached = cache.get(key)
      if (cached) return cached
      const candidates = exactLocalDateTimes(year, month, day, hour, minute).filter(candidate => {
        const time = candidate.getTime()
        return (!bounds.min || time >= bounds.min.getTime())
          && (!bounds.max || time <= bounds.max.getTime())
      })
      cache.set(key, candidates)
      return candidates
    }
  }

  #boundaryMinutes(
    year: number,
    month: number,
    day: number,
    hour: number,
    bounds: DateBounds,
  ): number[] {
    const result: number[] = []
    for (const boundary of [bounds.min, bounds.max]) {
      if (boundary && sameCivilDate(boundary, year, month, day) && boundary.getHours() === hour) {
        result.push(boundary.getMinutes())
      }
    }
    return result
  }

  #minuteValuesForHour(
    year: number,
    month: number,
    day: number,
    hour: number,
    options: ResolvedDatePickerOptions,
    bounds: DateBounds,
    resolveMinute: MinuteResolver,
  ): number[] {
    const values = new Set<number>(integerRange(0, 59, options.minuteStep))
    for (const minute of this.#boundaryMinutes(year, month, day, hour, bounds)) values.add(minute)
    return [...values]
      .sort((left, right) => left - right)
      .filter(minute => resolveMinute(hour, minute).length > 0)
  }

  #minuteValueIsExposed(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    options: ResolvedDatePickerOptions,
    bounds: DateBounds,
  ): boolean {
    return minute % options.minuteStep === 0
      || this.#boundaryMinutes(year, month, day, hour, bounds).includes(minute)
  }

  #candidateMinuteOfDayValues(
    parts: Pick<DateParts, 'year' | 'month' | 'day'>,
    options: ResolvedDatePickerOptions,
    bounds: DateBounds,
    onlyHour?: number,
  ): number[] {
    const result = new Set<number>()
    const hours = onlyHour === undefined ? integerRange(0, 23) : [onlyHour]
    for (const hour of hours) {
      for (const minute of integerRange(0, 59, options.minuteStep)) {
        result.add(hour * 60 + minute)
      }
      for (const minute of this.#boundaryMinutes(
        parts.year,
        parts.month,
        parts.day,
        hour,
        bounds,
      )) {
        result.add(hour * 60 + minute)
      }
    }
    return [...result]
  }

  #nearestSelectableDate(
    parts: DateParts,
    reference: Date,
    options: ResolvedDatePickerOptions,
    bounds: DateBounds,
    onlyHour?: number,
    resolver?: MinuteResolver,
  ): Date | null {
    const resolveMinute = resolver ?? this.#minuteResolver(parts.year, parts.month, parts.day, bounds)
    const requested = parts.hour * 60 + parts.minute
    const values = this.#candidateMinuteOfDayValues(parts, options, bounds, onlyHour)
      .sort((left, right) => {
        const distance = Math.abs(left - requested) - Math.abs(right - requested)
        return distance !== 0 ? distance : left - right
      })

    for (const minuteOfDay of values) {
      const hour = Math.floor(minuteOfDay / 60)
      const minute = minuteOfDay % 60
      const candidate = nearestCandidate(resolveMinute(hour, minute), reference.getTime())
      if (candidate) return candidate
    }
    return null
  }

  #normalizeSelectableSeed(
    date: Date,
    options: ResolvedDatePickerOptions,
    bounds: DateBounds,
  ): Date {
    const normalized = clampDate(normalizePickerDate(date, options.enableTime), bounds)
    if (!options.enableTime) return normalized

    const parts = dateToParts(normalized)
    const resolveMinute = this.#minuteResolver(parts.year, parts.month, parts.day, bounds)
    if (this.#minuteValueIsExposed(
      parts.year,
      parts.month,
      parts.day,
      parts.hour,
      parts.minute,
      options,
      bounds,
    )) {
      const exact = nearestCandidate(
        resolveMinute(parts.hour, parts.minute),
        normalized.getTime(),
      )
      if (exact) return exact
    }

    const nearest = this.#nearestSelectableDate(
      parts,
      normalized,
      options,
      bounds,
      undefined,
      resolveMinute,
    )
    return nearest ?? normalized
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

    const requested = new Date(this.#draft.getTime())
    const exactParts = { ...safeParts }
    const resolveMinute = this.#minuteResolver(
      safeParts.year,
      safeParts.month,
      safeParts.day,
      this.#boundsValue,
    )
    if (this.#minuteValueIsExposed(
      safeParts.year,
      safeParts.month,
      safeParts.day,
      safeParts.hour,
      safeParts.minute,
      this.#options,
      this.#boundsValue,
    )) {
      const exact = nearestCandidate(
        resolveMinute(safeParts.hour, safeParts.minute),
        this.#draft.getTime(),
      )
      if (exact) return exact
    }

    const nearest = this.#nearestSelectableDate(
      exactParts,
      requested,
      this.#options,
      this.#boundsValue,
      changedPart === 'hour' ? safeParts.hour : undefined,
    )
    if (nearest) return nearest

    const fallback = this.#normalizeSelectableSeed(requested, this.#options, this.#boundsValue)
    return fallback
  }

  #cacheKey(...parts: Array<string | number | boolean | null>): string {
    return parts.join('|')
  }

  #boundsKey(): string {
    return `${this.#boundsValue.min?.getTime() ?? ''}:${this.#boundsValue.max?.getTime() ?? ''}`
  }

  #years(parts: DateParts): readonly number[] {
    const key = this.#cacheKey(
      parts.year,
      this.#boundsKey(),
      this.#options.enableTime,
      this.#options.pastYears,
      this.#options.futureYears,
    )
    if (this.#yearsCache?.key === key) return this.#yearsCache.values

    const [start, end] = yearWindow(
      parts.year,
      this.#boundsValue.min?.getFullYear(),
      this.#boundsValue.max?.getFullYear(),
      this.#options.pastYears,
      this.#options.futureYears,
    )
    const values = integerRange(start, end).filter(year => {
      const interval = yearInterval(year, this.#options.enableTime)
      return interval !== null && rangeIntersects(interval[0], interval[1], this.#boundsValue)
    })
    this.#yearsCache = { key, values }
    return values
  }

  #months(parts: DateParts): readonly number[] {
    const key = this.#cacheKey(parts.year, this.#boundsKey(), this.#options.enableTime)
    if (this.#monthsCache?.key === key) return this.#monthsCache.values

    const values = integerRange(1, 12).filter(month => {
      const interval = monthInterval(parts.year, month, this.#options.enableTime)
      return interval !== null && rangeIntersects(interval[0], interval[1], this.#boundsValue)
    })
    this.#monthsCache = { key, values }
    return values
  }

  #days(parts: DateParts): readonly number[] {
    const key = this.#cacheKey(parts.year, parts.month, this.#boundsKey(), this.#options.enableTime)
    if (this.#daysCache?.key === key) return this.#daysCache.values

    const values = integerRange(1, daysInMonth(parts.year, parts.month)).filter(day => {
      const interval = dayInterval(parts.year, parts.month, day, this.#options.enableTime)
      return interval !== null && rangeIntersects(interval[0], interval[1], this.#boundsValue)
    })
    this.#daysCache = { key, values }
    return values
  }

  #hours(parts: DateParts): readonly number[] {
    if (!this.#options.enableTime) return []
    const key = this.#cacheKey(parts.year, parts.month, parts.day, this.#boundsKey(), this.#options.minuteStep)
    if (this.#hoursCache?.key === key) return this.#hoursCache.values

    const resolveMinute = this.#minuteResolver(parts.year, parts.month, parts.day, this.#boundsValue)
    const values = integerRange(0, 23).filter(hour => this.#minuteValuesForHour(
      parts.year,
      parts.month,
      parts.day,
      hour,
      this.#options,
      this.#boundsValue,
      resolveMinute,
    ).length > 0)
    this.#hoursCache = { key, values }
    return values
  }

  #minutes(parts: DateParts): readonly number[] {
    if (!this.#options.enableTime) return []
    const key = this.#cacheKey(
      parts.year,
      parts.month,
      parts.day,
      parts.hour,
      this.#boundsKey(),
      this.#options.minuteStep,
    )
    if (this.#minutesCache?.key === key) return this.#minutesCache.values

    const resolveMinute = this.#minuteResolver(parts.year, parts.month, parts.day, this.#boundsValue)
    const values = this.#minuteValuesForHour(
      parts.year,
      parts.month,
      parts.day,
      parts.hour,
      this.#options,
      this.#boundsValue,
      resolveMinute,
    )
    this.#minutesCache = { key, values }
    return values
  }

  #columns(parts: DateParts): DatePickerColumns {
    return {
      years: this.#years(parts),
      months: this.#months(parts),
      days: this.#days(parts),
      hours: this.#hours(parts),
      minutes: this.#minutes(parts),
    }
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
