# @shelamkoff/date-picker

A dependency-free, framework-agnostic date and time picker written in TypeScript.

**Live demo:** https://shelamkoff.github.io/date-picker/

## Features

- zero runtime dependencies;
- standalone DOM widgets and DOM-independent controllers;
- calendar mode: single date, date range, multiple dates, inline and popover presentation;
- date-only and date-time modes;
- min/max constraints applied to every wheel;
- configurable minute step;
- month wheels with long, short, narrow, numeric, two-digit or custom labels;
- direct keyboard entry in the focused day, month, year, hour and minute wheel;
- optional cyclic wheel scrolling;
- smooth mouse-wheel input and native touch scrolling;
- reduced-motion support;
- local civil-time handling, including DST gaps and repeated wall-clock times;
- keyboard interaction, accessible listboxes and Shadow DOM-safe events;
- viewport-aware popup flipping and horizontal collision correction;
- dark defaults, built-in light theme and CSS custom-property theming.

## Installation

```bash
npm install @shelamkoff/date-picker
```

## DOM widget

```ts
import { DatePicker } from '@shelamkoff/date-picker'
import '@shelamkoff/date-picker/style.css'

const host = document.querySelector<HTMLElement>('#date')!

const picker = new DatePicker(host, {
  value: null,
  enableTime: true,
  minuteStep: 5,
  monthDisplay: 'long',
  clearable: true,
  showNow: true,
  loop: true,
  onChange(value, reason) {
    console.log(value, reason)
  },
})
```

The widget owns only the subtree it creates inside the supplied host. Calling `destroy()` removes that subtree and releases document, viewport and media-query listeners.

### Widget options

| Option | Type | Default | Purpose |
|---|---|---:|---|
| `value` | `Date \| null` | `null` | Initial value. It is normalized to picker precision and constraints. |
| `enableTime` | `boolean` | `false` | Show hour and minute wheels. |
| `minDate` / `maxDate` | `Date \| null` | `null` | Inclusive selectable bounds. |
| `pastYears` | `number` | `100` | Years before the active year, capped at 200. |
| `futureYears` | `number` | `20` | Years after the active year, capped at 200. |
| `minuteStep` | `1…30` | `1` | Regular minute grid. Exact min/max boundary minutes are also exposed when necessary. |
| `monthDisplay` | `long \| short \| narrow \| numeric \| 2-digit` | `short` | Standard localized month labels used by the month wheel. |
| `formatMonth` | `(month, locale) => string` | `null` | Custom month-wheel formatter. It takes precedence over `monthDisplay`. |
| `loop` | `boolean` | `false` | Wrap each wheel from its last available value to its first and vice versa. |
| `clearable` | `boolean` | `false` | Show the clear button when a value exists. |
| `showNow` | `boolean` | `false` | Show the “Now” action. |
| `disabled` | `boolean` | `false` | Disable the widget. |
| `locale` | `string` | `en-US` | Locale used for labels and formatted output. |
| `popoverAlign` | `start \| end` | `start` | Preferred horizontal popup alignment. |
| `formatValue` | `(Date) => string` | built-in | Custom trigger formatter. |
| `onChange` | `(Date \| null, reason) => void` | `null` | Called only when the value actually changes. |

All user-facing labels and ARIA references can be overridden through `placeholder`, `nowLabel`, `clearLabel`, `pickerLabel`, `dayLabel`, `monthLabel`, `yearLabel`, `hourLabel`, `minuteLabel`, `ariaLabel`, `ariaLabelledby` and `ariaDescribedby`.

### Instance API

```ts
picker.open()
picker.close()
picker.toggle()
picker.setValue(new Date())
picker.update({ minuteStep: 15, loop: false })
picker.selectNow()
picker.clear()
picker.focus()
picker.destroy()

console.log(picker.value)
console.log(picker.isOpen)
console.log(picker.snapshot)
```

`value`, `setValue()`, `selectNow()` and user selections use minute precision. Date-only values are normalized to the first representable local minute of the selected civil day. Values outside the configured bounds are clamped. With `minuteStep > 1`, values are aligned to the nearest selectable step; exact bound minutes remain selectable so narrow ranges cannot become empty.

