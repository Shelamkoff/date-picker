from pathlib import Path
from textwrap import dedent


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'{label} target not found')
    return text.replace(old, new, 1)


# Core month formatting ---------------------------------------------------------
Path('src/core/format.ts').write_text(dedent('''
export type MonthDisplay = 'long' | 'short' | 'narrow' | 'numeric' | '2-digit'

const FORMATTER_CACHE_LIMIT = 32
const dateFormatterCache = new Map<string, Intl.DateTimeFormat>()
const monthLabelCache = new Map<string, readonly string[]>()
const numberFormatterCache = new Map<string, Intl.NumberFormat>()

function cached<K, V>(cache: Map<K, V>, key: K, create: () => V): V {
  const existing = cache.get(key)
  if (existing !== undefined) {
    cache.delete(key)
    cache.set(key, existing)
    return existing
  }

  const value = create()
  cache.set(key, value)
  if (cache.size > FORMATTER_CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  return value
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function formatDatePickerValue(
  value: Date,
  enableTime: boolean,
  locale = 'en-US',
): string {
  const era = Date.prototype.getFullYear.call(value) <= 0
  const key = `${locale}|${enableTime ? 'time' : 'date'}|${era ? 'era' : 'common'}`
  const formatter = cached(dateFormatterCache, key, () => new Intl.DateTimeFormat(locale, {
    calendar: 'gregory',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(era ? { era: 'short' } : {}),
    ...(enableTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const } : {}),
  }))
  return formatter.format(value)
}

export function createMonthFormatter(
  locale = 'en-US',
  display: MonthDisplay = 'short',
): (month: number) => string {
  const key = `${locale}|${display}`
  const labels = cached(monthLabelCache, key, () => {
    const formatter = new Intl.DateTimeFormat(locale, { calendar: 'gregory', month: display })
    return Array.from({ length: 12 }, (_, index) => {
      const date = new Date(0)
      date.setFullYear(2000, index, 1)
      date.setHours(12, 0, 0, 0)
      const raw = formatter.format(date)
      if (display === 'numeric' || display === '2-digit') return raw
      const label = raw.replace(/\.$/, '')
      return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1)
    })
  })

  return month => labels[Math.trunc(month) - 1] ?? String(month)
}

export function createNumberFormatter(
  locale = 'en-US',
  minimumIntegerDigits = 1,
  useGrouping = false,
): (value: number) => string {
  const key = `${locale}|${minimumIntegerDigits}|${useGrouping ? 'group' : 'plain'}`
  const formatter = cached(numberFormatterCache, key, () => new Intl.NumberFormat(locale, {
    minimumIntegerDigits,
    useGrouping,
  }))
  return value => formatter.format(value)
}
''').lstrip())


