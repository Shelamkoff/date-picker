const dateFormatterCache = new Map<string, Intl.DateTimeFormat>()
const monthFormatterCache = new Map<string, Intl.DateTimeFormat>()
const numberFormatterCache = new Map<string, Intl.NumberFormat>()

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
  let formatter = dateFormatterCache.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      calendar: 'gregory',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      ...(era ? { era: 'short' } : {}),
      ...(enableTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const } : {}),
    })
    dateFormatterCache.set(key, formatter)
  }
  return formatter.format(value)
}

export function createMonthFormatter(locale = 'en-US'): (month: number) => string {
  let formatter = monthFormatterCache.get(locale)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { calendar: 'gregory', month: 'short' })
    monthFormatterCache.set(locale, formatter)
  }
  return month => {
    const date = new Date(0)
    date.setFullYear(2000, month - 1, 1)
    date.setHours(12, 0, 0, 0)
    const label = formatter.format(date).replace(/\.$/, '')
    return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1)
  }
}

export function createNumberFormatter(
  locale = 'en-US',
  minimumIntegerDigits = 1,
  useGrouping = false,
): (value: number) => string {
  const key = `${locale}|${minimumIntegerDigits}|${useGrouping ? 'group' : 'plain'}`
  let formatter = numberFormatterCache.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      minimumIntegerDigits,
      useGrouping,
    })
    numberFormatterCache.set(key, formatter)
  }
  return value => formatter.format(value)
}
