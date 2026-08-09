import { WheelMotion } from './WheelMotion.js'

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

const WHEEL_ID_KEY = Symbol.for('@shelamkoff/date-picker/wheel-id')
const SCROLL_SETTLE_DELAY = 90
const INPUT_COMMIT_DELAY = 700
const POSITION_EPSILON = 0.5

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
  #motion: WheelMotion
  #settleTimer: ReturnType<typeof setTimeout> | undefined
  #inputTimer: ReturnType<typeof setTimeout> | undefined
  #inputBuffer = ''
  #inputPreviewIndex = -1
  #writeGeneration = 0
  #interactive = false
  #destroyed = false
  #motionPreference: MediaQueryList | null = null

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
    this.element = element

    const window = ownerDocument.defaultView
    this.#motionPreference = window?.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null
    this.#motionPreference?.addEventListener?.('change', this.#handleMotionPreferenceChange)

    this.#motion = new WheelMotion({
      write: position => this.#writeVirtualPosition(position),
      requestFrame: callback => this.#requestFrame(callback),
      responseTime: 44,
      epsilon: 0.5,
      reducedMotion: this.#motionPreference?.matches ?? false,
    })

    element.addEventListener('scroll', this.#handleScroll, { passive: true })
    element.addEventListener('wheel', this.#handleWheel, { passive: false })
    element.addEventListener('pointerdown', this.#beginNativeInteraction)
    element.addEventListener('touchstart', this.#beginNativeInteraction, { passive: true })
    element.addEventListener('keydown', this.#handleKeydown)
    element.addEventListener('click', this.#handleClick)
    element.addEventListener('blur', this.#handleBlur)
  }

  setAriaLabel(label: string): void {
    this.element.setAttribute('aria-label', label)
  }

  setLoop(loop: boolean): void {
    if (this.#loop === loop) return
    this.cancelPendingSelection()
    this.#loop = loop
    this.#syncLoopClass()
    this.#render()
    if (this.#interactive) this.#queueRecenter()
  }

  setItems(items: readonly WheelItem[], value: number): void {
    this.#clearInput()
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
    this.#syncLoopClass()
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
    if (this.#destroyed || this.#interactive === interactive) return
    this.#interactive = interactive
    if (!interactive) this.cancelPendingSelection()
  }

  cancelPendingSelection(): void {
    this.#clearInput()
    this.#clearSettleTimer()
    this.#motion.cancel()
    this.#writeGeneration += 1
  }

  recenter(): void {
    if (this.#destroyed || !this.#interactive) return
    const sourceIndex = this.#activeSourceIndex()
    if (sourceIndex < 0) return
    this.#clearSettleTimer()
    this.#motion.reset(this.#centralPositionForSource(sourceIndex))
  }

  focus(): void {
    if (!this.#destroyed) this.element.focus({ preventScroll: true })
  }

  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    this.#interactive = false
    this.cancelPendingSelection()
    this.#motionPreference?.removeEventListener?.('change', this.#handleMotionPreferenceChange)
    this.element.removeEventListener('scroll', this.#handleScroll)
    this.element.removeEventListener('wheel', this.#handleWheel)
    this.element.removeEventListener('pointerdown', this.#beginNativeInteraction)
    this.element.removeEventListener('touchstart', this.#beginNativeInteraction)
    this.element.removeEventListener('keydown', this.#handleKeydown)
    this.element.removeEventListener('click', this.#handleClick)
    this.element.removeEventListener('blur', this.#handleBlur)
  }

  #render(): void {
    this.#clearInput()
    this.#clearSettleTimer()
    this.#motion.cancel()

    const fragment = this.#document.createDocumentFragment()
    const topSpacer = this.#document.createElement('div')
    topSpacer.className = 'sdp-wheel__spacer'
    topSpacer.setAttribute('aria-hidden', 'true')
    fragment.append(topSpacer)

    const cycles = this.#cycleCount()
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      this.#items.forEach((item, sourceIndex) => {
        const option = this.#document.createElement('div')
        option.id = `${this.#baseId}-option-${cycle}-${sourceIndex}`
        option.className = 'sdp-wheel__option'
        option.dataset.value = String(item.value)
        option.dataset.sourceIndex = String(sourceIndex)
        option.dataset.cycle = String(cycle)
        option.textContent = item.label

        const semantic = cycles === 1 || cycle === 1
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
        fragment.append(option)
      })
    }

    const bottomSpacer = this.#document.createElement('div')
    bottomSpacer.className = 'sdp-wheel__spacer'
    bottomSpacer.setAttribute('aria-hidden', 'true')
    fragment.append(bottomSpacer)

    this.element.replaceChildren(fragment)
    this.#updateActiveDescendant()
  }

  #hasLoopingItems(): boolean {
    return this.#loop && this.#items.length > 1
  }

  #syncLoopClass(): void {
    this.element.classList.toggle('is-looping', this.#hasLoopingItems())
  }

  #cycleCount(): number {
    return this.#hasLoopingItems() ? 3 : 1
  }

  #activeSourceIndex(): number {
    return this.#items.findIndex(item => item.value === this.#value)
  }

  #centralPositionForSource(sourceIndex: number): number {
    const index = this.#hasLoopingItems()
      ? this.#items.length + sourceIndex
      : sourceIndex
    return index * this.#itemHeight
  }

  #cycleHeight(): number {
    return this.#items.length * this.#itemHeight
  }

  #normalizePhysicalPosition(position: number): number {
    if (!Number.isFinite(position)) return this.element.scrollTop
    if (!this.#hasLoopingItems()) return position
    const cycleHeight = this.#cycleHeight()
    const offset = positiveModulo(position - cycleHeight, cycleHeight)
    return cycleHeight + offset
  }

  #physicalToVirtual(physical: number, reference: number): number {
    if (!this.#hasLoopingItems()) return physical
    const normalized = this.#normalizePhysicalPosition(physical)
    const cycleHeight = this.#cycleHeight()
    const cycle = Math.round((reference - normalized) / cycleHeight)
    return normalized + cycle * cycleHeight
  }

  #writeVirtualPosition(position: number): void {
    if (this.#destroyed) return
    const physical = this.#normalizePhysicalPosition(position)
    const generation = ++this.#writeGeneration
    this.element.scrollTop = physical
    this.#requestFrame(() => {
      if (this.#writeGeneration === generation) this.#writeGeneration = 0
    })
  }

  #maximumScrollTop(): number {
    return Math.max(0, this.element.scrollHeight - this.element.clientHeight)
  }

  #clampVirtualPosition(position: number): number {
    if (!Number.isFinite(position)) return this.#motion.target
    if (this.#hasLoopingItems()) return position
    return Math.min(this.#maximumScrollTop(), Math.max(0, position))
  }

  #normalizedWheelDelta(event: WheelEvent): number {
    const pixels = event.deltaMode === 1
      ? event.deltaY * this.#itemHeight
      : event.deltaMode === 2
        ? event.deltaY * Math.max(this.#itemHeight, this.element.clientHeight)
        : event.deltaY

    if (!Number.isFinite(pixels) || pixels === 0) return 0
    const magnitude = this.#itemHeight * Math.tanh(Math.abs(pixels) / this.#itemHeight)
    return Math.sign(pixels) * magnitude
  }

  #canConsumeDelta(delta: number): boolean {
    if (this.#hasLoopingItems()) return true
    const target = this.#motion.target
    const next = this.#clampVirtualPosition(target + delta)
    return Math.abs(next - target) > POSITION_EPSILON
  }

  #sourceIndexForPosition(position: number): number {
    if (!this.#items.length) return -1
    const rawIndex = Math.round(position / this.#itemHeight)
    if (this.#hasLoopingItems()) {
      const sourceIndex = positiveModulo(rawIndex, this.#items.length)
      return nearestEnabledSourceIndex(this.#items, sourceIndex, true)
    }
    const sourceIndex = Math.min(this.#items.length - 1, Math.max(0, rawIndex))
    return nearestEnabledSourceIndex(this.#items, sourceIndex, false)
  }

  #alignedVirtualPosition(position: number, sourceIndex: number): number {
    const base = sourceIndex * this.#itemHeight
    if (!this.#hasLoopingItems()) return base
    const cycleHeight = this.#cycleHeight()
    const cycle = Math.round((position - base) / cycleHeight)
    return base + cycle * cycleHeight
  }

  #queueRecenter(): void {
    queueMicrotask(() => {
      if (!this.#destroyed && this.#interactive) this.recenter()
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

  #scheduleSettle(generation: number): void {
    this.#clearSettleTimer()
    this.element.classList.add('is-settling')
    this.#settleTimer = setTimeout(() => {
      this.#settleTimer = undefined
      this.element.classList.remove('is-settling')
      if (!this.#interactive || this.#destroyed || generation !== this.#motion.generation) return
      this.#settleSelection(generation)
    }, SCROLL_SETTLE_DELAY)
  }

  #beginNativeInteraction = (): void => {
    if (!this.#interactive || this.#destroyed) return
    this.#clearInput()
    this.#clearSettleTimer()
    const virtual = this.#physicalToVirtual(this.element.scrollTop, this.#motion.position)
    this.#motion.adopt(virtual)
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
    if (delta === 0 || !this.#canConsumeDelta(delta)) return

    event.preventDefault()
    this.#clearInput()
    this.#clearSettleTimer()
    const generation = this.#motion.input(delta, position => this.#clampVirtualPosition(position))
    this.#scheduleSettle(generation)
  }

  #handleScroll = (): void => {
    if (!this.#interactive || this.#destroyed || this.#motion.isMoving || this.#writeGeneration !== 0) return

    const current = this.element.scrollTop
    const virtual = this.#physicalToVirtual(current, this.#motion.position)
    const generation = this.#motion.adopt(virtual)

    if (this.#hasLoopingItems()) {
      const normalized = this.#normalizePhysicalPosition(virtual)
      if (Math.abs(normalized - current) > POSITION_EPSILON) this.#writeVirtualPosition(virtual)
    }

    this.#scheduleSettle(generation)
  }

  #settleSelection(generation: number): void {
    if (generation !== this.#motion.generation || !this.#items.length) return
    const position = this.#motion.target
    const sourceIndex = this.#sourceIndexForPosition(position)
    if (sourceIndex < 0) return

    const target = this.#clampVirtualPosition(this.#alignedVirtualPosition(position, sourceIndex))
    this.#motion.snap(target, generation, () => this.#commitSettledSelection(sourceIndex, generation))
  }

  #commitSettledSelection(sourceIndex: number, generation: number): void {
    if (
      generation !== this.#motion.generation
      || !this.#interactive
      || this.#destroyed
    ) {
      return
    }

    const item = this.#items[sourceIndex]
    if (!item || item.disabled) return

    const changed = this.#value !== item.value
    this.#value = item.value
    this.#updateSelectionState()
    if (changed) this.#onChange(item.value)
  }

  #handleClick = (event: MouseEvent): void => {
    if (!this.#interactive || this.#destroyed) return
    this.#clearInput()
    const option = findOptionFromEvent(event, this.element)
    if (!option) return

    const sourceIndex = Number(option.dataset.sourceIndex)
    if (!Number.isInteger(sourceIndex)) return
    this.focus()
    this.#chooseSourceIndex(sourceIndex)
  }

  #handleBlur = (): void => {
    if (this.#inputPreviewIndex >= 0) this.#commitInput()
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

    this.#clearInput()
    this.#clearSettleTimer()
    const changed = this.#value !== item.value
    this.#value = item.value
    this.#updateSelectionState()
    this.#motion.reset(this.#centralPositionForSource(sourceIndex))
    if (changed) this.#onChange(item.value)
  }

  #move(step: number): void {
    this.#clearInput()
    const enabled = this.#enabledSourceIndexes()
    if (!enabled.length) return
    const currentPosition = enabled.indexOf(this.#activeSourceIndex())
    if (currentPosition < 0) {
      const fallback = step < 0 && this.#loop ? enabled.at(-1) : enabled.at(0)
      if (fallback !== undefined) this.#chooseSourceIndex(fallback)
      return
    }

    let nextPosition = currentPosition + step
    if (this.#loop) nextPosition = positiveModulo(nextPosition, enabled.length)
    else nextPosition = Math.min(enabled.length - 1, Math.max(0, nextPosition))

    const sourceIndex = enabled[nextPosition]
    if (sourceIndex !== undefined) this.#chooseSourceIndex(sourceIndex)
  }

  #handleKeydown = (event: KeyboardEvent): void => {
    if (!this.#interactive || this.#destroyed) return

    if (event.key === 'Backspace' && this.#inputBuffer) {
      event.preventDefault()
      const characters = Array.from(this.#inputBuffer)
      characters.pop()
      const next = characters.join('')
      if (next) this.#setInput(next)
      else {
        this.#clearInput()
        this.recenter()
      }
      return
    }

    if (event.key === 'Delete' && this.#inputBuffer) {
      event.preventDefault()
      this.#clearInput()
      this.recenter()
      return
    }

    if (event.key === 'Enter' && this.#inputPreviewIndex >= 0) {
      event.preventDefault()
      this.#commitInput()
      return
    }

    if (event.key === 'Tab' && this.#inputPreviewIndex >= 0) {
      this.#commitInput()
      return
    }

    if (
      !event.ctrlKey
      && !event.metaKey
      && !event.altKey
      && isWheelInputCharacter(event.key)
    ) {
      if (this.#appendInput(event.key)) event.preventDefault()
      return
    }

    this.#clearInput()
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
        this.recenter()
        break
    }
  }

  #appendInput(character: string): boolean {
    const attempts = this.#inputBuffer
      ? [`${this.#inputBuffer}${character}`, character]
      : [character]

    for (const attempt of attempts) {
      const match = findWheelInputMatch(this.#items, attempt, this.#activeSourceIndex())
      if (!match) continue
      this.#inputBuffer = attempt
      this.#showInputPreview(match.index)
      if (match.unique) this.#commitInput()
      else this.#scheduleInputCommit()
      return true
    }

    this.#clearInput()
    return false
  }

  #setInput(input: string): void {
    const match = findWheelInputMatch(this.#items, input, this.#activeSourceIndex())
    if (!match) {
      this.#clearInput()
      this.recenter()
      return
    }
    this.#inputBuffer = input
    this.#showInputPreview(match.index)
    if (match.unique) this.#commitInput()
    else this.#scheduleInputCommit()
  }

  #showInputPreview(sourceIndex: number): void {
    this.#clearInputPreview()
    this.#inputPreviewIndex = sourceIndex
    this.element.classList.add('is-typing')
    this.element.dataset.input = this.#inputBuffer
    for (const option of this.element.querySelectorAll<HTMLElement>(`[data-source-index="${sourceIndex}"]`)) {
      option.classList.add('is-input-preview')
      option.dataset.input = this.#inputBuffer
    }
    this.#motion.reset(this.#centralPositionForSource(sourceIndex))
    this.#updateActiveDescendant()
  }

  #scheduleInputCommit(): void {
    if (this.#inputTimer !== undefined) clearTimeout(this.#inputTimer)
    this.#inputTimer = setTimeout(() => {
      this.#inputTimer = undefined
      this.#commitInput()
    }, INPUT_COMMIT_DELAY)
  }

  #commitInput(): void {
    const sourceIndex = this.#inputPreviewIndex
    if (sourceIndex < 0) return
    this.#chooseSourceIndex(sourceIndex)
  }

  #clearInputPreview(): void {
    for (const option of this.element.querySelectorAll<HTMLElement>('.sdp-wheel__option.is-input-preview')) {
      option.classList.remove('is-input-preview')
      option.removeAttribute('data-input')
    }
  }

  #clearInput(): void {
    if (this.#inputTimer !== undefined) clearTimeout(this.#inputTimer)
    this.#inputTimer = undefined
    if (!this.#inputBuffer && this.#inputPreviewIndex < 0) return
    this.#inputBuffer = ''
    this.#inputPreviewIndex = -1
    this.element.classList.remove('is-typing')
    this.element.removeAttribute('data-input')
    this.#clearInputPreview()
    this.#updateActiveDescendant()
  }

  #updateSelectionState(): void {
    for (const option of this.element.querySelectorAll<HTMLElement>('.sdp-wheel__option.is-selected')) {
      option.classList.remove('is-selected')
    }
    for (const option of this.element.querySelectorAll<HTMLElement>('[role="option"][aria-selected="true"]')) {
      option.setAttribute('aria-selected', 'false')
    }

    const sourceIndex = this.#activeSourceIndex()
    if (sourceIndex >= 0) {
      for (const option of this.element.querySelectorAll<HTMLElement>(`[data-source-index="${sourceIndex}"]`)) {
        option.classList.add('is-selected')
        if (option.getAttribute('role') === 'option') option.setAttribute('aria-selected', 'true')
      }
    }
    this.#updateActiveDescendant()
  }

  #updateActiveDescendant(): void {
    const sourceIndex = this.#inputPreviewIndex >= 0
      ? this.#inputPreviewIndex
      : this.#activeSourceIndex()
    if (sourceIndex < 0) {
      this.element.removeAttribute('aria-activedescendant')
      return
    }
    const cycle = this.#hasLoopingItems() ? 1 : 0
    this.element.setAttribute('aria-activedescendant', `${this.#baseId}-option-${cycle}-${sourceIndex}`)
  }

  #handleMotionPreferenceChange = (event: MediaQueryListEvent): void => {
    this.#motion.setReducedMotion(event.matches)
  }
}

interface WheelInputMatch {
  readonly index: number
  readonly unique: boolean
}

function findWheelInputMatch(
  items: readonly WheelItem[],
  input: string,
  currentIndex: number,
): WheelInputMatch | null {
  const query = normalizeWheelInput(input)
  if (!query) return null

  const matches: number[] = []
  const exact: number[] = []
  items.forEach((item, index) => {
    if (item.disabled) return
    const tokens = wheelInputTokens(item)
    if (!tokens.some(token => token.startsWith(query))) return
    matches.push(index)
    if (tokens.includes(query)) exact.push(index)
  })
  if (!matches.length) return null

  const preferred = nearestIndex(exact.length ? exact : matches, currentIndex)
  return { index: preferred, unique: matches.length === 1 }
}

function wheelInputTokens(item: WheelItem): readonly string[] {
  return [...new Set([
    normalizeWheelInput(String(item.value)),
    normalizeWheelInput(item.label),
  ].filter(Boolean))]
}

function normalizeWheelInput(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function nearestIndex(indexes: readonly number[], currentIndex: number): number {
  if (currentIndex < 0) return indexes[0] ?? -1
  return indexes.reduce((nearest, index) => (
    Math.abs(index - currentIndex) < Math.abs(nearest - currentIndex) ? index : nearest
  ), indexes[0] ?? -1)
}

function isWheelInputCharacter(value: string): boolean {
  return Array.from(value).length === 1 && /[\p{L}\p{N}]/u.test(value)
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

function nearestEnabledSourceIndex(
  items: readonly WheelItem[],
  start: number,
  loop: boolean,
): number {
  if (!items.length) return -1
  const clamped = Math.min(items.length - 1, Math.max(0, start))
  if (!items[clamped]?.disabled) return clamped

  for (let distance = 1; distance < items.length; distance += 1) {
    const before = loop ? positiveModulo(clamped - distance, items.length) : clamped - distance
    const after = loop ? positiveModulo(clamped + distance, items.length) : clamped + distance
    if (before >= 0 && before < items.length && !items[before]?.disabled) return before
    if (after >= 0 && after < items.length && !items[after]?.disabled) return after
  }
  return -1
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}
