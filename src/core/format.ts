export type MonthDisplay = 'long' | 'short' | 'narrow' | 'numeric' | '2-digit'

const FORMATTER_CACHE_LIMIT = 32
const dateFormatterCache = new Map<string, Intl.DateTimeFormat>()
const monthLabelCache = new Map<string, readonly string[]>()
const numberFormatterCache = new Map<string, Intl.NumberFormat>()

function cached<K, V>(cache: Map<K, V>, key: K, create: () => V): V {
  const existing = cache.get(key)
  if (existing !== undefined) {
    cache.delete(key)
    cache.set(key, existing)
    return existing
  }

  const value = create()
  cache.set(key, value)
  if (cache.size > FORMATTER_CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  return value
}

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
  const formatter = cached(dateFormatterCache, key, () => new Intl.DateTimeFormat(locale, {
    calendar: 'gregory',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(era ? { era: 'short' } : {}),
    ...(enableTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const } : {}),
  }))
  return formatter.format(value)
}

export function createMonthFormatter(
  locale = 'en-US',
  display: MonthDisplay = 'short',
): (month: number) => string {
  const key = `${locale}|${display}`
  const labels = cached(monthLabelCache, key, () => {
    const formatter = new Intl.DateTimeFormat(locale, { calendar: 'gregory', month: display })
    return Array.from({ length: 12 }, (_, index) => {
      const date = new Date(0)
      date.setFullYear(2000, index, 1)
      date.setHours(12, 0, 0, 0)
      const raw = formatter.format(date)
      if (display === 'numeric' || display === '2-digit') return raw
      const label = raw.replace(/\.$/, '')
      return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1)
    })
  })

  return month => labels[Math.trunc(month) - 1] ?? String(month)
}

export function createNumberFormatter(
  locale = 'en-US',
  minimumIntegerDigits = 1,
  useGrouping = false,
): (value: number) => string {
  const key = `${locale}|${minimumIntegerDigits}|${useGrouping ? 'group' : 'plain'}`
  const formatter = cached(numberFormatterCache, key, () => new Intl.NumberFormat(locale, {
    minimumIntegerDigits,
    useGrouping,
  }))
  return value => formatter.format(value)
}
