import { cloneDate, dayInterval, daysInMonth, isValidDate } from './calendar.js'

export type CalendarSelectionMode = 'single' | 'range' | 'multiple'
export interface CalendarRange { readonly start: Date | null; readonly end: Date | null }
export type CalendarSelectionValue = Date | null | CalendarRange | readonly Date[]
export type CalendarChangeReason = 'select' | 'today' | 'clear'

export interface CalendarSelectionOptions {
  readonly mode?: CalendarSelectionMode
  readonly minDate?: Date | null
  readonly maxDate?: Date | null
  readonly disabledDate?: ((date: Date) => boolean) | null
  readonly maxSelections?: number | null
  readonly minRangeDays?: number
  readonly maxRangeDays?: number | null
  readonly weekStartsOn?: number
  readonly fixedWeeks?: boolean
  readonly now?: (() => Date) | null
}

export interface CalendarDay {
  readonly date: Date | null
  readonly year: number
  readonly month: number
  readonly day: number
  readonly outside: boolean
  readonly disabled: boolean
  readonly today: boolean
  readonly selected: boolean
  readonly rangeStart: boolean
  readonly rangeEnd: boolean
  readonly inRange: boolean
  readonly preview: boolean
}
export interface CalendarMonth {
  readonly year: number
  readonly month: number
  readonly weekStartsOn: number
  readonly days: readonly CalendarDay[]
}
export type CalendarSelectionEvent =
  | { readonly type: 'change'; readonly reason: CalendarChangeReason; readonly value: CalendarSelectionValue }
  | { readonly type: 'state'; readonly reason: 'navigate' | 'hover' | 'options' | 'external' }
export type CalendarSelectionListener = (event: CalendarSelectionEvent) => void

/** Day ordinal in the proleptic Gregorian calendar, independent of host timezone and DST. */
export function civilDayNumber(year: number, month: number, day: number): number {
  if (!Number.isSafeInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)
    || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError('Invalid civil date')
  }
  const y = year - (month <= 2 ? 1 : 0)
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const adjustedMonth = month + (month > 2 ? -3 : 9)
  const doy = Math.floor((153 * adjustedMonth + 2) / 5) + day - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

export function civilDayParts(ordinal: number): Readonly<{ year: number; month: number; day: number }> {
  if (!Number.isSafeInteger(ordinal)) throw new RangeError('Invalid civil day ordinal')
  const z = ordinal + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  let year = yoe + era * 400
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1
  const month = mp + (mp < 10 ? 3 : -9)
  if (month <= 2) year += 1
  return { year, month, day }
}

/** Sunday = 0, Monday = 1, etc. */
export function civilWeekday(ordinal: number): number {
  return ((ordinal + 4) % 7 + 7) % 7
}

export function shiftCalendarMonth(year: number, month: number, delta: number): Readonly<{ year: number; month: number }> {
  if (!Number.isSafeInteger(year) || !Number.isInteger(month) || month < 1 || month > 12 || !Number.isSafeInteger(delta)) {
    throw new RangeError('Invalid calendar month')
  }
  const index = year * 12 + month - 1 + delta
  if (!Number.isSafeInteger(index)) throw new RangeError('Calendar month outside safe range')
  const nextYear = Math.floor(index / 12)
  return { year: nextYear, month: index - nextYear * 12 + 1 }
}

