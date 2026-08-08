# @shelamkoff/vue-date-picker

Thin Vue 3 adapter for `@shelamkoff/date-picker`.

The Vue package does **not** implement calendar math, wheel rendering, popup behavior or accessibility itself. It creates the vanilla picker on mount, synchronizes props and `v-model`, and destroys it on unmount.

```ts
import { DatePicker } from '@shelamkoff/vue-date-picker'
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
  />
</template>
```

Vue is a peer dependency. `v-model` is required and has the public type `Date | null`. The adapter is SSR-safe: the DOM picker is instantiated only in `onMounted()`. The package exports its own `style.css`, so consumers do not need to import CSS through the transitive vanilla dependency.