# Wheel type-to-enter -----------------------------------------------------------
wheel_path = Path('src/dom/WheelColumn.ts')
wheel = wheel_path.read_text()
wheel = replace_once(
    wheel,
    'const POSITION_EPSILON = 0.5\n',
    'const POSITION_EPSILON = 0.5\nconst INPUT_COMMIT_DELAY = 700\n',
    'WheelColumn constant',
)
wheel = replace_once(
    wheel,
    '  #settleTimer: ReturnType<typeof setTimeout> | undefined\n  #writeGeneration = 0\n',
    "  #settleTimer: ReturnType<typeof setTimeout> | undefined\n  #inputTimer: ReturnType<typeof setTimeout> | undefined\n  #inputBuffer = ''\n  #inputPreviewIndex = -1\n  #writeGeneration = 0\n",
    'WheelColumn fields',
)
wheel = replace_once(
    wheel,
    '  setItems(items: readonly WheelItem[], value: number): void {\n    const sameItems = wheelItemsEqual(this.#items, items)\n',
    '  setItems(items: readonly WheelItem[], value: number): void {\n    this.#clearInput()\n    const sameItems = wheelItemsEqual(this.#items, items)\n',
    'WheelColumn setItems',
)
wheel = replace_once(
    wheel,
    '  cancelPendingSelection(): void {\n    this.#clearSettleTimer()\n',
    '  cancelPendingSelection(): void {\n    this.#clearInput()\n    this.#clearSettleTimer()\n',
    'WheelColumn cancel',
)
wheel = replace_once(
    wheel,
    '  #beginNativeInteraction = (): void => {\n    if (!this.#interactive || this.#destroyed) return\n    this.#clearSettleTimer()\n',
    '  #beginNativeInteraction = (): void => {\n    if (!this.#interactive || this.#destroyed) return\n    this.#clearInput()\n    this.#clearSettleTimer()\n',
    'WheelColumn native input',
)
wheel = replace_once(
    wheel,
    '    event.preventDefault()\n    this.#clearSettleTimer()\n    const generation = this.#motion.input(delta, position => this.#clampVirtualPosition(position))\n',
    '    event.preventDefault()\n    this.#clearInput()\n    this.#clearSettleTimer()\n    const generation = this.#motion.input(delta, position => this.#clampVirtualPosition(position))\n',
    'WheelColumn wheel input',
)
wheel = replace_once(
    wheel,
    '  #handleClick = (event: MouseEvent): void => {\n    if (!this.#interactive || this.#destroyed) return\n    const option = findOptionFromEvent(event, this.element)\n',
    '  #handleClick = (event: MouseEvent): void => {\n    if (!this.#interactive || this.#destroyed) return\n    this.#clearInput()\n    const option = findOptionFromEvent(event, this.element)\n',
    'WheelColumn click input',
)
wheel = replace_once(
    wheel,
    '  #chooseSourceIndex(sourceIndex: number): void {\n    const item = this.#items[sourceIndex]\n    if (!item || item.disabled) return\n\n    this.#clearSettleTimer()\n',
    '  #chooseSourceIndex(sourceIndex: number): void {\n    const item = this.#items[sourceIndex]\n    if (!item || item.disabled) return\n\n    this.#clearInput()\n    this.#clearSettleTimer()\n',
    'WheelColumn choose input',
)
wheel = replace_once(
    wheel,
    '  #move(step: number): void {\n    const enabled = this.#enabledSourceIndexes()\n',
    '  #move(step: number): void {\n    this.#clearInput()\n    const enabled = this.#enabledSourceIndexes()\n',
    'WheelColumn move input',
)

old_keydown = dedent('''
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
        this.recenter()
        break
    }
  }
''').strip()
new_keydown = dedent('''
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
''').strip()
wheel = replace_once(wheel, old_keydown, new_keydown, 'WheelColumn keydown')

input_methods = dedent('''
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

''')
wheel = replace_once(
    wheel,
    '  #updateSelectionState(): void {\n',
    input_methods + '  #updateSelectionState(): void {\n',
    'WheelColumn input methods',
)
wheel = replace_once(
    wheel,
    '    const sourceIndex = this.#activeSourceIndex()\n    if (sourceIndex < 0) {\n',
    '    const sourceIndex = this.#inputPreviewIndex >= 0\n      ? this.#inputPreviewIndex\n      : this.#activeSourceIndex()\n    if (sourceIndex < 0) {\n',
    'WheelColumn active descendant',
)

helpers = dedent('''

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
''')
wheel = replace_once(
    wheel,
    '\nfunction findOptionFromEvent(event: MouseEvent, root: HTMLElement): HTMLElement | null {\n',
    helpers + '\nfunction findOptionFromEvent(event: MouseEvent, root: HTMLElement): HTMLElement | null {\n',
    'WheelColumn helpers',
)
wheel_path.write_text(wheel)


