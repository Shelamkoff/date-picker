export interface DateParts {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
}

export interface DateBounds {
  readonly min: Date | null
  readonly max: Date | null
}

export type DatePart = 'year' | 'month' | 'day' | 'hour' | 'minute'

export interface DatePickerOptions {
  readonly enableTime?: boolean
  readonly minDate?: Date | null
  readonly maxDate?: Date | null
  readonly pastYears?: number
  readonly futureYears?: number
  readonly minuteStep?: number
  readonly now?: (() => Date) | null
}

export interface ResolvedDatePickerOptions {
  readonly enableTime: boolean
  readonly minDate: Date | null
  readonly maxDate: Date | null
  readonly pastYears: number
  readonly futureYears: number
  readonly minuteStep: number
  readonly now: () => Date
}

export interface DatePickerColumns {
  readonly years: readonly number[]
  readonly months: readonly number[]
  readonly days: readonly number[]
  readonly hours: readonly number[]
  readonly minutes: readonly number[]
}

export interface DatePickerSnapshot {
  readonly value: Date | null
  readonly draft: Date
  readonly parts: DateParts
  readonly columns: DatePickerColumns
  readonly isOpen: boolean
  readonly isOutOfRange: boolean
  readonly options: Readonly<Omit<ResolvedDatePickerOptions, 'now'>>
}

export type DatePickerChangeReason = 'select' | 'now' | 'clear'
export type DatePickerStateReason = 'external' | 'options' | 'open' | 'close' | 'draft'

export type DatePickerEvent =
  | {
      readonly type: 'change'
      readonly reason: DatePickerChangeReason
      readonly value: Date | null
    }
  | {
      readonly type: 'state'
      readonly reason: DatePickerStateReason
    }

export type DatePickerListener = (event: DatePickerEvent, snapshot: DatePickerSnapshot) => void
