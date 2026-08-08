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
const SCROLL_SETTLE_DELAY = 90
const WHEEL_RESPONSE_TIME = 48
const WHEEL_POSITION_EPSILON = 0.25

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
  #wheelAnimationToken = 0
  #wheelAnimating = false
  #wheelPosition: number | null = null
  #wheelTarget: number | null = null
  #wheelLastFrame = 0
  #commitAfterWheelAnimation = false
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
    element.addEventListener('wheel', this.#handleWheel, { passive: false })
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
    this.#cancelWheelAnimation()
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
    this.element.removeEventListener('wheel', this.#handleWheel)
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
    this.#cancelWheelAnimation()
    const target = this.#renderIndexForSource(sourceIndex) * this.#itemHeight
    this.#programmaticTarget = target
    this.element.scrollTo({ top: target, behavior: 'auto' })
    this.#requestFrame(() => {
      if (this.#programmaticTarget === target) this.#programmaticTarget = null
    })
  }

  #normalizeScrollTop(scrollTop: number): number {
    if (!Number.isFinite(scrollTop)) return this.element.scrollTop
    if (!this.#loop || this.#items.length <= 1) return scrollTop

    const cycleHeight = this.#items.length * this.#itemHeight
    const offset = ((scrollTop - cycleHeight) % cycleHeight + cycleHeight) % cycleHeight
    return cycleHeight + offset
  }

  #rebaseLoopScrollPosition(): boolean {
    if (!this.#loop || this.#items.length <= 1) return false

    const current = this.element.scrollTop
    const target = this.#normalizeScrollTop(current)
    if (Math.abs(target - current) <= 1) return false

    this.#programmaticTarget = null
    this.element.scrollTop = target
    return true
  }

  #maximumScrollTop(): number {
    return Math.max(0, this.element.scrollHeight - this.element.clientHeight)
  }

  #clampWheelPosition(position: number): number {
    if (!Number.isFinite(position)) return this.element.scrollTop
    if (this.#loop && this.#items.length > 1) return position
    return Math.min(this.#maximumScrollTop(), Math.max(0, position))
  }

  #normalizedWheelDelta(event: WheelEvent): number {
    const pixels = event.deltaMode === 1
      ? event.deltaY * 16
      : event.deltaMode === 2
        ? event.deltaY * Math.max(this.#itemHeight, this.element.clientHeight)
        : event.deltaY

    if (!Number.isFinite(pixels) || pixels === 0) return 0

    // Classic mouse wheels commonly report jumps of 100–120 CSS pixels.
    // Compress large impulses to roughly one row while preserving the small,
    // high-resolution deltas produced by touchpads.
    const magnitude = this.#itemHeight * Math.tanh(Math.abs(pixels) / this.#itemHeight)
    return Math.sign(pixels) * magnitude
  }

  #cancelWheelAnimation(): void {
    this.#wheelAnimationToken += 1
    this.#wheelAnimating = false
    this.#wheelPosition = null
    this.#wheelTarget = null
    this.#wheelLastFrame = 0
    this.#commitAfterWheelAnimation = false
  }

  #queueWheelDelta(delta: number): void {
    if (!Number.isFinite(delta) || delta === 0) return

    if (this.#wheelPosition === null || this.#wheelTarget === null) {
      const current = this.element.scrollTop
      this.#wheelPosition = current
      this.#wheelTarget = current
    }

    this.#wheelTarget = this.#clampWheelPosition(this.#wheelTarget + delta)
    this.#startWheelAnimation()
  }

  #startWheelAnimation(): void {
    if (this.#wheelAnimating) return
    if (this.#wheelPosition === null || this.#wheelTarget === null) return

    this.#wheelAnimating = true
    this.#wheelLastFrame = 0
    const token = ++this.#wheelAnimationToken
    this.#requestFrame(timestamp => this.#animateWheel(token, timestamp))
  }

  #animateWheel(token: number, timestamp: number): void {
    if (
      token !== this.#wheelAnimationToken
      || !this.#wheelAnimating
      || this.#destroyed
      || !this.#interactive
      || this.#wheelPosition === null
      || this.#wheelTarget === null
    ) {
      return
    }

    const elapsed = this.#wheelLastFrame === 0
      ? 16.67
      : Math.min(50, Math.max(1, timestamp - this.#wheelLastFrame))
    this.#wheelLastFrame = timestamp

    const distance = this.#wheelTarget - this.#wheelPosition
    const interpolation = 1 - Math.exp(-elapsed / WHEEL_RESPONSE_TIME)
    const next = Math.abs(distance) <= WHEEL_POSITION_EPSILON
      ? this.#wheelTarget
      : this.#wheelPosition + distance * interpolation

    this.#wheelPosition = next
    const physical = this.#normalizeScrollTop(next)
    this.#programmaticTarget = physical
    this.element.scrollTop = physical

    if (next !== this.#wheelTarget) {
      this.#requestFrame(nextTimestamp => this.#animateWheel(token, nextTimestamp))
      return
    }

    this.#wheelAnimating = false
    this.#wheelLastFrame = 0
    this.#wheelPosition = physical
    this.#wheelTarget = physical

    if (this.#commitAfterWheelAnimation) {
      this.#commitAfterWheelAnimation = false
      this.#commitSettledSelection()
    }
  }

  #alignedWheelTarget(position: number, renderedIndex: number): number {
    const alignedPhysical = renderedIndex * this.#itemHeight
    if (!this.#loop || this.#items.length <= 1) return alignedPhysical

    const cycleHeight = this.#items.length * this.#itemHeight
    const cycle = Math.round((position - alignedPhysical) / cycleHeight)
    return alignedPhysical + cycle * cycleHeight
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
    if (activeElementFor(this.element) !== this.element) this.focus()
  }

  #handleWheel = (event: WheelEvent): void => {
    if (
      !this.#interactive
      || this.#destroyed
      || event.ctrlKey
      || !Number.isFinite(event.deltaY)
      || event.deltaY === 0
    ) {
      return
    }

    const delta = this.#normalizedWheelDelta(event)
    if (delta === 0) return

    event.preventDefault()
    this.#clearSettleTimer()
    if (activeElementFor(this.element) !== this.element) this.focus()
    this.#queueWheelDelta(delta)
    this.#scheduleSettle()
  }

  #handleScroll = (): void => {
    if (!this.#interactive || this.#destroyed) return
    if (this.#wheelAnimating) return

    if (this.#programmaticTarget !== null) {
      this.#programmaticTarget = null
      return
    }

    this.#wheelPosition = null
    this.#wheelTarget = null
    this.#commitAfterWheelAnimation = false
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
    if (!this.#interactive || this.#items.length === 0) return

    const position = this.#wheelTarget ?? this.#wheelPosition ?? this.element.scrollTop
    const physical = this.#normalizeScrollTop(position)
    const rendered = this.#renderedItems()
    const rawIndex = Math.round(physical / this.#itemHeight)
    const index = nearestEnabledIndex(rendered, rawIndex)
    if (index < 0) return

    if (this.#wheelPosition === null || this.#wheelTarget === null) {
      this.#wheelPosition = this.element.scrollTop
      this.#wheelTarget = this.element.scrollTop
    }

    this.#wheelTarget = this.#clampWheelPosition(this.#alignedWheelTarget(position, index))
    this.#commitAfterWheelAnimation = true
    this.#startWheelAnimation()
  }

  #commitSettledSelection(): void {
    if (!this.#interactive || this.#items.length === 0) return

    const rendered = this.#renderedItems()
    const rawIndex = Math.round(this.element.scrollTop / this.#itemHeight)
    const index = nearestEnabledIndex(rendered, rawIndex)
    const item = rendered[index]
    if (!item) return

    const changed = this.#value !== item.value
    this.#value = item.value
    this.#updateSelectionState()

    const physical = this.#normalizeScrollTop(index * this.#itemHeight)
    this.#wheelPosition = physical
    this.#wheelTarget = physical

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

function activeElementFor(element: Element): Element | null {
  const root = element.getRootNode?.()
  if (root && typeof root === 'object' && 'activeElement' in root) {
    const active = (root as Document | ShadowRoot).activeElement
    if (active) return active
  }
  return element.ownerDocument?.activeElement ?? null
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