# DOM widget configuration ------------------------------------------------------
picker_path = Path('src/dom/DatePicker.ts')
picker = picker_path.read_text()
picker = replace_once(
    picker,
    "  type DatePickerSnapshot,\n} from '../core/index.js'\n",
    "  type DatePickerSnapshot,\n  type MonthDisplay,\n} from '../core/index.js'\n",
    'DatePicker import',
)
picker = replace_once(
    picker,
    '  readonly locale?: string\n  readonly placeholder?: string\n',
    "  readonly locale?: string\n  readonly monthDisplay?: MonthDisplay\n  readonly formatMonth?: ((month: number, locale: string) => string) | null\n  readonly placeholder?: string\n",
    'DatePicker public options',
)
picker = replace_once(
    picker,
    '  locale: string\n  placeholder: string\n',
    "  locale: string\n  monthDisplay: MonthDisplay\n  formatMonth: ((month: number, locale: string) => string) | null\n  placeholder: string\n",
    'DatePicker view options',
)
picker = replace_once(
    picker,
    '      const monthLabel = createMonthFormatter(this.#view.locale)\n',
    dedent('''
      const customMonthFormatter = this.#view.formatMonth
      const monthLabel = customMonthFormatter
        ? (month: number): string => formatCustomMonth(customMonthFormatter, month, this.#view.locale)
        : createMonthFormatter(this.#view.locale, this.#view.monthDisplay)
'''),
    'DatePicker month formatter',
)
picker = replace_once(
    picker,
    "  const formatValue = patch.formatValue !== undefined ? patch.formatValue : previous?.formatValue ?? null\n  const onChange = patch.onChange !== undefined ? patch.onChange : previous?.onChange ?? null\n  if (formatValue !== null && typeof formatValue !== 'function') throw new TypeError('formatValue must be a function or null')\n  if (onChange !== null && typeof onChange !== 'function') throw new TypeError('onChange must be a function or null')\n\n  return {\n    locale: resolveLocale(patch.locale ?? previous?.locale ?? 'en-US'),\n",
    "  const formatValue = patch.formatValue !== undefined ? patch.formatValue : previous?.formatValue ?? null\n  const formatMonth = patch.formatMonth !== undefined ? patch.formatMonth : previous?.formatMonth ?? null\n  const onChange = patch.onChange !== undefined ? patch.onChange : previous?.onChange ?? null\n  if (formatValue !== null && typeof formatValue !== 'function') throw new TypeError('formatValue must be a function or null')\n  if (formatMonth !== null && typeof formatMonth !== 'function') throw new TypeError('formatMonth must be a function or null')\n  if (onChange !== null && typeof onChange !== 'function') throw new TypeError('onChange must be a function or null')\n\n  const locale = resolveLocale(patch.locale ?? previous?.locale ?? 'en-US')\n  const monthDisplay = resolveMonthDisplay(patch.monthDisplay ?? previous?.monthDisplay ?? 'short')\n\n  return {\n    locale,\n    monthDisplay,\n    formatMonth,\n",
    'DatePicker option resolution',
)
picker = replace_once(
    picker,
    "function resolvePopoverAlign(value: unknown): 'start' | 'end' {\n",
    "function resolveMonthDisplay(value: unknown): MonthDisplay {\n  if (value === 'long' || value === 'short' || value === 'narrow' || value === 'numeric' || value === '2-digit') return value\n  throw new RangeError(\"monthDisplay must be 'long', 'short', 'narrow', 'numeric' or '2-digit'\")\n}\n\nfunction resolvePopoverAlign(value: unknown): 'start' | 'end' {\n",
    'DatePicker month validation',
)
picker = replace_once(
    picker,
    'function numberItems(values: readonly number[], label: (value: number) => string): WheelItem[] {\n',
    "function formatCustomMonth(\n  formatter: (month: number, locale: string) => string,\n  month: number,\n  locale: string,\n): string {\n  const label = formatter(month, locale)\n  if (typeof label !== 'string') throw new TypeError('formatMonth must return a string')\n  return label\n}\n\nfunction numberItems(values: readonly number[], label: (value: number) => string): WheelItem[] {\n",
    'DatePicker custom month helper',
)
picker_path.write_text(picker)


