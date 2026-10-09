import {
  CalendarSelectionController,
  civilDayNumber,
  civilDayParts,
  civilWeekday,
  shiftCalendarMonth,
  type CalendarSelectionMode,
  type CalendarSelectionValue,
  type CalendarRange,
  type CalendarChangeReason,
  type CalendarSelectionOptions,
  type CalendarMonth,
  type CalendarDay,
} from '../core/calendar-selection.js'
import { isValidDate } from '../core/calendar.js'
import { createMonthFormatter, formatDatePickerValue } from '../core/format.js'
import { resolvePopoverVerticalPlacement } from './PopoverPlacement.js'

export interface CalendarDatePickerOptions extends CalendarSelectionOptions {
  readonly value?: CalendarSelectionValue
  readonly locale?: string
  readonly inline?: boolean
  readonly disabled?: boolean
  readonly readOnly?: boolean
  readonly clearable?: boolean
  readonly showToday?: boolean
  readonly showOutsideDays?: boolean
  readonly showWeekNumbers?: boolean
  readonly closeOnSelect?: boolean
  readonly placeholder?: string
  readonly pickerLabel?: string
  readonly clearLabel?: string
  readonly todayLabel?: string
  readonly previousMonthLabel?: string
  readonly nextMonthLabel?: string
  readonly formatValue?: ((value: CalendarSelectionValue, mode: CalendarSelectionMode) => string) | null
  readonly onChange?: ((value: CalendarSelectionValue, reason: CalendarChangeReason) => void) | null
}

interface ViewOptions {
  readonly locale: string
  readonly inline: boolean
  readonly disabled: boolean
  readonly readOnly: boolean
  readonly clearable: boolean
  readonly showToday: boolean
  readonly showOutsideDays: boolean
  readonly showWeekNumbers: boolean
  readonly closeOnSelect: boolean | null
  readonly placeholder: string
  readonly pickerLabel: string
  readonly clearLabel: string
  readonly todayLabel: string
  readonly previousMonthLabel: string
  readonly nextMonthLabel: string
  readonly formatValue: ((value: CalendarSelectionValue, mode: CalendarSelectionMode) => string) | null
  readonly onChange: ((value: CalendarSelectionValue, reason: CalendarChangeReason) => void) | null
}

function resolveView(options: CalendarDatePickerOptions, previous?: ViewOptions): ViewOptions {
  const locale = options.locale ?? previous?.locale ?? 'en-US'
  try { new Intl.DateTimeFormat(locale) }
  catch { throw new RangeError('Invalid locale') }
  const formatValue = options.formatValue === undefined ? previous?.formatValue ?? null : options.formatValue
  const onChange = options.onChange === undefined ? previous?.onChange ?? null : options.onChange
  if (formatValue !== null && typeof formatValue !== 'function') throw new TypeError('formatValue must be a function or null')
  if (onChange !== null && typeof onChange !== 'function') throw new TypeError('onChange must be a function or null')
  return {
    locale,
    inline: options.inline ?? previous?.inline ?? false,
    disabled: options.disabled ?? previous?.disabled ?? false,
    readOnly: options.readOnly ?? previous?.readOnly ?? false,
    clearable: options.clearable ?? previous?.clearable ?? false,
    showToday: options.showToday ?? previous?.showToday ?? true,
    showOutsideDays: options.showOutsideDays ?? previous?.showOutsideDays ?? true,
    showWeekNumbers: options.showWeekNumbers ?? previous?.showWeekNumbers ?? false,
    closeOnSelect: options.closeOnSelect ?? previous?.closeOnSelect ?? null,
    placeholder: options.placeholder ?? previous?.placeholder ?? 'Select date',
    pickerLabel: options.pickerLabel ?? previous?.pickerLabel ?? 'Choose date',
    clearLabel: options.clearLabel ?? previous?.clearLabel ?? 'Clear',
    todayLabel: options.todayLabel ?? previous?.todayLabel ?? 'Today',
    previousMonthLabel: options.previousMonthLabel ?? previous?.previousMonthLabel ?? 'Previous month',
    nextMonthLabel: options.nextMonthLabel ?? previous?.nextMonthLabel ?? 'Next month',
    formatValue, onChange,
  }
}

