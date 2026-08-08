# Date Picker

A dependency-free, framework-agnostic date and time picker built in TypeScript, with a thin Vue 3 adapter.

**Live demo:** https://shelamkoff.github.io/date-picker/

## Packages

- `@shelamkoff/date-picker` — vanilla DOM widget and headless core (`/core`), with zero runtime dependencies.
- `@shelamkoff/vue-date-picker` — thin Vue 3.5+ wrapper around the vanilla widget.
- `@shelamkoff/ui-kit` — optional CSS-only design tokens and primitives used as a compatible visual layer; the picker does not depend on it.

The picker is proleptic-Gregorian, handles DST gaps and repeated wall-clock minutes, supports min/max constraints, date-only and date-time modes, keyboard interaction, Shadow DOM event/focus behavior, and configurable CSS custom properties.

## Vanilla JavaScript / TypeScript

```bash
pnpm add @shelamkoff/date-picker
```

```ts
import { DatePicker } from '@shelamkoff/date-picker'
import '@shelamkoff/date-picker/style.css'

const picker = new DatePicker(document.querySelector('#date')!, {
  clearable: true,
  showNow: true,
  enableTime: true,
  minuteStep: 5,
  onChange(value, reason) {
    console.log(value, reason)
  },
})
```

The DOM-independent controller is available from `@shelamkoff/date-picker/core`.

## Vue 3

```bash
pnpm add @shelamkoff/vue-date-picker
```

```ts
import '@shelamkoff/vue-date-picker/style.css'
```

```vue
<script setup lang="ts">
import { shallowRef } from 'vue'
import { DatePicker } from '@shelamkoff/vue-date-picker'

const value = shallowRef<Date | null>(null)
</script>

<template>
  <DatePicker
    v-model="value"
    clearable
    show-now
    enable-time
    :minute-step="5"
  />
</template>
```

## Styling

The standalone widget exposes namespaced `--sdp-*` custom properties and includes dark defaults plus an explicit light theme.

```html
<div id="picker" class="sdp-theme-light"></div>
```

The optional UI kit exposes `--sui-*` tokens. The picker can use those tokens as fallbacks, but it remains fully functional without the UI kit.

## Development

```bash
corepack enable
pnpm install
pnpm verify
pnpm demo:build
```

The portable verification suite covers timezone transitions, DST gaps/folds, extreme JavaScript `Date` boundaries, advertised selectable values, DOM/wheel lifecycle races, SSR-safe imports, package exports, Shadow DOM behavior and the Vue bridge.

## License

MIT