# Typeahead visual state --------------------------------------------------------
styles_path = Path('src/style.css')
styles = styles_path.read_text()
style_marker = '.sdp-wheel__option.is-selected { color: var(--sdp-text, #f4f5f5); font-weight: 650; }\n'
styles = replace_once(
    styles,
    style_marker,
    style_marker + dedent('''
.sdp-wheel__option.is-input-preview {
  position: relative;
  color: transparent;
  font-weight: 650;
}

.sdp-wheel__option.is-input-preview::after {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--sdp-text, #f4f5f5);
  content: attr(data-input);
  pointer-events: none;
}
'''),
    'typeahead styles',
)
styles_path.write_text(styles)


# Unit coverage ----------------------------------------------------------------
Path('tests/month-format.test.mjs').write_text(dedent('''
import test from 'node:test'
import assert from 'node:assert/strict'
import { createMonthFormatter } from '../dist/core/index.js'

test('month formatter supports textual and numeric displays', () => {
  assert.equal(createMonthFormatter('en-US', 'long')(1), 'January')
  assert.equal(createMonthFormatter('en-US', 'short')(1), 'Jan')
  assert.equal(createMonthFormatter('en-US', 'narrow')(1), 'J')
  assert.equal(createMonthFormatter('en-US', 'numeric')(1), '1')
  assert.equal(createMonthFormatter('en-US', '2-digit')(1), '01')
})

test('month formatter keeps locale-specific labels', () => {
  assert.equal(createMonthFormatter('ru-RU', 'long')(1), 'Январь')
  assert.equal(createMonthFormatter('ru-RU', '2-digit')(12), '12')
})
''').lstrip())


# Permanent browser regression -------------------------------------------------
browser_path = Path('tests/pointer-selection.browser.mjs')
browser = browser_path.read_text()
browser = replace_once(
    browser,
    "    minuteStep: 5,\n    loop: false,\n",
    "    minuteStep: 5,\n    monthDisplay: 'long',\n    loop: false,\n",
    'browser month option',
)
marker = '// Keyboard or programmatic focus leaving the widget must still close it.\n'
insertion = dedent('''
// Focused wheels accept direct numeric or textual input.
await page.evaluate(() => {
  const { picker, changes } = window.__pointerRegression
  changes.length = 0
  picker.setValue(new Date(2026, 5, 15, 12, 30))
  picker.update({ monthDisplay: 'long', formatMonth: null })
  picker.open()
})

assert.equal(await optionFor('Month', 7).textContent(), 'July')

async function typeIntoWheel(label, value) {
  const wheel = page.locator(`#pointer-regression .sdp-wheel[aria-label="${label}"]`)
  await wheel.focus()
  await page.keyboard.type(value, { delay: 20 })
  await page.waitForTimeout(40)
  await assertPopoverOpen(`${label} keyboard input closed the popover`)
}

await typeIntoWheel('Month', 'jul')
await typeIntoWheel('Year', '2027')
await typeIntoWheel('Day', '22')
await typeIntoWheel('Hours', '09')
await typeIntoWheel('Minutes', '45')

const typedState = await page.evaluate(() => {
  const value = window.__pointerRegression.picker.value
  return {
    year: value.getFullYear(),
    month: value.getMonth() + 1,
    day: value.getDate(),
    hour: value.getHours(),
    minute: value.getMinutes(),
    reasons: window.__pointerRegression.changes.map(change => change.reason),
  }
})
assert.deepEqual(typedState, {
  year: 2027,
  month: 7,
  day: 22,
  hour: 9,
  minute: 45,
  reasons: ['select', 'select', 'select', 'select', 'select'],
})

await page.evaluate(() => window.__pointerRegression.picker.update({
  monthDisplay: '2-digit',
  formatMonth: null,
}))
assert.equal(await optionFor('Month', 7).textContent(), '07')
await page.evaluate(() => window.__pointerRegression.picker.update({
  formatMonth: month => `M${month}`,
}))
assert.equal(await optionFor('Month', 7).textContent(), 'M7')

''')
browser = replace_once(browser, marker, insertion + marker, 'browser direct input')
browser_path.write_text(browser)


