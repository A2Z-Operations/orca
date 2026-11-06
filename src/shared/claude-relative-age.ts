const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
  ['second', 1000]
]

/** "9 minutes ago", "in 2 hours", "now". A future time reads as "in …". */
export function formatClaudeRelativeAge(at: number, now: number, locale?: string): string {
  const delta = at - now
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'long' })
  for (const [unit, size] of UNITS) {
    if (Math.abs(delta) >= size || unit === 'second') {
      return format.format(Math.round(delta / size), unit)
    }
  }
  return format.format(0, 'second')
}

/** Compact age for CLI columns: 45s, 9m, 3h, 2d. */
export function formatClaudeShortAge(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) {
    return `${seconds}s`
  }
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`
}
