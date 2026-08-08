import {
  DatePickerController,
  cloneDate,
  createMonthFormatter,
  createNumberFormatter,
  formatDatePickerValue,
  isValidDate,
  type DatePart,
  type DatePickerChangeReason,
  type DatePickerOptions,
  type DatePickerSnapshot,
} from '../core/index.js'
import { WheelColumn, type WheelItem } from './WheelColumn.js'

export interface DatePickerWidgetOptions extends DatePickerOptions {
  readonly value?: Date | null
  readonly locale?: string
  readonly placeholder?: string
  readonly clearable?: boolean
  readonly disabled?: boolean
  readonly loop?: boolean
  readonly showNow?: boolean
  readonly popoverAlign?: 'start' | 'end'
  readonly nowLabel?: string
  readonly clearLabel?: string
  readonly pickerLabel?: string
  readonly dayLabel?: string
  readonly monthLabel?: string
  readonly yearLabel?: string
  readonly hourLabel?: string
  readonly minuteLabel?: string
  readonly invalid?: boolean
  readonly triggerId?: string | null
  readonly ariaLabel?: string | null
  readonly ariaLabelledby?: string | null
  readonly ariaDescribedby?: string | null
  readonly formatValue?: ((value: Date) => string) | null
  readonly onChange?: ((value: Date | null, reason: DatePickerChangeReason) => void) | null
}

interface ViewOptions {
  locale: string
  placeholder: string
  clearable: boolean
  disabled: boolean
  loop: boolean
  showNow: boolean
  popoverAlign: 'start' | 'end'
  nowLabel: string
  clearLabel: string
  pickerLabel: string
  dayLabel: string
  monthLabel: string
  yearLabel: string
  hourLabel: string
  minuteLabel: string
  invalid: boolean
  triggerId: string | undefined
  ariaLabel: string | undefined
  ariaLabelledby: string | undefined
  ariaDescribedby: string | undefined
  formatValue: ((value: Date) => string) | null
  onChange: ((value: Date | null, reason: DatePickerChangeReason) => void) | null
}

export interface DatePickerChangeDetail {
  readonly value: Date | null
  readonly reason: DatePickerChangeReason
}

const PICKER_ID_KEY = Symbol.for('@shelamkoff/date-picker/instance-id')

function nextPickerId(document: Document): number {
  const registry = document as Document & { [PICKER_ID_KEY]?: number }
  const current = registry[PICKER_ID_KEY]
  const next = Number.isSafeInteger(current) && (current ?? 0) >= 0 ? (current as number) + 1 : 1
  registry[PICKER_ID_KEY] = next
  return next
}

const CORE_OPTION_KEYS = [
  'enableTime',
  'minDate',
  'maxDate',
  'pastYears',
  'futureYears',
  'minuteStep',
  'now',
] as const

export class DatePicker {
  readonly host: HTMLElement
  readonly element: HTMLDivElement

  #controller: DatePickerController
  #view: ViewOptions
  #document: Document
  #trigger: HTMLButtonElement
  #valueElement: HTMLSpanElement
  #clearButton: HTMLButtonElement
  #popover: HTMLDivElement
  #nowButton: HTMLButtonElement
  #timeSeparator: HTMLDivElement
  #colon: HTMLSpanElement
  #dayWheel: WheelColumn
  #monthWheel: WheelColumn
  #yearWheel: WheelColumn
  #hourWheel: WheelColumn
  #minuteWheel: WheelColumn
  #documentListening = false
  #destroyed = false
  #valueId: string
  #popoverId: string

