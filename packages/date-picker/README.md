# @shelamkoff/date-picker

Framework-agnostic vanilla TypeScript/DOM date and time picker.

It has no Vue, React, router or application dependency. A headless controller is also exported from `@shelamkoff/date-picker/core` for other adapters.

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
  onChange(value) {
    console.log(value)
  },
})
```

The widget owns its DOM below the supplied host and removes only that subtree on `destroy()`.

## Headless core

```ts
import { createDatePicker } from '@shelamkoff/date-picker/core'

const controller = createDatePicker({ enableTime: true })
controller.open()
console.log(controller.snapshot.columns)
```

## Standalone theming

The default visual fallback is dark. For the built-in light palette without the optional UI kit, add `sdp-theme-light` or `data-sdp-theme="light"` to the host (custom properties inherit into the widget):

```html
<div id="date" class="sdp-theme-light"></div>
```

The picker uses the host environment's local civil time. DST gaps and entirely skipped civil dates are handled. During an autumn clock rollback, the wheel still shows one entry for a repeated wall-clock minute, but the core tracks all representable occurrences internally: it preserves the current occurrence when possible and chooses an occurrence that satisfies bounds and is closest to the current draft instant.


## Localization

Runtime defaults are framework/application-neutral English (`en-US`). `locale` localizes presentation but the picker remains Gregorian (`calendar: gregory`) so displayed years/months cannot diverge from the Gregorian wheel state. Override `locale` and labels for your product:

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