# Playground configuration -----------------------------------------------------
demo_path = Path('index.html')
demo = demo_path.read_text()
demo = replace_once(
    demo,
    '<label class="switch-row"><span>Loop wheels</span><input id="opt-loop" type="checkbox"></label>\n            <label class="select-row"><span>Minute step</span>',
    '<label class="switch-row"><span>Loop wheels</span><input id="opt-loop" type="checkbox"></label>\n            <label class="select-row"><span>Month labels</span><select id="opt-month-display"><option value="long">Names</option><option value="short" selected>Short names</option><option value="numeric">Numbers</option><option value="2-digit">Two digits</option></select></label>\n            <label class="select-row"><span>Minute step</span>',
    'demo month control',
)
demo = replace_once(
    demo,
    "        loop: byId('opt-loop').checked,\n        minuteStep: Number(byId('opt-step').value),\n",
    "        loop: byId('opt-loop').checked,\n        monthDisplay: byId('opt-month-display').value,\n        minuteStep: Number(byId('opt-step').value),\n",
    'demo month option',
)
demo = replace_once(
    demo,
    "for (const id of ['opt-time','opt-clear','opt-now','opt-loop','opt-step'])",
    "for (const id of ['opt-time','opt-clear','opt-now','opt-loop','opt-month-display','opt-step'])",
    'demo control listeners',
)
demo = replace_once(
    demo,
    'Normal applications can update an existing instance through <code>update()</code>.</p>',
    'Normal applications can update an existing instance through <code>update()</code>. Focus a wheel and type a number or a month-name prefix to select it directly.</p>',
    'demo input guidance',
)
demo_path.write_text(demo)


# README -----------------------------------------------------------------------
readme_path = Path('README.md')
readme = readme_path.read_text()
readme = replace_once(
    readme,
    '- configurable minute step;\n',
    '- configurable minute step;\n- month wheels with long, short, narrow, numeric, two-digit or custom labels;\n- direct keyboard entry in the focused day, month, year, hour and minute wheel;\n',
    'README feature list',
)
readme = replace_once(
    readme,
    "  minuteStep: 5,\n  clearable: true,\n",
    "  minuteStep: 5,\n  monthDisplay: 'long',\n  clearable: true,\n",
    'README example',
)
table_marker = '| `minuteStep` | `1…30` | `1` | Regular minute grid. Exact min/max boundary minutes are also exposed when necessary. |\n'
readme = replace_once(
    readme,
    table_marker,
    table_marker
    + '| `monthDisplay` | `long \\| short \\| narrow \\| numeric \\| 2-digit` | `short` | Standard localized month labels used by the month wheel. |\n'
    + '| `formatMonth` | `(month, locale) => string` | `null` | Custom month-wheel formatter. It takes precedence over `monthDisplay`. |\n',
    'README month options',
)
api_marker = '`value`, `setValue()`, `selectNow()` and user selections use minute precision. Date-only values are normalized to the first representable local minute of the selected civil day. Values outside the configured bounds are clamped. With `minuteStep > 1`, values are aligned to the nearest selectable step; exact bound minutes remain selectable so narrow ranges cannot become empty.\n'
keyboard_section = api_marker + dedent('''

### Direct wheel input

When a wheel has focus, type its value directly. Numeric input works for day, month, year, hour and minute even when the month wheel displays names. Text input matches localized month labels case-insensitively, so typing `jul` selects July in an English `long` or `short` month wheel. Multi-character values are buffered briefly; `Backspace` edits the buffer, `Enter` commits it immediately, and normal arrow, Page Up/Down, Home and End navigation remains available. Invalid or unavailable values are not committed.

Month labels and the trigger value can be formatted independently:

```ts
new DatePicker(host, {
  monthDisplay: '2-digit',
  formatMonth(month, locale) {
    return new Intl.NumberFormat(locale, { minimumIntegerDigits: 2 }).format(month)
  },
  formatValue(value) {
    return value.toLocaleString('ru-RU')
  },
})
```
''')
readme = replace_once(readme, api_marker, keyboard_section, 'README keyboard section')
readme_path.write_text(readme)