### Direct wheel input

When a wheel has focus, type its value directly. Numeric input works for day, month, year, hour and minute even when the month wheel displays names. Text input matches localized month labels case-insensitively, so typing `jul` selects July in an English `long` or `short` month wheel.

Multi-character values are buffered briefly. `Backspace` edits the buffer, `Delete` cancels it, `Enter` commits it immediately, and `Tab` commits before moving focus. Arrow keys, Page Up/Down, Home and End remain available. Invalid, disabled or unavailable values are not committed.

Month labels and the trigger value can be formatted independently:

```ts
new DatePicker(host, {
  monthDisplay: '2-digit',
  formatMonth(month, locale) {
    return new Intl.NumberFormat(locale, {
      minimumIntegerDigits: 2,
      useGrouping: false,
    }).format(month)
  },
  formatValue(value) {
    return value.toLocaleString('ru-RU')
  },
})
```

For standard localized labels, omit `formatMonth` and choose one of:

```ts
picker.update({ monthDisplay: 'long' })    // January
picker.update({ monthDisplay: 'short' })   // Jan
picker.update({ monthDisplay: 'narrow' })  // J
picker.update({ monthDisplay: 'numeric' }) // 1
picker.update({ monthDisplay: '2-digit' }) // 01
```

### DOM event

The host dispatches a bubbling, composed `date-picker-change` event after a real value change:

```ts
host.addEventListener('date-picker-change', event => {
  const { value, reason } = event.detail
})
```

`reason` is `select`, `now` or `clear`. The event carries cloned `Date` instances and is safe to receive across a Shadow DOM boundary.

## Headless controller

```ts
import { createDatePicker } from '@shelamkoff/date-picker/core'

const controller = createDatePicker({
  enableTime: true,
  minuteStep: 5,
})

controller.open()
console.log(controller.snapshot.columns)
controller.select('minute', 30)
```

The controller contains no DOM references. Snapshots and returned dates are defensive copies.

## Local time and DST

The picker uses the host environment’s local civil time and the Gregorian calendar. It rejects nonexistent local minutes, preserves representable occurrences during repeated wall-clock times and filters every wheel through the active bounds. The public API intentionally uses `Date`; timezone selection is outside this package’s scope.

## Localization

```ts
new DatePicker(host, {
  locale: 'ru-RU',
  placeholder: 'Выберите дату',
  nowLabel: 'Сейчас',
  clearLabel: 'Очистить дату',
  pickerLabel: 'Выбор даты',
  dayLabel: 'День',
  monthLabel: 'Месяц',
  yearLabel: 'Год',
  hourLabel: 'Часы',
  minuteLabel: 'Минуты',
})
```

## Theming

The default palette is dark. Add `sdp-theme-light` or `data-sdp-theme="light"` to the host for the built-in light palette:

```html
<div id="date" class="sdp-theme-light"></div>
```

The stylesheet exposes namespaced `--sdp-*` properties, including colors, control height, radii, shadow, font, month-wheel width and z-index. It has no dependency on an external design system.

## Browser and accessibility notes

The distributed JavaScript targets ES2022 and requires modern DOM, `Intl.DateTimeFormat`, `Intl.NumberFormat` and `requestAnimationFrame` support. Mouse-wheel events are consumed only while a non-looping wheel can move; at its first or last value, scrolling can continue on the surrounding page. Touch scrolling remains native. Users who enable `prefers-reduced-motion` receive immediate wheel positioning without inertial animation.

Focused wheels use their current listbox option as the input target; direct typing does not add a separate form field or change the public value until a valid option is committed.

## Development

```bash
npm ci
npm run typecheck
npm test
npm pack --dry-run --ignore-scripts
```

The tests cover value normalization, bounds, minute-step boundary values, month-label modes, direct wheel entry, duplicate change suppression, defensive snapshots, partial DST gaps, pointer interactions and generation-safe wheel motion.

## Calendar view: single, range and multiple selection

