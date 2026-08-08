<script setup lang="ts">
import { DatePicker } from '@shelamkoff/vue-date-picker'

// Import once from an application entry stylesheet/module:
// import '@shelamkoff/vue-date-picker/style.css'

const props = withDefaults(defineProps<{
  readonly enableTime?: boolean
  readonly minDate?: Date | null
  readonly maxDate?: Date | null
  readonly placeholder?: string
  readonly clearable?: boolean
  readonly disabled?: boolean
  readonly loop?: boolean
  readonly showNow?: boolean
  readonly minuteStep?: number
}>(), {
  enableTime: false,
  minDate: null,
  maxDate: null,
  placeholder: 'Select date',
  clearable: false,
  disabled: false,
  loop: false,
  showNow: false,
  minuteStep: 1,
})

const model = defineModel<Date | null>({ required: true })
</script>

<template>
  <DatePicker v-model="model" v-bind="props" />
</template>
