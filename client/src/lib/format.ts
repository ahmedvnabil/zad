/**
 * One place that decides how numbers look.
 *
 * Before this there were four competing policies: `toLocaleString('en-US')`,
 * bare `toLocaleString()` (browser locale — Arabic-Indic digits under an ar
 * runtime), `toLocaleTimeString([])`, and one hardcoded `'ar-EG'`. The same
 * integer could render as 45,200 on one page and ٤٥٬٢٠٠ on another.
 *
 * The locale is pinned to `ar-EG-u-nu-latn`: Arabic conventions, Latin digits.
 * Latin digits are the right call here because everything they sit next to —
 * currency, model ids, endpoints, latencies — is Latin, and mixing scripts
 * inside one row is worse than either choice on its own.
 *
 * `formatTokens` also existed three times with three different implementations
 * that disagreed: two handled billions, one didn't.
 */

const LOCALE = 'ar-EG-u-nu-latn'

export function num(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return n.toLocaleString(LOCALE)
}

/**
 * Compact token counts: 1.2B / 45.2M / 131K.
 *
 * There were three of these. Analytics' copy had no billions branch, so a
 * 2B-token budget rendered as "2000.0M".
 */
export function tokens(n: number | null | undefined, absent = '—'): string {
  if (n === null || n === undefined || Number.isNaN(n)) return absent
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return num(n)
}

export function money(usd: number | null | undefined): string {
  if (usd === null || usd === undefined || Number.isNaN(usd)) return '—'
  if (usd <= 0) return '$0'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

export function ms(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return num(Math.round(n))
}

export function pct(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return `${n.toFixed(digits)}%`
}

export function time(d: string | number | Date): string {
  return new Date(d).toLocaleTimeString(LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function date(d: string | number | Date): string {
  return new Date(d).toLocaleDateString(LOCALE)
}

export function dateTime(d: string | number | Date): string {
  return new Date(d).toLocaleString(LOCALE)
}
