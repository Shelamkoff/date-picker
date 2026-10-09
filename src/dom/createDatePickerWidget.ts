import { DatePicker, type DatePickerWidgetOptions } from './DatePicker.js'
import { CalendarDatePicker, type CalendarDatePickerOptions } from './CalendarDatePicker.js'

export type DatePickerView = 'wheel' | 'calendar'
export type WheelPickerConfiguration = DatePickerWidgetOptions & { readonly view?: 'wheel' }
export type CalendarPickerConfiguration = CalendarDatePickerOptions & { readonly view: 'calendar' }

export function createDatePickerWidget(host: HTMLElement, options: CalendarPickerConfiguration): CalendarDatePicker
export function createDatePickerWidget(host: HTMLElement, options?: WheelPickerConfiguration): DatePicker
export function createDatePickerWidget(host: HTMLElement, options: WheelPickerConfiguration | CalendarPickerConfiguration = {}): DatePicker | CalendarDatePicker {
  return options.view === 'calendar' ? new CalendarDatePicker(host, options) : new DatePicker(host, options)
}