  constructor(host: HTMLElement, options: DatePickerWidgetOptions = {}) {
    if (!isElementHost(host)) throw new TypeError('DatePicker host must be an HTMLElement-like DOM element')

    const ownerDocument = host.ownerDocument ?? globalThis.document
    if (!ownerDocument) throw new TypeError('DatePicker host must belong to a DOM Document')

    this.host = host
    this.#document = ownerDocument
    this.#view = resolveViewOptions(null, options)
    this.#controller = new DatePickerController(options, options.value ?? null)

    const id = nextPickerId(this.#document)
    this.#valueId = `sdp-value-${id}`
    this.#popoverId = `sdp-popover-${id}`

    const root = this.#document.createElement('div')
    root.className = 'sdp-datepicker'
    root.dataset.sdpDatepicker = ''
    root.addEventListener('keydown', this.#handleKeydown, true)
    root.addEventListener('focusout', this.#handleFocusOut)
    this.element = root

    const control = this.#document.createElement('div')
    control.className = 'sdp-datepicker__control'
    root.append(control)

    const trigger = this.#document.createElement('button')
    trigger.type = 'button'
    trigger.className = 'sdp-datepicker__trigger'
    trigger.setAttribute('aria-haspopup', 'dialog')
    trigger.setAttribute('aria-controls', this.#popoverId)
    trigger.addEventListener('click', this.#handleTriggerClick)
    control.append(trigger)
    this.#trigger = trigger

    const calendarIcon = icon(this.#document, 'calendar')
    calendarIcon.classList.add('sdp-datepicker__icon')
    trigger.append(calendarIcon)

    const valueElement = this.#document.createElement('span')
    valueElement.id = this.#valueId
    valueElement.className = 'sdp-datepicker__value'
    trigger.append(valueElement)
    this.#valueElement = valueElement

    const clearButton = this.#document.createElement('button')
    clearButton.type = 'button'
    clearButton.className = 'sdp-datepicker__clear'
    const clearIcon = icon(this.#document, 'clear')
    clearIcon.classList.add('sdp-datepicker__clear-icon')
    clearButton.append(clearIcon)
    clearButton.addEventListener('click', this.#handleClearClick)
    control.append(clearButton)
    this.#clearButton = clearButton

    const popover = this.#document.createElement('div')
    popover.id = this.#popoverId
    popover.className = 'sdp-datepicker__popover'
    popover.setAttribute('role', 'dialog')
    root.append(popover)
    this.#popover = popover

    const wheels = this.#document.createElement('div')
    wheels.className = 'sdp-datepicker__wheels'
    popover.append(wheels)

    const highlight = this.#document.createElement('div')
    highlight.className = 'sdp-datepicker__highlight'
    highlight.setAttribute('aria-hidden', 'true')
    wheels.append(highlight)

    const columns = this.#document.createElement('div')
    columns.className = 'sdp-datepicker__columns'
    wheels.append(columns)

    this.#dayWheel = this.#createWheel(this.#view.dayLabel, '3.25rem', 'day')
    this.#monthWheel = this.#createWheel(this.#view.monthLabel, '5.5rem', 'month')
    this.#yearWheel = this.#createWheel(this.#view.yearLabel, '4.5rem', 'year')
    columns.append(this.#dayWheel.element, this.#monthWheel.element, this.#yearWheel.element)

    const timeSeparator = this.#document.createElement('div')
    timeSeparator.className = 'sdp-datepicker__time-separator'
    timeSeparator.setAttribute('aria-hidden', 'true')
    columns.append(timeSeparator)
    this.#timeSeparator = timeSeparator

    this.#hourWheel = this.#createWheel(this.#view.hourLabel, '3.25rem', 'hour')
    columns.append(this.#hourWheel.element)

    const colon = this.#document.createElement('span')
    colon.className = 'sdp-datepicker__colon'
    colon.textContent = ':'
    colon.setAttribute('aria-hidden', 'true')
    columns.append(colon)
    this.#colon = colon

    this.#minuteWheel = this.#createWheel(this.#view.minuteLabel, '3.25rem', 'minute')
    columns.append(this.#minuteWheel.element)

    const nowButton = this.#document.createElement('button')
    nowButton.type = 'button'
    nowButton.className = 'sdp-datepicker__now'
    const clockIcon = icon(this.#document, 'clock')
    clockIcon.classList.add('sdp-datepicker__now-icon')
    nowButton.append(clockIcon)
    const nowText = this.#document.createElement('span')
    nowText.className = 'sdp-datepicker__now-label'
    nowButton.append(nowText)
    nowButton.addEventListener('click', this.#handleNowClick)
    popover.append(nowButton)
    this.#nowButton = nowButton

    this.#setWheelsInteractive(false)
    this.#render()
    host.append(root)
  }

  get value(): Date | null {
    return this.#controller.value
  }

  set value(value: Date | null) {
    this.setValue(value)
  }

  get isOpen(): boolean {
    return this.#controller.isOpen
  }

  get snapshot(): DatePickerSnapshot {
    return this.#controller.snapshot
  }

  setValue(value: Date | null): void {
    this.#assertAlive()
    this.#cancelWheelGestures()
    this.#controller.setValue(value)
    this.#render()
    this.#recenterOpenWheels()
  }

  update(options: Partial<DatePickerWidgetOptions>): void {
    this.#assertAlive()
    if (hasOwn(options, 'value') && options.value != null && !isValidDate(options.value)) {
      throw new RangeError('value must be null or a valid Date')
    }

    const nextView = resolveViewOptions(this.#view, options)
    const hasValue = hasOwn(options, 'value') && options.value !== undefined
    const hasCoreOptions = CORE_OPTION_KEYS.some(key => options[key] !== undefined)

    if (hasValue || hasCoreOptions) {
      this.#cancelWheelGestures()
      if (hasValue) this.#controller.configure(options, { value: options.value ?? null })
      else this.#controller.setOptions(options)
    }

    this.#view = nextView
    if (this.#view.disabled && this.#controller.isOpen) this.#controller.close()
    this.#render()
    if (hasValue || hasCoreOptions) this.#recenterOpenWheels()
  }

  open(): void {
    this.#assertAlive()
    if (this.#view.disabled) return
    this.#cancelWheelGestures()
    this.#controller.open()
    this.#setWheelsInteractive(true)
    this.#render()
    this.#recenterOpenWheels()
    queueMicrotask(() => {
      if (!this.#destroyed && this.#controller.isOpen) this.#dayWheel.focus()
    })
  }

  close(): void {
    if (this.#destroyed) return
    this.#setWheelsInteractive(false)
    this.#controller.close()
    this.#render()
  }

  toggle(): void {
    this.#assertAlive()
    this.#controller.isOpen ? this.close() : this.open()
  }

  clear(): void {
    this.#assertAlive()
    if (this.#view.disabled) return

    const activeBefore = activeElementFor(this.element)
    const restoreFocus = isNodeLike(activeBefore) && this.element.contains(activeBefore)

    this.#setWheelsInteractive(false)
    this.#controller.clear()
    this.#controller.close()
    this.#render()
    this.#publishChange(null, 'clear')

    queueMicrotask(() => {
      if (this.#destroyed || !restoreFocus || this.#controller.isOpen) return
      const active = activeElementFor(this.element)
      const focusFellBack = active == null
        || active === this.#document.body
        || active === this.#document.documentElement
      if (focusFellBack || (isNodeLike(active) && this.element.contains(active))) this.#trigger.focus()
    })
  }

  selectNow(): void {
    this.#assertAlive()
    if (this.#view.disabled) return
    this.#cancelWheelGestures()
    const next = this.#controller.selectNow()
    this.#render()
    this.#recenterOpenWheels()
    this.#publishChange(next, 'now')
  }

  focus(): void {
    this.#assertAlive()
    this.#trigger.focus()
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#detachDocumentPointer()
    this.#setWheelsInteractive(false)
    this.#dayWheel.destroy()
    this.#monthWheel.destroy()
    this.#yearWheel.destroy()
    this.#hourWheel.destroy()
    this.#minuteWheel.destroy()
    this.element.removeEventListener('keydown', this.#handleKeydown, true)
    this.element.removeEventListener('focusout', this.#handleFocusOut)
    this.#trigger.removeEventListener('click', this.#handleTriggerClick)
    this.#clearButton.removeEventListener('click', this.#handleClearClick)
    this.#nowButton.removeEventListener('click', this.#handleNowClick)
    this.element.remove()
  }

  #createWheel(label: string, width: string, part: DatePart): WheelColumn {
    return new WheelColumn({
      document: this.#document,
      ariaLabel: label,
      columnWidth: width,
      loop: this.#view.loop,
      onChange: value => this.#selectPart(part, value),
    })
  }

  #selectPart(part: DatePart, value: number): void {
    if (this.#destroyed || this.#view.disabled || !this.#controller.isOpen) return
    if (!this.#controller.select(part, value)) {
      this.#wheelForPart(part).recenter()
      return
    }
    this.#render()
    this.#publishChange(this.#controller.value, 'select')
  }

  #wheelForPart(part: DatePart): WheelColumn {
    switch (part) {
      case 'day': return this.#dayWheel
      case 'month': return this.#monthWheel
      case 'year': return this.#yearWheel
      case 'hour': return this.#hourWheel
      case 'minute': return this.#minuteWheel
    }
  }

  #assertAlive(): void {
    if (this.#destroyed) throw new Error('DatePicker has been destroyed')
  }

  #publishChange(value: Date | null, reason: DatePickerChangeReason): void {
    const cloned = value ? cloneDate(value) : null
    this.#view.onChange?.(cloned ? cloneDate(cloned) : null, reason)
    const EventConstructor = this.#document.defaultView?.CustomEvent ?? globalThis.CustomEvent
    if (!EventConstructor) return
    this.host.dispatchEvent(new EventConstructor('date-picker-change', {
      bubbles: true,
      composed: true,
      detail: { value: cloned, reason },
    }))
  }

  #render(): void {
    const open = this.#controller.isOpen
    const value = this.#controller.value
    const invalid = this.#view.invalid || this.#controller.isOutOfRange

    this.element.classList.toggle('is-disabled', this.#view.disabled)
    this.element.classList.toggle('is-invalid', invalid)
    this.#trigger.parentElement?.classList.toggle('is-open', open)

    this.#trigger.disabled = this.#view.disabled
    if (this.#view.triggerId) this.#trigger.id = this.#view.triggerId
    else this.#trigger.removeAttribute('id')
    this.#trigger.setAttribute('aria-expanded', String(open))
    setOptionalAttribute(this.#trigger, 'aria-describedby', this.#view.ariaDescribedby)
    setOptionalAttribute(this.#trigger, 'aria-invalid', invalid ? 'true' : undefined)

    const formatted = value
      ? this.#view.formatValue?.(cloneDate(value))
        ?? formatDatePickerValue(value, this.#controller.enableTime, this.#view.locale)
      : ''
    this.#valueElement.textContent = formatted || this.#view.placeholder
    this.#valueElement.classList.toggle('is-placeholder', !formatted)

    if (this.#view.ariaLabelledby) {
      this.#trigger.setAttribute('aria-labelledby', `${this.#view.ariaLabelledby} ${this.#valueId}`)
      this.#trigger.removeAttribute('aria-label')
    }
    else {
      this.#trigger.removeAttribute('aria-labelledby')
      setOptionalAttribute(
        this.#trigger,
        'aria-label',
        this.#view.ariaLabel ? `${this.#view.ariaLabel}, ${formatted || this.#view.placeholder}` : undefined,
      )
    }

    this.#clearButton.hidden = !(this.#view.clearable && value)
    this.#clearButton.disabled = this.#view.disabled
    this.#clearButton.setAttribute('aria-label', this.#view.clearLabel)
    this.#clearButton.title = this.#view.clearLabel

    this.#popover.hidden = !open
    this.#popover.classList.toggle('sdp-datepicker__popover--start', this.#view.popoverAlign === 'start')
    this.#popover.classList.toggle('sdp-datepicker__popover--end', this.#view.popoverAlign === 'end')
    this.#popover.setAttribute('aria-label', this.#view.pickerLabel)

    this.#dayWheel.setAriaLabel(this.#view.dayLabel)
    this.#monthWheel.setAriaLabel(this.#view.monthLabel)
    this.#yearWheel.setAriaLabel(this.#view.yearLabel)
    this.#hourWheel.setAriaLabel(this.#view.hourLabel)
    this.#minuteWheel.setAriaLabel(this.#view.minuteLabel)
    this.#dayWheel.setLoop(this.#view.loop)
    this.#monthWheel.setLoop(this.#view.loop)
    this.#yearWheel.setLoop(this.#view.loop)
    this.#hourWheel.setLoop(this.#view.loop)
    this.#minuteWheel.setLoop(this.#view.loop)

    if (open) {
      const snapshot = this.#controller.snapshot
      const monthLabel = createMonthFormatter(this.#view.locale)
      const twoDigits = createNumberFormatter(this.#view.locale, 2, false)
      const yearLabel = createNumberFormatter(this.#view.locale, 1, false)
      this.#dayWheel.setItems(numberItems(snapshot.columns.days, twoDigits), snapshot.parts.day)
      this.#monthWheel.setItems(numberItems(snapshot.columns.months, monthLabel), snapshot.parts.month)
      this.#yearWheel.setItems(numberItems(snapshot.columns.years, yearLabel), snapshot.parts.year)
      this.#hourWheel.setItems(numberItems(snapshot.columns.hours, twoDigits), snapshot.parts.hour)
      this.#minuteWheel.setItems(numberItems(snapshot.columns.minutes, twoDigits), snapshot.parts.minute)

      const showTime = snapshot.options.enableTime
      this.#timeSeparator.hidden = !showTime
      this.#hourWheel.element.hidden = !showTime
      this.#colon.hidden = !showTime
      this.#minuteWheel.element.hidden = !showTime
    }
    else {
      this.#setWheelsInteractive(false)
    }

    this.#nowButton.hidden = !this.#view.showNow
    this.#nowButton.disabled = this.#view.disabled
    const nowText = this.#nowButton.querySelector<HTMLElement>('.sdp-datepicker__now-label')
    if (nowText) nowText.textContent = this.#view.nowLabel

    open ? this.#attachDocumentPointer() : this.#detachDocumentPointer()
  }

  #cancelWheelGestures(): void {
    this.#dayWheel.cancelPendingSelection()
    this.#monthWheel.cancelPendingSelection()
    this.#yearWheel.cancelPendingSelection()
    this.#hourWheel.cancelPendingSelection()
    this.#minuteWheel.cancelPendingSelection()
  }

  #recenterOpenWheels(): void {
    if (!this.#controller.isOpen) return
    this.#dayWheel.recenter()
    this.#monthWheel.recenter()
    this.#yearWheel.recenter()
    this.#hourWheel.recenter()
    this.#minuteWheel.recenter()
  }

  #setWheelsInteractive(interactive: boolean): void {
    this.#dayWheel.setInteractive(interactive)
    this.#monthWheel.setInteractive(interactive)
    this.#yearWheel.setInteractive(interactive)
    this.#hourWheel.setInteractive(interactive)
    this.#minuteWheel.setInteractive(interactive)
  }

  #handleTriggerClick = (): void => this.toggle()
  #handleClearClick = (): void => this.clear()
  #handleNowClick = (): void => this.selectNow()

  #handleKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.#controller.isOpen) return
    event.preventDefault()
    event.stopPropagation()
    this.close()
    queueMicrotask(() => {
      if (!this.#destroyed && !this.#controller.isOpen) this.#trigger.focus()
    })
  }

  #handleFocusOut = (event: FocusEvent): void => {
    if (!this.#controller.isOpen) return
    const next = event.relatedTarget
    if (isNodeLike(next) && this.element.contains(next)) return
    this.close()
  }

  #handleDocumentPointerDown = (event: PointerEvent): void => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : []
    if (path.includes(this.element)) return
    const target = event.target
    if (isNodeLike(target) && this.element.contains(target)) return
    this.close()
  }

  #attachDocumentPointer(): void {
    if (this.#documentListening) return
    this.#document.addEventListener('pointerdown', this.#handleDocumentPointerDown, true)
    this.#documentListening = true
  }

  #detachDocumentPointer(): void {
    if (!this.#documentListening) return
    this.#document.removeEventListener('pointerdown', this.#handleDocumentPointerDown, true)
    this.#documentListening = false
  }
}

function resolveViewOptions(
  previous: ViewOptions | null,
  patch: Partial<DatePickerWidgetOptions>,
): ViewOptions {
  const formatValue = patch.formatValue !== undefined ? patch.formatValue : previous?.formatValue ?? null
  const onChange = patch.onChange !== undefined ? patch.onChange : previous?.onChange ?? null
  if (formatValue !== null && typeof formatValue !== 'function') throw new TypeError('formatValue must be a function or null')
  if (onChange !== null && typeof onChange !== 'function') throw new TypeError('onChange must be a function or null')

  return {
    locale: resolveLocale(patch.locale ?? previous?.locale ?? 'en-US'),
    placeholder: patch.placeholder ?? previous?.placeholder ?? 'Select date',
    clearable: patch.clearable ?? previous?.clearable ?? false,
    disabled: patch.disabled ?? previous?.disabled ?? false,
    loop: patch.loop ?? previous?.loop ?? false,
    showNow: patch.showNow ?? previous?.showNow ?? false,
    popoverAlign: resolvePopoverAlign(patch.popoverAlign ?? previous?.popoverAlign ?? 'start'),
    nowLabel: patch.nowLabel ?? previous?.nowLabel ?? 'Now',
    clearLabel: patch.clearLabel ?? previous?.clearLabel ?? 'Clear date',
    pickerLabel: patch.pickerLabel ?? previous?.pickerLabel ?? 'Date picker',
    dayLabel: patch.dayLabel ?? previous?.dayLabel ?? 'Day',
    monthLabel: patch.monthLabel ?? previous?.monthLabel ?? 'Month',
    yearLabel: patch.yearLabel ?? previous?.yearLabel ?? 'Year',
    hourLabel: patch.hourLabel ?? previous?.hourLabel ?? 'Hours',
    minuteLabel: patch.minuteLabel ?? previous?.minuteLabel ?? 'Minutes',
    invalid: patch.invalid ?? previous?.invalid ?? false,
    triggerId: patch.triggerId !== undefined ? patch.triggerId ?? undefined : previous?.triggerId,
    ariaLabel: patch.ariaLabel !== undefined ? patch.ariaLabel ?? undefined : previous?.ariaLabel,
    ariaLabelledby: patch.ariaLabelledby !== undefined ? patch.ariaLabelledby ?? undefined : previous?.ariaLabelledby,
    ariaDescribedby: patch.ariaDescribedby !== undefined ? patch.ariaDescribedby ?? undefined : previous?.ariaDescribedby,
    formatValue,
    onChange,
  }
}

function resolvePopoverAlign(value: unknown): 'start' | 'end' {
  if (value === 'start' || value === 'end') return value
  throw new RangeError("popoverAlign must be 'start' or 'end'")
}

function resolveLocale(locale: string): string {
  try {
    new Intl.DateTimeFormat(locale)
    return locale
  }
  catch {
    throw new RangeError(`locale must be a valid Intl locale: ${locale}`)
  }
}

function numberItems(values: readonly number[], label: (value: number) => string): WheelItem[] {
  return values.map(value => ({ value, label: label(value) }))
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function activeElementFor(element: Element): Element | null {
  const root = element.getRootNode?.()
  if (root && typeof root === 'object' && 'activeElement' in root) {
    const active = (root as Document | ShadowRoot).activeElement
    if (active) return active
  }
  return element.ownerDocument?.activeElement ?? null
}

function isElementHost(value: unknown): value is HTMLElement {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as HTMLElement
  const ownerDocument = candidate.ownerDocument
  const RealmHTMLElement = ownerDocument?.defaultView?.HTMLElement
  if (typeof RealmHTMLElement === 'function') return candidate instanceof RealmHTMLElement
  return typeof candidate.append === 'function'
    && typeof candidate.contains === 'function'
    && typeof candidate.dispatchEvent === 'function'
}

function isNodeLike(value: EventTarget | null): value is Node {
  return value !== null
    && typeof value === 'object'
    && typeof (value as Node).nodeType === 'number'
}

function setOptionalAttribute(element: Element, name: string, value: string | undefined): void {
  if (value === undefined) element.removeAttribute(name)
  else element.setAttribute(name, value)
}

function icon(document: Document, name: 'calendar' | 'clear' | 'clock'): HTMLSpanElement {
  const wrapper = document.createElement('span')
  wrapper.setAttribute('aria-hidden', 'true')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('focusable', 'false')

  const paths = name === 'calendar'
    ? [
        'M7 3v3M17 3v3M4.5 9.5h15M6 5h12a2 2 0 0 1 2 2v12H4V7a2 2 0 0 1 2-2Z',
        'M8 13h2M14 13h2M8 16.5h2M14 16.5h2',
      ]
    : name === 'clear'
      ? ['m7 7 10 10M17 7 7 17']
      : ['M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18', 'M12 7v5l3 2']

  for (const data of paths) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', data)
    svg.append(path)
  }
  wrapper.append(svg)
  return wrapper
}