function localeWeekStartsOn(locale: string): number {
  const weekInfo = (new Intl.Locale(locale) as Intl.Locale & { weekInfo?: { firstDay?: number } }).weekInfo
  const day = weekInfo?.firstDay
  return typeof day === 'number' && day >= 1 && day <= 7 ? day % 7 : 1
}

function formatDisplay(value: CalendarSelectionValue, mode: CalendarSelectionMode, locale: string): string {
  const format = (date: Date): string => formatDatePickerValue(date, false, locale)
  if (mode === 'single') return value && isValidDate(value) ? format(value) : ''
  if (mode === 'multiple') {
    const selected = value as readonly Date[]
    return selected.length > 3 ? `${selected.length} dates selected` : selected.map(format).join(', ')
  }
  const range = value as CalendarRange
  return range.start ? `${format(range.start)} – ${range.end ? format(range.end) : '…'}` : ''
}

function hasSelection(value: CalendarSelectionValue, mode: CalendarSelectionMode): boolean {
  if (mode === 'single') return value !== null
  if (mode === 'multiple') return (value as readonly Date[]).length > 0
  return (value as CalendarRange).start !== null
}

/** Complete, accessible calendar view. Does not alter the existing wheel-picker API. */
export class CalendarDatePicker {
  readonly host: HTMLElement
  readonly element: HTMLDivElement
  #model: CalendarSelectionController
  #view: ViewOptions
  #document: Document
  #control: HTMLDivElement
  #trigger: HTMLButtonElement
  #valueText: HTMLSpanElement
  #clear: HTMLButtonElement
  #popover: HTMLDivElement
  #header: HTMLDivElement
  #monthTitle: HTMLSpanElement
  #previous: HTMLButtonElement
  #next: HTMLButtonElement
  #grid: HTMLDivElement
  #today: HTMLButtonElement
  #footerClear: HTMLButtonElement
  #open = false
  #destroyed = false
  #focusedDay: number | null = null
  #positionFrame: number | null = null
  #listening = false
  #id: string
  #explicitWeekStart: boolean
  static #counter = 0

  constructor(host: HTMLElement, options: CalendarDatePickerOptions = {}) {
    const document = host?.ownerDocument
    if (!document || typeof host.append !== 'function') throw new TypeError('CalendarDatePicker requires an HTMLElement host')
    this.host = host
    this.#document = document
    this.#view = resolveView(options)
    this.#explicitWeekStart = options.weekStartsOn !== undefined
    this.#model = new CalendarSelectionController({
      ...options, weekStartsOn: options.weekStartsOn ?? localeWeekStartsOn(this.#view.locale),
    }, options.value)
    this.#id = `sdp-calendar-${++CalendarDatePicker.#counter}`

