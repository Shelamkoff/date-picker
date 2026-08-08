# @shelamkoff/date-picker

A dependency-free, framework-agnostic date and time picker written in TypeScript.

**Live demo:** https://shelamkoff.github.io/date-picker/

## Features

- zero runtime dependencies;
- standalone DOM widget and DOM-independent controller;
- date-only and date-time modes;
- min/max constraints applied to every wheel;
- configurable minute step;
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

The stylesheet exposes namespaced `--sdp-*` properties, including colors, control height, radii, shadow, font and z-index. It has no dependency on an external design system.

## Browser and accessibility notes

The distributed JavaScript targets ES2022 and requires modern DOM, `Intl.DateTimeFormat`, `Intl.NumberFormat` and `requestAnimationFrame` support. Mouse-wheel events are consumed only while a non-looping wheel can move; at its first or last value, scrolling can continue on the surrounding page. Touch scrolling remains native. Users who enable `prefers-reduced-motion` receive immediate wheel positioning without inertial animation.

## Development

```bash
npm ci
npm run typecheck
npm test
npm pack --dry-run --ignore-scripts
```

The tests cover value normalization, bounds, minute-step boundary values, duplicate change suppression, defensive snapshots, partial DST gaps and generation-safe wheel motion.

## License

MIT
