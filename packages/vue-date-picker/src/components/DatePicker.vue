<script setup lang="ts">
import {
  DatePicker as VanillaDatePicker,
  isValidDate,
  type DatePickerChangeReason,
  type DatePickerOptions,
  type DatePickerWidgetOptions,
} from '@shelamkoff/date-picker'
import {
  onBeforeUnmount,
  onMounted,
  useTemplateRef,
  watch,
} from 'vue'

const props = withDefaults(defineProps<{
  readonly enableTime?: boolean
  readonly minDate?: Date | null
  readonly maxDate?: Date | null
  readonly placeholder?: string
  readonly clearable?: boolean
  readonly disabled?: boolean
  readonly loop?: boolean
  readonly showNow?: boolean
  readonly locale?: string
  readonly nowLabel?: string
  readonly clearLabel?: string
  readonly pickerLabel?: string
  readonly dayLabel?: string
  readonly monthLabel?: string
  readonly yearLabel?: string
  readonly hourLabel?: string
  readonly minuteLabel?: string
  readonly pastYears?: number
  readonly futureYears?: number
  readonly minuteStep?: number
  readonly now?: (() => Date) | null
  readonly popoverAlign?: 'start' | 'end'
  readonly triggerId?: string | null
  readonly ariaDescribedby?: string | null
  readonly ariaLabelledby?: string | null
  readonly ariaLabel?: string | null
  readonly invalid?: boolean
  readonly formatValue?: ((value: Date) => string) | null
}>(), {
  enableTime: false,
  minDate: null,
  maxDate: null,
  placeholder: 'Select date',
  clearable: false,
  disabled: false,
  loop: false,
  showNow: false,
  locale: 'en-US',
  nowLabel: 'Now',
  clearLabel: 'Clear date',
  pickerLabel: 'Date picker',
  dayLabel: 'Day',
  monthLabel: 'Month',
  yearLabel: 'Year',
  hourLabel: 'Hours',
  minuteLabel: 'Minutes',
  pastYears: 100,
  futureYears: 20,
  minuteStep: 1,
  now: null,
  popoverAlign: 'start',
  triggerId: null,
  ariaDescribedby: null,
  ariaLabelledby: null,
  ariaLabel: null,
  invalid: false,
  formatValue: null,
})

const model = defineModel<Date | null>({ required: true })
const emit = defineEmits<{
  change: [value: Date | null, reason: DatePickerChangeReason]
}>()

const host = useTemplateRef<HTMLElement>('host')
let picker: VanillaDatePicker | null = null
function dateKey(value: Date | null | undefined): string | number {
  if (value == null) return 'null'
  if (!isValidDate(value)) return 'invalid'
  return Date.prototype.getTime.call(value)
}

function coreOptions(): DatePickerOptions {
  return {
    enableTime: props.enableTime,
    minDate: props.minDate,
    maxDate: props.maxDate,
    pastYears: props.pastYears,
    futureYears: props.futureYears,
    minuteStep: props.minuteStep,
    now: props.now,
  }
}

function viewOptions(): Partial<DatePickerWidgetOptions> {
  return {
    placeholder: props.placeholder,
    clearable: props.clearable,
    disabled: props.disabled,
    loop: props.loop,
    showNow: props.showNow,
    locale: props.locale,
    nowLabel: props.nowLabel,
    clearLabel: props.clearLabel,
    pickerLabel: props.pickerLabel,
    dayLabel: props.dayLabel,
    monthLabel: props.monthLabel,
    yearLabel: props.yearLabel,
    hourLabel: props.hourLabel,
    minuteLabel: props.minuteLabel,
    popoverAlign: props.popoverAlign,
    triggerId: props.triggerId,
    ariaDescribedby: props.ariaDescribedby,
    ariaLabelledby: props.ariaLabelledby,
    ariaLabel: props.ariaLabel,
    invalid: props.invalid,
    formatValue: props.formatValue,
  }
}

function handleChange(value: Date | null, reason: DatePickerChangeReason): void {
  const next = value ? new Date(Date.prototype.getTime.call(value)) : null
  model.value = next
  emit('change', next ? new Date(Date.prototype.getTime.call(next)) : null, reason)
}

onMounted(() => {
  if (!host.value) return
  picker = new VanillaDatePicker(host.value, {
    ...coreOptions(),
    ...viewOptions(),
    value: model.value,
    onChange: handleChange,
  })
})

onBeforeUnmount(() => {
  picker?.destroy()
  picker = null
})

watch(
  () => [
    dateKey(model.value),
    props.enableTime,
    dateKey(props.minDate),
    dateKey(props.maxDate),
    props.pastYears,
    props.futureYears,
    props.minuteStep,
    props.now,
  ] as const,
  (current, previous) => {
    if (!picker) return

    const modelChanged = current[0] !== previous?.[0]
    let coreChanged = previous === undefined
    if (previous !== undefined) {
      for (let index = 1; index < current.length; index += 1) {
        if (current[index] !== previous[index]) {
          coreChanged = true
          break
        }
      }
    }

    if (modelChanged && dateKey(picker.value) !== current[0]) {
      picker.update({ ...coreOptions(), value: model.value })
      return
    }

    if (coreChanged) picker.update(coreOptions())
  },
)

watch(
  () => [
    props.placeholder,
    props.clearable,
    props.disabled,
    props.loop,
    props.showNow,
    props.locale,
    props.nowLabel,
    props.clearLabel,
    props.pickerLabel,
    props.dayLabel,
    props.monthLabel,
    props.yearLabel,
    props.hourLabel,
    props.minuteLabel,
    props.popoverAlign,
    props.triggerId,
    props.ariaDescribedby,
    props.ariaLabelledby,
    props.ariaLabel,
    props.invalid,
    props.formatValue,
  ] as const,
  () => picker?.update(viewOptions()),
)

defineExpose({
  open: () => picker?.open(),
  close: () => picker?.close(),
  focus: () => picker?.focus(),
  clear: () => picker?.clear(),
  selectNow: () => picker?.selectNow(),
})
</script>

<template>
  <div ref="host" class="sdp-vue-date-picker" />
</template>