function dayNumber(date: Date): number {
  return civilDayNumber(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

function localDay(ordinal: number): Date | null {
  const { year, month, day } = civilDayParts(ordinal)
  const interval = dayInterval(year, month, day, false)
  return interval ? cloneDate(interval[0]) : null
}

function cloneValue(value: CalendarSelectionValue): CalendarSelectionValue {
  if (value === null) return null
  if (isValidDate(value)) return cloneDate(value)
  if (Array.isArray(value)) return value.map(cloneDate)
  const range = value as CalendarRange
  return { start: range.start ? cloneDate(range.start) : null, end: range.end ? cloneDate(range.end) : null }
}

function emptyValue(mode: CalendarSelectionMode): CalendarSelectionValue {
  return mode === 'multiple' ? [] : mode === 'range' ? { start: null, end: null } : null
}

function matches(a: CalendarSelectionValue, b: CalendarSelectionValue, mode: CalendarSelectionMode): boolean {
  if (mode === 'single') return a === null ? b === null : isValidDate(a) && isValidDate(b) && dayNumber(a) === dayNumber(b)
  if (mode === 'multiple') {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((date, index) => b[index] !== undefined && dayNumber(date) === dayNumber(b[index]))
  }
  const left = a as CalendarRange
  const right = b as CalendarRange
  return (left.start === null ? right.start === null : right.start !== null && dayNumber(left.start) === dayNumber(right.start))
    && (left.end === null ? right.end === null : right.end !== null && dayNumber(left.end) === dayNumber(right.end))
}

/** Internal signal for a selection rejected by updated constraints. */
class UnavailableSelectionError extends RangeError {}

interface ResolvedOptions {
  readonly minDate: Date | null
  readonly maxDate: Date | null
  readonly disabledDate: ((date: Date) => boolean) | null
  readonly maxSelections: number | null
  readonly minRangeDays: number
  readonly maxRangeDays: number | null
  readonly weekStartsOn: number
  readonly fixedWeeks: boolean
  readonly now: () => Date
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer`)
  return value
}

function resolveOptions(input: CalendarSelectionOptions, previous?: ResolvedOptions): ResolvedOptions {
  const minDate = input.minDate === undefined ? previous?.minDate ?? null : input.minDate
  const maxDate = input.maxDate === undefined ? previous?.maxDate ?? null : input.maxDate
  if (minDate !== null && !isValidDate(minDate)) throw new RangeError('minDate must be a valid Date or null')
  if (maxDate !== null && !isValidDate(maxDate)) throw new RangeError('maxDate must be a valid Date or null')
  if (minDate && maxDate && dayNumber(minDate) > dayNumber(maxDate)) throw new RangeError('minDate is after maxDate')
  const disabledDate = input.disabledDate === undefined ? previous?.disabledDate ?? null : input.disabledDate
  if (disabledDate !== null && typeof disabledDate !== 'function') throw new TypeError('disabledDate must be a function or null')
  const maxSelections = input.maxSelections === undefined ? previous?.maxSelections ?? null : input.maxSelections
  if (maxSelections !== null) positiveInteger(maxSelections, 'maxSelections')
  const minRangeDays = positiveInteger(input.minRangeDays ?? previous?.minRangeDays ?? 1, 'minRangeDays')
  const maxRangeDays = input.maxRangeDays === undefined ? previous?.maxRangeDays ?? null : input.maxRangeDays
  if (maxRangeDays !== null && positiveInteger(maxRangeDays, 'maxRangeDays') < minRangeDays) {
    throw new RangeError('maxRangeDays must be at least minRangeDays')
  }
  const weekStartsOn = input.weekStartsOn ?? previous?.weekStartsOn ?? 1
  if (!Number.isInteger(weekStartsOn) || weekStartsOn < 0 || weekStartsOn > 6) throw new RangeError('weekStartsOn must be 0…6')
  const now = input.now === undefined ? previous?.now ?? (() => new Date()) : input.now ?? (() => new Date())
  if (typeof now !== 'function') throw new TypeError('now must be a function or null')
  return {
    minDate: minDate ? cloneDate(minDate) : null, maxDate: maxDate ? cloneDate(maxDate) : null,
    disabledDate, maxSelections, minRangeDays, maxRangeDays, weekStartsOn,
    fixedWeeks: input.fixedWeeks ?? previous?.fixedWeeks ?? false, now,
  }
}

/** Headless selection model; wheel-mode controller remains unchanged. */
export class CalendarSelectionController {
  readonly mode: CalendarSelectionMode
  #options: ResolvedOptions
  #value: CalendarSelectionValue
  #year: number
  #month: number
  #hoverDay: number | null = null
  #listeners = new Set<CalendarSelectionListener>()

  constructor(options: CalendarSelectionOptions = {}, value?: CalendarSelectionValue) {
    this.mode = options.mode ?? 'single'
    if (this.mode !== 'single' && this.mode !== 'range' && this.mode !== 'multiple') throw new RangeError('Unknown selection mode')
    this.#options = resolveOptions(options)
    const now = this.#readNow()
    this.#year = now.getFullYear()
    this.#month = now.getMonth() + 1
    this.#value = emptyValue(this.mode)
    if (value !== undefined) this.#value = this.#normalizeValue(value)
    const selected = this.#firstValue()
    if (selected) {
      this.#year = selected.getFullYear()
      this.#month = selected.getMonth() + 1
    }
    this.#clampViewToBounds()
    this.#setMonth(this.#year, this.#month)
  }

  get value(): CalendarSelectionValue { return cloneValue(this.#value) }
  get year(): number { return this.#year }
  get month(): number { return this.#month }
  get weekStartsOn(): number { return this.#options.weekStartsOn }
  get isRangePending(): boolean {
    if (this.mode !== 'range') return false
    const range = this.#value as CalendarRange
    return range.start !== null && range.end === null
  }

  subscribe(listener: CalendarSelectionListener): () => void {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function')
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  #emit(event: CalendarSelectionEvent): void {
    for (const listener of [...this.#listeners]) {
      listener(event.type === 'change' ? { ...event, value: cloneValue(event.value) } : event)
    }
  }

  #readNow(): Date {
    const now = this.#options.now()
    if (!isValidDate(now)) throw new RangeError('now() must return a valid Date')
    return cloneDate(now)
  }

  #firstValue(): Date | null {
    if (this.mode === 'single') return this.#value as Date | null
    if (this.mode === 'multiple') return (this.#value as Date[])[0] ?? null
    return (this.#value as CalendarRange).start
  }

  #selectable(ordinal: number): Date | null {
    if (this.#options.minDate && ordinal < dayNumber(this.#options.minDate)) return null
    if (this.#options.maxDate && ordinal > dayNumber(this.#options.maxDate)) return null
    const date = localDay(ordinal)
    if (!date || this.#options.disabledDate?.(cloneDate(date))) return null
    return date
  }

  isSelectable(date: Date): boolean {
    if (!isValidDate(date)) return false
    return this.#selectable(dayNumber(date)) !== null
  }

  #rangeAllowed(start: number, end: number): boolean {
    const first = Math.min(start, end)
    const last = Math.max(start, end)
    const length = last - first + 1
    if (length < this.#options.minRangeDays || (this.#options.maxRangeDays !== null && length > this.#options.maxRangeDays)) return false
    if (!this.#selectable(first) || !this.#selectable(last)) return false
    // Check the full civil interval, including skipped dates caused by timezone
    // transitions (e.g. Pacific/Apia 2011-12-30). Bound iteration cost.
    if (length > 36_600) return false
    for (let n = first + 1; n < last; n += 1) {
      if (!this.#selectable(n)) return false
    }
    return true
  }

  #normalizeValue(value: CalendarSelectionValue): CalendarSelectionValue {
    const normalize = (date: Date): Date => {
      if (!isValidDate(date)) throw new RangeError('Selection contains an invalid Date')
      const normalized = this.#selectable(dayNumber(date))
      if (!normalized) throw new UnavailableSelectionError('Selection contains a disabled or out-of-bounds date')
      return normalized
    }
    if (this.mode === 'single') {
      if (value === null) return null
      if (!isValidDate(value)) throw new TypeError('Single selection requires Date or null')
      return normalize(value)
    }
    if (this.mode === 'multiple') {
      if (!Array.isArray(value)) throw new TypeError('Multiple selection requires an array of dates')
      const sorted = new Map<number, Date>()
      for (const date of value as readonly Date[]) {
        const normalized = normalize(date)
        sorted.set(dayNumber(normalized), normalized)
      }
      if (this.#options.maxSelections !== null && sorted.size > this.#options.maxSelections) throw new UnavailableSelectionError('Too many selected dates')
      return [...sorted.entries()].sort((a, b) => a[0] - b[0]).map(([, date]) => date)
    }
    if (value === null || Array.isArray(value) || isValidDate(value) || typeof value !== 'object') {
      throw new TypeError('Range selection requires { start, end }')
    }
    const range = value as CalendarRange
    if (range.start === null) {
      if (range.end !== null) throw new RangeError('Range end requires a start')
      return { start: null, end: null }
    }
    const start = normalize(range.start)
    if (range.end === null) return { start, end: null }
    const end = normalize(range.end)
    if (!this.#rangeAllowed(dayNumber(start), dayNumber(end))) throw new UnavailableSelectionError('Invalid date range')
    return dayNumber(start) <= dayNumber(end) ? { start, end } : { start: end, end: start }
  }

  setValue(value: CalendarSelectionValue): void {
    const next = this.#normalizeValue(value)
    if (matches(next, this.#value, this.mode)) return
    this.#value = next
    this.#hoverDay = null
    const date = this.#firstValue()
    if (date) this.#setMonth(date.getFullYear(), date.getMonth() + 1)
    this.#emit({ type: 'state', reason: 'external' })
  }

  update(options: CalendarSelectionOptions): void {
    if (options.mode !== undefined && options.mode !== this.mode) throw new RangeError('Cannot change selection mode of an existing picker')
    const resolved = resolveOptions(options, this.#options)
    const previousOptions = this.#options
    this.#options = resolved
    let next: CalendarSelectionValue
    try { next = this.#normalizeValue(this.#value) }
    catch (error) {
      if (!(error instanceof UnavailableSelectionError)) {
        this.#options = previousOptions
        throw error
      }
      next = emptyValue(this.mode)
    }
    this.#value = next
    this.#hoverDay = null
    this.#clampViewToBounds()
    this.#setMonth(this.#year, this.#month)
    this.#emit({ type: 'state', reason: 'options' })
  }

  #clampViewToBounds(): void {
    const current = this.#year * 12 + this.#month
    const min = this.#options.minDate
    const max = this.#options.maxDate
    if (min && current < min.getFullYear() * 12 + min.getMonth() + 1) {
      this.#year = min.getFullYear()
      this.#month = min.getMonth() + 1
    }
    else if (max && current > max.getFullYear() * 12 + max.getMonth() + 1) {
      this.#year = max.getFullYear()
      this.#month = max.getMonth() + 1
    }
  }

  #setMonth(year: number, month: number): boolean {
    if (!Number.isSafeInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return false
    const index = year * 12 + month
    if (this.#options.minDate && index < this.#options.minDate.getFullYear() * 12 + this.#options.minDate.getMonth() + 1) return false
    if (this.#options.maxDate && index > this.#options.maxDate.getFullYear() * 12 + this.#options.maxDate.getMonth() + 1) return false
    if (!localDay(civilDayNumber(year, month, 1)) && !localDay(civilDayNumber(year, month, daysInMonth(year, month)))) return false
    const changed = this.#year !== year || this.#month !== month
    this.#year = year
    this.#month = month
    return changed
  }

  setMonth(year: number, month: number): boolean {
    if (!this.#setMonth(year, month)) return false
    this.#emit({ type: 'state', reason: 'navigate' })
    return true
  }
  navigate(delta: number): boolean {
    const { year, month } = shiftCalendarMonth(this.#year, this.#month, delta)
    return this.setMonth(year, month)
  }
  canNavigate(delta: number): boolean {
    const { year, month } = shiftCalendarMonth(this.#year, this.#month, delta)
    if (this.#options.minDate && year * 12 + month < this.#options.minDate.getFullYear() * 12 + this.#options.minDate.getMonth() + 1) return false
    if (this.#options.maxDate && year * 12 + month > this.#options.maxDate.getFullYear() * 12 + this.#options.maxDate.getMonth() + 1) return false
    return localDay(civilDayNumber(year, month, 1)) !== null
      || localDay(civilDayNumber(year, month, daysInMonth(year, month))) !== null
  }

  select(date: Date, reason: CalendarChangeReason = 'select'): boolean {
    if (!isValidDate(date)) return false
    const ordinal = dayNumber(date)
    const normalized = this.#selectable(ordinal)
    if (!normalized) return false
    let next: CalendarSelectionValue
    if (this.mode === 'single') {
      next = normalized
    }
    else if (this.mode === 'multiple') {
      const selected = new Map((this.#value as Date[]).map(item => [dayNumber(item), item] as const))
      if (selected.has(ordinal)) selected.delete(ordinal)
      else {
        if (this.#options.maxSelections !== null && selected.size >= this.#options.maxSelections) return false
        selected.set(ordinal, normalized)
      }
      next = [...selected.entries()].sort((a, b) => a[0] - b[0]).map(([, item]) => item)
    }
    else {
      const range = this.#value as CalendarRange
      if (!range.start || range.end) next = { start: normalized, end: null }
      else {
        const startOrdinal = dayNumber(range.start)
        if (!this.#rangeAllowed(startOrdinal, ordinal)) return false
        next = startOrdinal <= ordinal
          ? { start: range.start, end: normalized }
          : { start: normalized, end: range.start }
      }
    }
    if (matches(this.#value, next, this.mode)) return false
    this.#value = next
    this.#hoverDay = null
    this.#setMonth(normalized.getFullYear(), normalized.getMonth() + 1)
    this.#emit({ type: 'change', reason, value: cloneValue(next) })
    return true
  }

  selectToday(): boolean { return this.select(this.#readNow(), 'today') }

  clear(): boolean {
    const empty = emptyValue(this.mode)
    if (matches(this.#value, empty, this.mode)) return false
    this.#value = empty
    this.#hoverDay = null
    this.#emit({ type: 'change', reason: 'clear', value: cloneValue(empty) })
    return true
  }

  hover(date: Date | null): void {
    const range = this.mode === 'range' ? this.#value as CalendarRange : null
    const ordinal = range?.start && !range.end && date && isValidDate(date) ? dayNumber(date) : null
    const next = ordinal !== null && this.#rangeAllowed(dayNumber(range!.start!), ordinal) ? ordinal : null
    if (next === this.#hoverDay) return
    this.#hoverDay = next
    this.#emit({ type: 'state', reason: 'hover' })
  }

  getMonth(): CalendarMonth {
    const year = this.#year
    const month = this.#month
    const first = civilDayNumber(year, month, 1)
    const lead = (civilWeekday(first) - this.#options.weekStartsOn + 7) % 7
    const count = this.#options.fixedWeeks ? 42 : Math.ceil((lead + daysInMonth(year, month)) / 7) * 7
    const now = this.#readNow()
    const today = dayNumber(now)
    const selected = this.mode === 'single' && isValidDate(this.#value) ? dayNumber(this.#value) : null
    const multiple = this.mode === 'multiple' ? new Set((this.#value as Date[]).map(dayNumber)) : null
    const range = this.mode === 'range' ? this.#value as CalendarRange : null
    const start = range?.start ? dayNumber(range.start) : null
    const end = range?.end ? dayNumber(range.end) : null
    const previewEnd = start !== null && end === null ? this.#hoverDay : null
    const days: CalendarDay[] = []
    for (let index = 0; index < count; index += 1) {
      const ordinal = first - lead + index
      const parts = civilDayParts(ordinal)
      const date = this.#selectable(ordinal)
      const activeEnd = end ?? previewEnd
      const lo = start !== null && activeEnd !== null ? Math.min(start, activeEnd) : null
      const hi = start !== null && activeEnd !== null ? Math.max(start, activeEnd) : null
      days.push({
        ...parts,
        date: date ? cloneDate(date) : localDay(ordinal),
        outside: parts.year !== year || parts.month !== month,
        disabled: date === null,
        today: ordinal === today,
        selected: selected === ordinal || Boolean(multiple?.has(ordinal)) || ordinal === start || ordinal === end,
        rangeStart: ordinal === start,
        rangeEnd: ordinal === end,
        inRange: lo !== null && hi !== null && ordinal > lo && ordinal < hi,
        preview: previewEnd !== null && lo !== null && hi !== null && ordinal >= lo && ordinal <= hi,
      })
    }
    return { year, month, weekStartsOn: this.#options.weekStartsOn, days }
  }
}
