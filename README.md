# @shelamkoff/date-picker

A dependency-free, framework-agnostic date and time picker written in TypeScript.

**Live demo:** https://shelamkoff.github.io/date-picker/

## Features

- zero runtime dependencies;
- standalone DOM widget and DOM-independent core;
- date-only and date-time modes;
- min/max constraints;
- configurable minute step;
- local civil-time handling, including DST gaps and repeated wall-clock times;
- keyboard interaction and accessible DOM attributes;
- Shadow DOM-friendly event and focus behavior;
- dark defaults, built-in light theme and CSS custom-property theming.

## Installation

```bash
npm install @shelamkoff/date-picker
```

## Usage

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
  onChange(value, reason) {
    console.log(value, reason)
  },
})
```

The picker owns only the DOM it creates inside the supplied host. Calling `destroy()` removes that subtree and releases its listeners.

## Headless core

The DOM-independent controller is exported from `@shelamkoff/date-picker/core`:

```ts
import { createDatePicker } from '@shelamkoff/date-picker/core'

const controller = createDatePicker({
  enableTime: true,
  minuteStep: 5,
})

controller.open()
console.log(controller.snapshot.columns)
```

## Localization

The default locale is `en-US`. The picker uses the Gregorian calendar and lets you override all user-facing labels.

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

The default palette is dark. Add `sdp-theme-light` or `data-sdp-theme="light"` to the host to use the built-in light palette:

```html
<div id="date" class="sdp-theme-light"></div>
```

The stylesheet exposes namespaced `--sdp-*` custom properties for application-level customization.

## Development

```bash
npm install
npm run typecheck
npm run build
```

## License

MIT
