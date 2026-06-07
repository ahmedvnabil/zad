import type { ReactNode } from 'react'

export type Accent = 'brand' | 'success' | 'info' | 'warn'

// Literal class strings so Tailwind keeps them in the build.
const ACCENT: Record<Accent, { chip: string; bar: string }> = {
  brand: { chip: 'bg-brand/10 text-brand ring-brand/25', bar: 'bg-brand' },
  success: { chip: 'bg-success/10 text-success ring-success/25', bar: 'bg-success' },
  info: { chip: 'bg-info/10 text-info ring-info/25', bar: 'bg-info' },
  warn: { chip: 'bg-warn/10 text-warn ring-warn/25', bar: 'bg-warn' },
}

export function PageHeader({
  title,
  description,
  actions,
  icon,
  accent = 'brand',
}: {
  title: string
  description?: string
  actions?: ReactNode
  icon?: ReactNode
  accent?: Accent
}) {
  const a = ACCENT[accent]
  return (
    <div className="flex items-start justify-between gap-6 pb-5 mb-6 border-b">
      <div className="min-w-0 flex items-start gap-3">
        {icon ? (
          <span className={`mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl ring-1 ${a.chip}`}>
            {icon}
          </span>
        ) : (
          <span className={`mt-1 inline-block h-6 w-1 shrink-0 rounded-full ${a.bar}`} aria-hidden="true" />
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description && (
            <p className="text-sm text-muted-foreground mt-1.5">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}