    const create = <T extends keyof HTMLElementTagNameMap>(tag: T, className: string): HTMLElementTagNameMap[T] => {
      const element = document.createElement(tag)
      element.className = className
      return element
    }
    const button = (className: string, label: string): HTMLButtonElement => {
      const element = create('button', className)
      element.type = 'button'
      element.textContent = label
      return element
    }
    const root = create('div', 'sdp-datepicker sdp-datepicker--calendar')
    this.element = root
    root.addEventListener('keydown', this.#onRootKeydown, true)
    root.addEventListener('focusout', this.#onFocusOut)

    this.#control = create('div', 'sdp-datepicker__control')
    this.#trigger = button('sdp-datepicker__trigger', '')
    this.#trigger.setAttribute('aria-haspopup', 'dialog')
    this.#trigger.setAttribute('aria-controls', this.#id)
    this.#trigger.addEventListener('click', () => this.toggle())
    this.#valueText = create('span', 'sdp-datepicker__value')
    this.#trigger.append(this.#valueText)
    this.#clear = button('sdp-datepicker__clear', '×')
    this.#clear.addEventListener('click', () => this.clear())
    this.#control.append(this.#trigger, this.#clear)
    root.append(this.#control)

    this.#popover = create('div', 'sdp-datepicker__popover sdp-datepicker__calendar-popover')
    this.#popover.id = this.#id
    this.#popover.setAttribute('role', 'dialog')
    this.#popover.setAttribute('aria-modal', 'false')
    root.append(this.#popover)

    this.#header = create('div', 'sdp-calendar__header')
    this.#previous = button('sdp-calendar__nav', '‹')
    this.#monthTitle = create('span', 'sdp-calendar__title')
    this.#next = button('sdp-calendar__nav', '›')
    this.#previous.addEventListener('click', () => this.navigate(-1))
    this.#next.addEventListener('click', () => this.navigate(1))
    this.#header.append(this.#previous, this.#monthTitle, this.#next)
    this.#popover.append(this.#header)

    this.#grid = create('div', 'sdp-calendar__grid')
    this.#grid.setAttribute('role', 'grid')
    this.#grid.addEventListener('click', this.#onGridClick)
    this.#grid.addEventListener('keydown', this.#onGridKeydown)
    this.#grid.addEventListener('pointerover', this.#onGridPointerOver)
    this.#grid.addEventListener('pointerleave', this.#onGridPointerLeave)
    this.#grid.addEventListener('focusin', this.#onGridFocusIn)
    this.#popover.append(this.#grid)

    const footer = create('div', 'sdp-calendar__footer')
    this.#today = button('sdp-calendar__action', this.#view.todayLabel)
    this.#footerClear = button('sdp-calendar__action', this.#view.clearLabel)
    this.#today.addEventListener('click', () => this.selectToday())
    this.#footerClear.addEventListener('click', () => this.clear())
    footer.append(this.#today, this.#footerClear)
    this.#popover.append(footer)
    host.append(root)
    this.#render()
  }

  get mode(): CalendarSelectionMode { return this.#model.mode }
  get value(): CalendarSelectionValue { return this.#model.value }
  set value(value: CalendarSelectionValue) { this.setValue(value) }
  get isOpen(): boolean { return this.#view.inline || this.#open }
  get snapshot(): CalendarMonth { return this.#model.getMonth() }

  setValue(value: CalendarSelectionValue): void {
    this.#assertAlive()
    this.#model.setValue(value)
    this.#focusedDay = null
    this.#render()
  }

  update(options: Partial<CalendarDatePickerOptions>): void {
    this.#assertAlive()
    const nextView = resolveView(options, this.#view)
    if (nextView.inline !== this.#view.inline) throw new RangeError('inline cannot be changed after construction')
    const selectionOptions: CalendarSelectionOptions = { ...options,
      ...(options.locale !== undefined && options.weekStartsOn === undefined && !this.#explicitWeekStart
        ? { weekStartsOn: localeWeekStartsOn(nextView.locale) } : {}),
    }
    if (options.weekStartsOn !== undefined) this.#explicitWeekStart = true
    this.#model.update(selectionOptions)
    if (Object.prototype.hasOwnProperty.call(options, 'value') && options.value !== undefined) {
      this.#model.setValue(options.value)
    }
    this.#view = nextView
    if (nextView.disabled && this.#open) this.close()
    this.#render()
  }

  open(): void {
    this.#assertAlive()
    if (this.#view.disabled || this.#view.inline || this.#open) return
    this.#open = true
    this.#focusedDay = null
    this.#render()
    this.#attachListeners()
    this.#queuePosition()
    queueMicrotask(() => { if (!this.#destroyed && this.#open) this.#focusInitial() })
  }
  close(): void {
    if (this.#destroyed || this.#view.inline || !this.#open) return
    this.#open = false
    this.#model.hover(null)
    this.#detachListeners()
    this.#render()
  }
  toggle(): void { this.isOpen ? this.close() : this.open() }
  focus(): void { this.#assertAlive(); (this.#view.inline ? this.#firstFocusableDay() ?? this.#previous : this.#trigger).focus() }
  navigate(months: number): boolean {
    this.#assertAlive()
    if (this.#view.disabled) return false
    if (!this.#model.navigate(months)) return false
    this.#focusedDay = null
    this.#render()
    return true
  }
  clear(): void {
    this.#assertAlive()
    if (this.#view.disabled || this.#view.readOnly) return
    if (!this.#model.clear()) return
    this.#render()
    this.#publishChange('clear')
  }
  selectToday(): void {
    this.#assertAlive()
    if (this.#view.disabled || this.#view.readOnly) return
    if (!this.#model.selectToday()) return
    this.#render()
    this.#publishChange('today')
    this.#closeAfterSelection()
  }
  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#detachListeners()
    this.element.remove()
  }

  #assertAlive(): void { if (this.#destroyed) throw new Error('CalendarDatePicker has been destroyed') }
  #publishChange(reason: CalendarChangeReason): void {
    const value = this.#model.value
    this.#view.onChange?.(value, reason)
    const EventConstructor = this.#document.defaultView?.CustomEvent ?? globalThis.CustomEvent
    if (EventConstructor) {
      this.host.dispatchEvent(new EventConstructor('date-picker-change', {
        bubbles: true, composed: true,
        detail: { value: this.#model.value, reason, mode: this.mode },
      }))
    }
  }
  #closeAfterSelection(): void {
    const shouldClose = this.#view.closeOnSelect ?? (this.mode !== 'multiple')
    if (shouldClose && !this.#model.isRangePending && !this.#view.inline) {
      this.close()
      this.#trigger.focus()
    }
  }

  #onGridClick = (event: MouseEvent): void => {
    if (this.#view.disabled || this.#view.readOnly) return
    const button = this.#dayButton(event.target)
    if (!button || button.disabled) return
    const day = Number(button.dataset.dayOrdinal)
    const selected = civilOrdinalToDate(day)
    if (!selected || !this.#model.select(selected)) return
    this.#focusedDay = day
    this.#render()
    this.#publishChange('select')
    this.#closeAfterSelection()
  }
  #dayButton(target: EventTarget | null): HTMLButtonElement | null {
    if (!target || typeof target !== 'object' || !('closest' in target)) return null
    const button = (target as Element).closest<HTMLButtonElement>('[data-day-ordinal]')
    return button && this.#grid.contains(button) ? button : null
  }
  #onGridPointerOver = (event: PointerEvent): void => {
    if (!this.#model.isRangePending) return
    const button = this.#dayButton(event.target)
    if (!button || button.disabled) return
    const ordinal = Number(button.dataset.dayOrdinal)
    const date = civilOrdinalToDate(ordinal)
    if (date) { this.#model.hover(date); this.#renderGrid() }
  }
  #onGridPointerLeave = (): void => {
    if (!this.#model.isRangePending) return
    this.#model.hover(null)
    this.#renderGrid()
  }
  #onGridFocusIn = (event: FocusEvent): void => {
    const button = this.#dayButton(event.target)
    if (button) {
      this.#focusedDay = Number(button.dataset.dayOrdinal)
      for (const sibling of this.#grid.querySelectorAll<HTMLButtonElement>('[data-day-ordinal]')) {
        sibling.tabIndex = sibling === button ? 0 : -1
      }
    }
  }
  #onGridKeydown = (event: KeyboardEvent): void => {
    const button = this.#dayButton(event.target)
    if (!button) return
    const current = Number(button.dataset.dayOrdinal)
    let next: number | null = null
    let direction = 1
    switch (event.key) {
      case 'ArrowLeft': next = current - 1; direction = -1; break
      case 'ArrowRight': next = current + 1; break
      case 'ArrowUp': next = current - 7; direction = -1; break
      case 'ArrowDown': next = current + 7; break
      case 'Home': next = current - ((civilWeekday(current) - this.#model.weekStartsOn + 7) % 7); direction = -1; break
      case 'End': next = current + (6 - ((civilWeekday(current) - this.#model.weekStartsOn + 7) % 7)); break
      case 'PageUp': {
        const { year, month, day } = civilDayParts(current)
        const shifted = shiftCalendarMonth(year, month, event.shiftKey ? -12 : -1)
        next = civilDayNumber(shifted.year, shifted.month, Math.min(day, daysInMonthSafe(shifted.year, shifted.month)))
        direction = -1
        break
      }
      case 'PageDown': {
        const { year, month, day } = civilDayParts(current)
        const shifted = shiftCalendarMonth(year, month, event.shiftKey ? 12 : 1)
        next = civilDayNumber(shifted.year, shifted.month, Math.min(day, daysInMonthSafe(shifted.year, shifted.month)))
        break
      }
      case 'Enter':
      case ' ': event.preventDefault(); button.click(); return
      default: return
    }
    event.preventDefault()
    if (next !== null) this.#focusNearest(next, direction)
  }
  #onRootKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.#open) return
    event.stopPropagation()
    event.preventDefault()
    this.close()
    this.#trigger.focus()
  }
  #onFocusOut = (): void => {
    if (!this.#open) return
    queueMicrotask(() => {
      if (!this.#open || this.#destroyed) return
      const root = this.element.getRootNode() as Document | ShadowRoot
      const focus = root.activeElement ?? this.#document.activeElement
      if (!focus || !this.element.contains(focus)) this.close()
    })
  }

  #focusNearest(from: number, direction: number): void {
    for (let offset = 0; offset < 366; offset += 1) {
      const index = from + offset * direction
      const { year, month } = civilDayParts(index)
      const date = civilOrdinalToDate(index)
      if (!date || !this.#model.isSelectable(date)) continue
      if (!this.#model.setMonth(year, month) && (this.#model.year !== year || this.#model.month !== month)) continue
      this.#focusedDay = index
      this.#render()
      this.#dayByOrdinal(index)?.focus()
      return
    }
  }
  #dayByOrdinal(ordinal: number): HTMLButtonElement | null {
    return this.#grid.querySelector<HTMLButtonElement>(`[data-day-ordinal="${ordinal}"]`)
  }
  #firstFocusableDay(): HTMLButtonElement | null {
    return this.#grid.querySelector<HTMLButtonElement>('[data-day-ordinal]:not(:disabled)')
  }
  #focusInitial(): void {
    const value = this.#model.value
    let date: Date | null = null
    if (this.mode === 'single' && isValidDate(value)) date = value
    else if (this.mode === 'range') date = (value as CalendarRange).start
    else if (this.mode === 'multiple') date = (value as Date[])[0] ?? null
    const button = date ? this.#dayByOrdinal(civilDayNumber(date.getFullYear(), date.getMonth() + 1, date.getDate())) : null
    ;(button && !button.disabled ? button : this.#firstFocusableDay() ?? this.#next).focus()
  }

  #render(): void {
    this.element.classList.toggle('is-disabled', this.#view.disabled)
    this.element.classList.toggle('sdp-datepicker--inline', this.#view.inline)
    this.#control.hidden = this.#view.inline
    this.#trigger.disabled = this.#view.disabled
    this.#trigger.setAttribute('aria-expanded', String(this.isOpen))
    this.#trigger.setAttribute('aria-label', this.#view.pickerLabel)
    const value = this.#model.value
    const formatted = this.#view.formatValue?.(value, this.mode) ?? formatDisplay(value, this.mode, this.#view.locale)
    this.#valueText.textContent = formatted || this.#view.placeholder
    this.#valueText.classList.toggle('is-placeholder', !formatted)
    this.#clear.hidden = !(this.#view.clearable && hasSelection(value, this.mode))
    this.#clear.disabled = this.#view.disabled || this.#view.readOnly
    this.#clear.setAttribute('aria-label', this.#view.clearLabel)
    this.#popover.hidden = !this.isOpen
    this.#popover.setAttribute('aria-label', this.#view.pickerLabel)
    this.#previous.setAttribute('aria-label', this.#view.previousMonthLabel)
    this.#next.setAttribute('aria-label', this.#view.nextMonthLabel)
    this.#previous.disabled = this.#view.disabled || !this.#model.canNavigate(-1)
    this.#next.disabled = this.#view.disabled || !this.#model.canNavigate(1)
    this.#today.textContent = this.#view.todayLabel
    this.#today.hidden = !this.#view.showToday
    this.#today.disabled = this.#view.disabled || this.#view.readOnly
    this.#footerClear.textContent = this.#view.clearLabel
    this.#footerClear.hidden = !this.#view.clearable
    this.#footerClear.disabled = this.#view.disabled || this.#view.readOnly || !hasSelection(value, this.mode)
    if (this.isOpen) this.#renderGrid()
    if (this.#open) this.#queuePosition()
    else this.#popover.style.removeProperty('transform')
  }

  #renderGrid(): void {
    const month = this.#model.getMonth()
    this.#grid.classList.toggle('has-week-numbers', this.#view.showWeekNumbers)
    const monthName = createMonthFormatter(this.#view.locale, 'long')(month.month)
    this.#monthTitle.textContent = `${monthName} ${month.year}`
    this.#grid.setAttribute('aria-label', `${monthName} ${month.year}`)
    if (this.#focusedDay === null || !month.days.some(day =>
      !day.disabled && civilDayNumber(day.year, day.month, day.day) === this.#focusedDay
    )) {
      const preferred = month.days.find(day => day.selected && !day.disabled && !day.outside)
        ?? month.days.find(day => !day.disabled && !day.outside)
        ?? month.days.find(day => !day.disabled)
      this.#focusedDay = preferred ? civilDayNumber(preferred.year, preferred.month, preferred.day) : null
    }
    const fragment = this.#document.createDocumentFragment()
    const weekdays = this.#document.createElement('div')
    weekdays.className = 'sdp-calendar__weekdays'
    weekdays.setAttribute('role', 'row')
    if (this.#view.showWeekNumbers) {
      const corner = this.#document.createElement('span')
      corner.className = 'sdp-calendar__weekday'
      corner.setAttribute('aria-hidden', 'true')
      weekdays.append(corner)
    }
    const weekdayFormatter = new Intl.DateTimeFormat(this.#view.locale, { weekday: 'short', timeZone: 'UTC' })
    for (let index = 0; index < 7; index += 1) {
      const day = (month.weekStartsOn + index) % 7
      const date = new Date(Date.UTC(2023, 0, day + 1))
      const header = this.#document.createElement('span')
      header.className = 'sdp-calendar__weekday'
      header.setAttribute('role', 'columnheader')
      header.textContent = weekdayFormatter.format(date)
      weekdays.append(header)
    }
    fragment.append(weekdays)
    const labelFormatter = new Intl.DateTimeFormat(this.#view.locale, { dateStyle: 'full' })
    const active = this.#document.activeElement
    const restoreFocus = active !== null && this.#grid.contains(active)
    const activeOrdinal = restoreFocus ? Number((active as HTMLElement).dataset.dayOrdinal) : null
    for (let rowIndex = 0; rowIndex < month.days.length; rowIndex += 7) {
      const row = this.#document.createElement('div')
      row.className = 'sdp-calendar__week'
      row.setAttribute('role', 'row')
      if (this.#view.showWeekNumbers) {
        const cell = this.#document.createElement('span')
        cell.className = 'sdp-calendar__week-number'
        cell.setAttribute('aria-label', 'ISO week')
        const firstDay = month.days[rowIndex]
        cell.textContent = firstDay ? String(isoWeekNumber(civilDayNumber(firstDay.year, firstDay.month, firstDay.day))) : ''
        row.append(cell)
      }
      for (const day of month.days.slice(rowIndex, rowIndex + 7)) {
        row.append(this.#renderDay(day, labelFormatter))
      }
      fragment.append(row)
    }
    this.#grid.replaceChildren(fragment)
    if (restoreFocus && activeOrdinal !== null) this.#dayByOrdinal(activeOrdinal)?.focus({ preventScroll: true })
  }

  #renderDay(day: CalendarDay, formatter: Intl.DateTimeFormat): HTMLElement {
    const cell = this.#document.createElement('div')
    cell.className = 'sdp-calendar__cell'
    cell.setAttribute('role', 'gridcell')
    cell.setAttribute('aria-selected', String(day.selected))
    if (day.outside && !this.#view.showOutsideDays) return cell
    const element = this.#document.createElement('button')
    element.type = 'button'
    element.className = 'sdp-calendar__day'
    element.textContent = String(day.day)
    const ordinal = civilDayNumber(day.year, day.month, day.day)
    element.dataset.dayOrdinal = String(ordinal)
    element.disabled = day.disabled || this.#view.disabled || this.#view.readOnly
    element.tabIndex = this.#focusedDay === ordinal ? 0 : -1
    element.classList.toggle('is-outside', day.outside)
    element.classList.toggle('is-today', day.today)
    element.classList.toggle('is-selected', day.selected)
    element.classList.toggle('is-range-start', day.rangeStart)
    element.classList.toggle('is-range-end', day.rangeEnd)
    element.classList.toggle('is-in-range', day.inRange)
    element.classList.toggle('is-preview', day.preview)
    if (day.today) element.setAttribute('aria-current', 'date')
    if (day.date) element.setAttribute('aria-label', formatter.format(day.date))
    cell.append(element)
    return cell
  }

  #handleOutsidePointer = (event: PointerEvent): void => {
    if (!this.#open) return
    if (event.composedPath().includes(this.element)) return
    this.close()
  }
  #handleViewport = (): void => this.#queuePosition()
  #attachListeners(): void {
    if (this.#listening) return
    this.#document.addEventListener('pointerdown', this.#handleOutsidePointer, true)
    const window = this.#document.defaultView
    window?.addEventListener('resize', this.#handleViewport, { passive: true })
    window?.addEventListener('scroll', this.#handleViewport, true)
    this.#listening = true
  }
  #detachListeners(): void {
    if (this.#listening) {
      this.#document.removeEventListener('pointerdown', this.#handleOutsidePointer, true)
      const window = this.#document.defaultView
      window?.removeEventListener('resize', this.#handleViewport)
      window?.removeEventListener('scroll', this.#handleViewport, true)
      this.#listening = false
    }
    if (this.#positionFrame !== null) {
      this.#document.defaultView?.cancelAnimationFrame(this.#positionFrame)
      this.#positionFrame = null
    }
  }
  #queuePosition(): void {
    if (!this.#open || this.#positionFrame !== null) return
    const window = this.#document.defaultView
    if (!window) return
    this.#positionFrame = window.requestAnimationFrame(() => { this.#positionFrame = null; this.#position() })
  }
  #position(): void {
    if (!this.#open) return
    const window = this.#document.defaultView
    if (!window) return
    this.#popover.style.removeProperty('top')
    this.#popover.style.removeProperty('bottom')
    this.#popover.style.removeProperty('transform')
    const anchor = this.element.getBoundingClientRect()
    const popover = this.#popover.getBoundingClientRect()
    const placement = resolvePopoverVerticalPlacement({
      anchorTop: anchor.top, anchorBottom: anchor.bottom,
      popoverHeight: popover.height, viewportHeight: window.innerHeight,
      gap: 7, viewportPadding: 8,
    })
    if (placement.openAbove) {
      this.#popover.style.top = 'auto'
      this.#popover.style.bottom = 'calc(100% + 0.4rem)'
    }
    this.#popover.style.maxHeight = `${placement.maxHeight}px`
    const rect = this.#popover.getBoundingClientRect()
    let shift = 0
    if (rect.left < 8) shift += 8 - rect.left
    if (rect.right > window.innerWidth - 8) shift -= rect.right - window.innerWidth + 8
    if (shift) this.#popover.style.transform = `translateX(${shift}px)`
  }
}

function daysInMonthSafe(year: number, month: number): number {
  const next = shiftCalendarMonth(year, month, 1)
  return civilDayNumber(next.year, next.month, 1) - civilDayNumber(year, month, 1)
}

function civilOrdinalToDate(ordinal: number): Date | null {
  const { year, month, day } = civilDayParts(ordinal)
  const date = new Date(0)
  date.setHours(12, 0, 0, 0)
  date.setFullYear(year, month - 1, day)
  return isValidDate(date) && date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null
}
function isoWeekNumber(ordinal: number): number {
  const weekday = (civilWeekday(ordinal) + 6) % 7
  const thursday = ordinal + 3 - weekday
  const year = civilDayParts(thursday).year
  const jan4 = civilDayNumber(year, 1, 4)
  const firstThursday = jan4 + 3 - ((civilWeekday(jan4) + 6) % 7)
  return 1 + Math.floor((thursday - firstThursday) / 7)
}
