export interface WheelItem {
  readonly value: number
  readonly label: string
  readonly disabled?: boolean
}

export interface WheelColumnOptions {
  readonly document?: Document
  readonly ariaLabel: string
  readonly columnWidth?: string
  readonly itemHeight?: number
  readonly visibleItems?: number
  readonly loop?: boolean
  readonly onChange: (value: number) => void
}

interface RenderedItem extends WheelItem {
  readonly cycle: number
  readonly sourceIndex: number
}

const WHEEL_ID_KEY = Symbol.for('@shelamkoff/date-picker/wheel-id')
const SCROLL_SETTLE_DELAY = 120

function nextWheelId(document: Document): number {
  const registry = document as Document & { [WHEEL_ID_KEY]?: number }
  const current = registry[WHEEL_ID_KEY]
  const next = Number.isSafeInteger(current) && (current ?? 0) >= 0 ? (current as number) + 1 : 1
  registry[WHEEL_ID_KEY] = next
  return next
}

export class WheelColumn {
  readonly element: HTMLDivElement

  #items: readonly WheelItem[] = []
  #document: Document
  #value = 0
  #loop: boolean
  #itemHeight: number
  #visibleItems: number
  #onChange: (value: number) => void
  #baseId: string
  #settleTimer: ReturnType<typeof setTimeout> | undefined
  #programmaticTarget: number | null = null
  #interactive = false
  #destroyed = false