The existing `DatePicker` wheel widget and `createDatePicker()` headless wheel controller are unchanged. Use `CalendarDatePicker` for a month-grid calendar, or `createDatePickerWidget()` to select the view at construction time.

```ts
import { CalendarDatePicker, createDatePickerWidget } from '@shelamkoff/date-picker'
import '@shelamkoff/date-picker/style.css'

// One day. Default calendar picker mode.
const single = new CalendarDatePicker(document.querySelector('#single')!, {
  mode: 'single', locale: 'en-GB', clearable: true,
  onChange(value, reason) { console.log(value, reason) },
})

// Inclusive range. Two clicks select start and end; a third restarts.
const range = createDatePickerWidget(document.querySelector('#range')!, {
  view: 'calendar',
  mode: 'range',
  minRangeDays: 2,
  maxRangeDays: 30,
  disabledDate: day => day.getDay() === 0,
  onChange(value) { console.log(value) }, // { start: Date|null, end: Date|null }
})

// Multi-date toggles, no duplicates, sorted ascending.
const multiple = new CalendarDatePicker(document.querySelector('#multiple')!, {
  mode: 'multiple', maxSelections: 7, clearable: true,
  closeOnSelect: false,
})

// Always-visible month grid (no trigger/popover).
const inline = new CalendarDatePicker(document.querySelector('#inline')!, {
  mode: 'range', inline: true, showWeekNumbers: true,
})
```

Calendar options: `mode` (`single`, `range`, `multiple`), inclusive `minDate`/`maxDate`, `disabledDate(date)`, `minRangeDays`/`maxRangeDays`, `maxSelections`, `weekStartsOn` (0=Sunday), `fixedWeeks` (always 6 rows), `inline`, `showOutsideDays`, `showWeekNumbers`, `locale`, `readOnly`, `disabled`, `clearable`, `showToday`, `closeOnSelect`, `formatValue`, `onChange`, and optional accessible button labels. The month header has previous/next buttons. Keyboard: arrow keys, Home/End, Page Up/Down (Shift for years), Enter/Space to select and Escape to close a popover. Range selection previews the interval on pointer hover. A selected value is cloned before being returned; boundaries are local calendar dates (not UTC timestamps), so date comparisons survive DST transitions.

`CalendarDatePicker.value` and `setValue()` use `Date | null` in single mode, `{start: Date|null, end: Date|null}` in range mode and `readonly Date[]` in multiple mode. The first range click emits a partial range; the second emits the completed range. `update()`, `open()`, `close()`, `toggle()`, `clear()`, `selectToday()`, `navigate(months)`, `focus()`, and `destroy()` are available. The bubbling `date-picker-change` event includes `detail.value`, `detail.reason` and `detail.mode`; `onChange` runs only on a value change. Programmatic `setValue()` does not emit user-change events.

The independent, DOM-free `CalendarSelectionController` is exported from `@shelamkoff/date-picker/core`. It supports the same selection, bounds, range checks and month calculation, with `subscribe()` and defensive snapshots. All modes share calendar civil-date arithmetic; the original wheel controller remains responsible for local times and minute precision.

Calendar `update({ minDate, value })` applies the new constraints and an explicit value atomically: an invalid requested value leaves both the previous value and constraints unchanged. In the headless controller, use `update(options, { value })` for the same transaction. Constraint-only updates can clear previously selected dates if those dates become unavailable; these programmatic changes do not fire the user-facing `onChange` callback. `canSelectToday()` reports whether the Today action is possible under the current bounds, disabled-day predicate, range length, and multiple-selection limit.

The calendar uses locale-native numerals for day, year and ISO week labels, and chooses non-ambiguous compact weekday names where possible. Inline calendars shrink with their containers; for mobile popovers, the actions remain reachable and the time-wheel columns fit in the available width. `destroy()` removes event listeners so previously retained DOM references no longer operate a destroyed widget.

## Run the demo locally

```bash
npm ci
npm run build
python3 -m http.server 4173
```

Open http://127.0.0.1:4173/. CSS is served directly from `src/style.css` and `demo.css`, without generated root-level files. GitHub Pages publishes these assets with versioned library paths.

## License

MIT
