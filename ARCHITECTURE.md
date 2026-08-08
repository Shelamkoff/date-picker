# Architecture

## 1. `@shelamkoff/date-picker`

This is the actual date-picker library.

It is framework-agnostic and contains two public layers.

### Vanilla DOM widget — package root

```ts
import { DatePicker } from '@shelamkoff/date-picker'
```

Responsibilities:

- trigger and popup DOM;
- wheel/listbox rendering;
- mouse, touch, scroll and keyboard interaction;
- focus and dismiss behavior;
- accessibility attributes;
- public imperative API (`open`, `close`, `setValue`, `update`, `clear`, `selectNow`, `destroy`);
- user change callback / `date-picker-change` DOM event.

It is written in TypeScript and uses browser platform APIs only. It has **zero runtime dependencies**.

### Headless controller — `@shelamkoff/date-picker/core`

Responsibilities:

- JavaScript `Date` validation and cloning;
- local civil date/time normalization;
- min/max constraints;
- DST gaps and skipped civil dates;
- proleptic-Gregorian month length;
- bounded year windows;
- day/month/year/hour/minute column values;
- `minuteStep`;
- draft/public-value separation;
- change/state events.

The `core` source contains no DOM or framework globals and can be reused by other renderers.

## 2. `@shelamkoff/vue-date-picker`

A thin Vue 3.5+ integration package.

It does **not** implement:

- calendar math;
- wheels;
- popup markup;
- popup/focus behavior;
- picker CSS.

Its single Vue component:

1. renders a host element;
2. creates `new DatePicker(host, options)` in `onMounted()`;
3. synchronizes Vue props and `v-model<Date | null>`;
4. exposes a small imperative API;
5. calls `destroy()` in `onBeforeUnmount()`.

This makes the adapter SSR-safe without any framework-specific SSR component: the vanilla DOM widget is simply not created until mount.

Dependency direction:

```text
@shelamkoff/date-picker  <--  @shelamkoff/vue-date-picker
        ^
        |
  standalone DOM UI
```

Vue is a peer dependency of the Vue adapter only.

## 3. `@shelamkoff/ui-kit`

Optional CSS-only design system:

- neutral `--sui-*` tokens;
- dark/light palettes;
- primitive CSS classes;
- zero JavaScript and zero framework dependency.

The visual values come from the supplied admin-theme reference, but there is no application code or application naming in the package.

The picker does not import this package. Its own `--sdp-*` tokens may fall back to `--sui-*` when present.

## Dependency graph

```text
ui-kit (optional CSS, independent)

        date-picker (vanilla DOM + headless core)
                    |
                    v
             vue-date-picker
            (thin Vue wrapper)
```