  constructor(options: WheelColumnOptions) {
    const ownerDocument = options.document ?? globalThis.document
    if (!ownerDocument) throw new TypeError('WheelColumn requires a DOM Document')
    if (typeof options.onChange !== 'function') throw new TypeError('WheelColumn onChange must be a function')

    this.#document = ownerDocument
    this.#loop = options.loop ?? false
    this.#itemHeight = normalizeItemHeight(options.itemHeight)
    this.#visibleItems = normalizeVisibleItems(options.visibleItems)
    this.#onChange = options.onChange
    this.#baseId = `sdp-wheel-${nextWheelId(this.#document)}`

    const element = this.#document.createElement('div')
    element.className = 'sdp-wheel'
    element.setAttribute('role', 'listbox')
    element.setAttribute('aria-orientation', 'vertical')
    element.setAttribute('aria-label', options.ariaLabel)
    element.tabIndex = 0
    element.style.width = options.columnWidth ?? '4rem'
    element.style.setProperty('--sdp-item-height', `${this.#itemHeight}px`)
    element.style.setProperty('--sdp-visible-items', String(this.#visibleItems))
    element.style.setProperty(
      '--sdp-spacer-height',
      `${((this.#visibleItems - 1) / 2) * this.#itemHeight}px`,
    )

    element.addEventListener('scroll', this.#handleScroll, { passive: true })
    element.addEventListener('wheel', this.#beginUserInteraction, { passive: true })
    element.addEventListener('pointerdown', this.#beginUserInteraction)
    element.addEventListener('touchstart', this.#beginUserInteraction, { passive: true })
    element.addEventListener('keydown', this.#handleKeydown)
    element.addEventListener('click', this.#handleClick)

    this.element = element
  }

  setAriaLabel(label: string): void {
    this.element.setAttribute('aria-label', label)
  }

  setLoop(loop: boolean): void {
    if (this.#loop === loop) return
    this.cancelPendingSelection()
    this.#loop = loop
    this.#render()
    if (this.#interactive) this.#queueRecenter()
  }

  setItems(items: readonly WheelItem[], value: number): void {
    const sameItems = wheelItemsEqual(this.#items, items)
    const valueChanged = this.#value !== value

    if (sameItems) {
      this.#value = value
      if (valueChanged) {
        this.cancelPendingSelection()
        this.#updateSelectionState()
        if (this.#interactive) this.#queueRecenter()
      }
      return
    }

    this.cancelPendingSelection()
    this.#items = items
    this.#value = value
    this.#render()
    if (this.#interactive) this.#queueRecenter()
  }

  setValue(value: number): void {
    if (this.#value === value) return
    this.cancelPendingSelection()
    this.#value = value
    this.#updateSelectionState()
    if (this.#interactive) this.#queueRecenter()
  }

  setInteractive(interactive: boolean): void {
    if (this.#destroyed) return
    if (!interactive) {
      this.#interactive = false
      this.cancelPendingSelection()
      return
    }

    this.#interactive = true
    this.cancelPendingSelection()
    this.#queueRecenter()
  }

  cancelPendingSelection(): void {
    this.#clearSettleTimer()
    this.#programmaticTarget = null
  }

  recenter(): void {
    if (this.#destroyed || !this.#interactive) return
    this.cancelPendingSelection()
    this.#scrollToValue()
  }

  focus(): void {
    if (!this.#destroyed) this.element.focus({ preventScroll: true })
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#interactive = false
    this.cancelPendingSelection()
    this.element.removeEventListener('scroll', this.#handleScroll)
    this.element.removeEventListener('wheel', this.#beginUserInteraction)
    this.element.removeEventListener('pointerdown', this.#beginUserInteraction)
    this.element.removeEventListener('touchstart', this.#beginUserInteraction)
    this.element.removeEventListener('keydown', this.#handleKeydown)
    this.element.removeEventListener('click', this.#handleClick)
  }

  #render(): void {
    this.cancelPendingSelection()
    this.element.replaceChildren()

    const topSpacer = this.#document.createElement('div')
    topSpacer.className = 'sdp-wheel__spacer'
    topSpacer.setAttribute('aria-hidden', 'true')
    this.element.append(topSpacer)

    for (const item of this.#renderedItems()) {
      const option = this.#document.createElement('div')
      option.id = `${this.#baseId}-option-${item.cycle}-${item.sourceIndex}`
      option.className = 'sdp-wheel__option'
      option.dataset.value = String(item.value)
      option.dataset.sourceIndex = String(item.sourceIndex)
      option.dataset.cycle = String(item.cycle)
      option.textContent = item.label

      const semantic = !this.#loop || item.cycle === 1
      if (semantic) {
        option.setAttribute('role', 'option')
        option.setAttribute('aria-selected', String(item.value === this.#value))
        if (item.disabled) option.setAttribute('aria-disabled', 'true')
      }
      else {
        option.setAttribute('aria-hidden', 'true')
      }

      if (item.value === this.#value) option.classList.add('is-selected')
      if (item.disabled) option.classList.add('is-disabled')
      this.element.append(option)
    }

    const bottomSpacer = this.#document.createElement('div')
    bottomSpacer.className = 'sdp-wheel__spacer'
    bottomSpacer.setAttribute('aria-hidden', 'true')
    this.element.append(bottomSpacer)

    this.#updateActiveDescendant()
  }

  #renderedItems(): RenderedItem[] {
    const cycles = this.#loop && this.#items.length > 1 ? 3 : 1
    const result: RenderedItem[] = []
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      this.#items.forEach((item, sourceIndex) => result.push({ ...item, cycle, sourceIndex }))
    }
    return result
  }

  #activeSourceIndex(): number {
    return this.#items.findIndex(item => item.value === this.#value)
  }

  #renderIndexForSource(sourceIndex: number): number {
    return this.#loop && this.#items.length > 1
      ? this.#items.length + sourceIndex
      : sourceIndex
  }

  #scrollToValue(): void {
    const sourceIndex = this.#activeSourceIndex()
    if (sourceIndex < 0) return
    this.#clearSettleTimer()
    const target = this.#renderIndexForSource(sourceIndex) * this.#itemHeight
    this.#programmaticTarget = target
    this.element.scrollTo({ top: target, behavior: 'auto' })
    this.#requestFrame(() => {
      if (this.#programmaticTarget === target && Math.abs(this.element.scrollTop - target) <= 1) {
        this.#programmaticTarget = null
      }
    })
  }

  #rebaseLoopScrollPosition(): boolean {
    if (!this.#loop || this.#items.length <= 1) return false

    const cycleHeight = this.#items.length * this.#itemHeight
    const current = this.element.scrollTop
    let target = current

    while (target < cycleHeight) target += cycleHeight
    while (target >= cycleHeight * 2) target -= cycleHeight
    if (Math.abs(target - current) <= 1) return false

    this.#programmaticTarget = target
    this.element.scrollTop = target
    this.#requestFrame(() => {
      if (this.#programmaticTarget === target && Math.abs(this.element.scrollTop - target) <= 1) {
        this.#programmaticTarget = null
      }
    })
    return true
  }

  #queueRecenter(): void {
    queueMicrotask(() => {
      if (!this.#destroyed && this.#interactive) this.#scrollToValue()
    })
  }

  #requestFrame(callback: FrameRequestCallback): void {
    const frame = this.#document.defaultView?.requestAnimationFrame
    if (typeof frame === 'function') {
      frame.call(this.#document.defaultView, callback)
      return
    }
    queueMicrotask(() => callback(0))
  }

  #clearSettleTimer(): void {
    if (this.#settleTimer !== undefined) clearTimeout(this.#settleTimer)
    this.#settleTimer = undefined
    this.element.classList.remove('is-settling')
  }

  #scheduleSettle(): void {
    this.#clearSettleTimer()
    this.element.classList.add('is-settling')
    this.#settleTimer = setTimeout(() => {
      this.#settleTimer = undefined
      this.element.classList.remove('is-settling')
      if (this.#interactive && !this.#destroyed) this.#settleSelection()
    }, SCROLL_SETTLE_DELAY)
  }

  #beginUserInteraction = (): void => {
    if (!this.#interactive || this.#destroyed) return
    this.cancelPendingSelection()
    this.focus()
  }

  #handleScroll = (): void => {
    if (!this.#interactive || this.#destroyed) return

    if (this.#programmaticTarget !== null) {
      if (Math.abs(this.element.scrollTop - this.#programmaticTarget) <= 1) {
        this.#programmaticTarget = null
      }
      return
    }

    this.#rebaseLoopScrollPosition()
    this.#scheduleSettle()
  }

  #handleClick = (event: MouseEvent): void => {
    if (!this.#interactive || this.#destroyed) return
    const option = findOptionFromEvent(event, this.element)
    if (!option) return

    this.cancelPendingSelection()
    this.focus()
    const value = Number(option.dataset.value)
    if (!Number.isFinite(value)) return
    const sourceIndex = this.#items.findIndex(item => item.value === value && !item.disabled)
    if (sourceIndex < 0) return

    if (this.#value === value) this.#confirmCurrent()
    else this.#chooseSourceIndex(sourceIndex)
  }

  #settleSelection(): void {
    if (!this.#interactive || this.#programmaticTarget !== null || this.#items.length === 0) return
    const rendered = this.#renderedItems()
    const rawIndex = Math.round(this.element.scrollTop / this.#itemHeight)
    const index = nearestEnabledIndex(rendered, rawIndex)
    const item = rendered[index]
    if (!item) return

    const changed = this.#value !== item.value
    this.#value = item.value

    if (this.#loop && this.#items.length > 1) {
      const centeredIndex = this.#renderIndexForSource(item.sourceIndex)
      const currentIndex = Math.round(this.element.scrollTop / this.#itemHeight)
      if (currentIndex !== centeredIndex) this.#scrollToValue()
    }
    this.#updateSelectionState()

    // DatePicker may synchronously re-render this wheel from inside onChange.
    // Notify only after all local DOM work is complete to avoid stale work
    // fighting the user's active scroll gesture.
    if (changed) this.#onChange(item.value)
  }

  #enabledSourceIndexes(): number[] {
    return this.#items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => !item.disabled)
      .map(({ index }) => index)
  }

  #chooseSourceIndex(sourceIndex: number): void {
    const item = this.#items[sourceIndex]
    if (!item || item.disabled) return
    this.cancelPendingSelection()

    const changed = this.#value !== item.value
    this.#value = item.value
    this.#updateSelectionState()
    if (this.#interactive) this.#queueRecenter()

    if (changed) this.#onChange(item.value)
  }

  #confirmCurrent(): void {
    const sourceIndex = this.#activeSourceIndex()
    const item = this.#items[sourceIndex]
    if (!item || item.disabled) return
    this.cancelPendingSelection()
    this.#updateSelectionState()
    if (this.#interactive) this.#queueRecenter()
    this.#onChange(item.value)
  }

  #move(step: number): void {
    const enabled = this.#enabledSourceIndexes()
    if (!enabled.length) return
    const currentPosition = enabled.indexOf(this.#activeSourceIndex())
    if (currentPosition < 0) {
      const fallback = step < 0 && this.#loop ? enabled.at(-1) : enabled.at(0)
      if (fallback !== undefined) this.#chooseSourceIndex(fallback)
      return
    }

    let nextPosition = currentPosition + step
    if (this.#loop) nextPosition = ((nextPosition % enabled.length) + enabled.length) % enabled.length
    else nextPosition = Math.min(enabled.length - 1, Math.max(0, nextPosition))

    const sourceIndex = enabled[nextPosition]
    if (sourceIndex !== undefined) this.#chooseSourceIndex(sourceIndex)
  }

  #handleKeydown = (event: KeyboardEvent): void => {
    if (!this.#interactive || this.#destroyed) return
    const pageStep = Math.max(1, this.#visibleItems - 1)
    switch (event.key) {
      case 'ArrowUp': event.preventDefault(); this.#move(-1); break
      case 'ArrowDown': event.preventDefault(); this.#move(1); break
      case 'PageUp': event.preventDefault(); this.#move(-pageStep); break
      case 'PageDown': event.preventDefault(); this.#move(pageStep); break
      case 'Home': {
        event.preventDefault()
        const index = this.#enabledSourceIndexes().at(0)
        if (index !== undefined) this.#chooseSourceIndex(index)
        break
      }
      case 'End': {
        event.preventDefault()
        const index = this.#enabledSourceIndexes().at(-1)
        if (index !== undefined) this.#chooseSourceIndex(index)
        break
      }
      case 'Enter':
      case ' ':
        event.preventDefault()
        this.#confirmCurrent()
        break
    }
  }

  #updateSelectionState(): void {
    const options = this.element.querySelectorAll<HTMLElement>('.sdp-wheel__option')
    for (const option of options) {
      const selected = Number(option.dataset.value) === this.#value
      option.classList.toggle('is-selected', selected)
      if (option.getAttribute('role') === 'option') option.setAttribute('aria-selected', String(selected))
    }
    this.#updateActiveDescendant()
  }

  #updateActiveDescendant(): void {
    const sourceIndex = this.#activeSourceIndex()
    if (sourceIndex < 0) {
      this.element.removeAttribute('aria-activedescendant')
      return
    }
    const cycle = this.#loop && this.#items.length > 1 ? 1 : 0
    this.element.setAttribute('aria-activedescendant', `${this.#baseId}-option-${cycle}-${sourceIndex}`)
  }
}

function findOptionFromEvent(event: MouseEvent, root: HTMLElement): HTMLElement | null {
  if (typeof event.composedPath === 'function') {
    for (const entry of event.composedPath()) {
      if (entry === root) break
      const candidate = entry as HTMLElement
      if (candidate?.classList?.contains?.('sdp-wheel__option')) return candidate
    }
  }

  let current = event.target as (HTMLElement & { parentElement?: HTMLElement | null }) | null
  while (current && current !== root) {
    if (current.classList?.contains('sdp-wheel__option')) return current
    current = current.parentElement ?? null
  }
  return null
}

function wheelItemsEqual(left: readonly WheelItem[], right: readonly WheelItem[]): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]
    const b = right[index]
    if (!a || !b || a.value !== b.value || a.label !== b.label || Boolean(a.disabled) !== Boolean(b.disabled)) return false
  }
  return true
}

function normalizeItemHeight(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0
    ? Math.min(200, Math.max(16, value as number))
    : 40
}

function normalizeVisibleItems(value: number | undefined): number {
  const raw = Math.trunc(value ?? 5)
  const finite = Number.isFinite(raw) ? raw : 5
  const count = Math.min(15, Math.max(3, finite))
  return count % 2 === 0 ? Math.min(15, count + 1) : count
}

function nearestEnabledIndex(items: readonly RenderedItem[], start: number): number {
  if (!items.length) return -1
  const clamped = Math.min(items.length - 1, Math.max(0, start))
  if (!items[clamped]?.disabled) return clamped

  for (let distance = 1; distance < items.length; distance += 1) {
    const before = clamped - distance
    const after = clamped + distance
    if (before >= 0 && !items[before]?.disabled) return before
    if (after < items.length && !items[after]?.disabled) return after
  }
  return -1
}
