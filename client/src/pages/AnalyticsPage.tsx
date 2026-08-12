import { tokens } from '@/lib/format'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from 'recharts'
import { apiFetch } from '@/lib/api'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PageHeader } from '@/components/page-header'

type TimeRange = '24h' | '7d' | '30d'


const fmtTokens = (n: number | null | undefined) => tokens(n, '0')

function Stat({ label, value, className, hint }: { label: string; value: string | number; className?: string; hint?: string }) {
  return (
    <div className="card-sheen rounded-xl border bg-card px-4 py-3.5 transition-colors hover:border-info-border" title={hint}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold tabular-nums mt-1.5 ${className ?? ''}`}>{value}</p>
    </div>
  )
}

function Panel({ title, children, accent = 'info' }: { title: string; children: React.ReactNode; accent?: 'info' | 'destructive' }) {
  const dot = accent === 'destructive' ? 'bg-destructive' : 'bg-info'
  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <span className={`size-1.5 rounded-full ${dot}`} aria-hidden="true" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

const axisStyle = { fontSize: 12, fill: 'var(--muted-foreground)' } as const
const gridStyle = 'var(--border)'
const primaryFill = 'var(--foreground)'

export default function AnalyticsPage() {
  const [range, setRange] = useState<TimeRange>('7d')

  const { data: summary } = useQuery({
    queryKey: ['analytics', 'summary', range],
    queryFn: () => apiFetch<any>(`/api/analytics/summary?range=${range}`),
  })

  const { data: byPlatform = [] } = useQuery({
    queryKey: ['analytics', 'by-platform', range],
    queryFn: () => apiFetch<any[]>(`/api/analytics/by-platform?range=${range}`),
  })

  const { data: timeline = [] } = useQuery({
    queryKey: ['analytics', 'timeline', range],
    queryFn: () => apiFetch<any[]>(`/api/analytics/timeline?range=${range}`),
  })

  const { data: byModel = [] } = useQuery({
    queryKey: ['analytics', 'by-model', range],
    queryFn: () => apiFetch<any[]>(`/api/analytics/by-model?range=${range}`),
  })

  const { data: errors = [] } = useQuery({
    queryKey: ['analytics', 'errors', range],
    queryFn: () => apiFetch<any[]>(`/api/analytics/errors?range=${range}`),
  })

  const { data: errorDist } = useQuery({
    queryKey: ['analytics', 'error-distribution', range],
    queryFn: () => apiFetch<{ byCategory: any[]; byPlatform: any[]; detailed: any[] }>(`/api/analytics/error-distribution?range=${range}`),
  })

  const { data: quality } = useQuery<{ p50LatencyMs: number; p95LatencyMs: number; firstTryRate: number | null; finishReasons: { reason: string; count: number }[] }>({
    queryKey: ['analytics', 'quality', range],
    queryFn: () => apiFetch(`/api/analytics/quality?range=${range}`),
  })

  return (
    <div>
      <PageHeader
        title="التحليلات"
        description="حجم الطلبات، زمن الاستجابة، استهلاك التوكنز، والأخطاء."
        accent="info"
        icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg>}
        actions={
          <div className="flex gap-0.5 rounded-lg border bg-muted p-0.5">
            {(['24h', '7d', '30d'] as TimeRange[]).map(r => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium tabular-nums transition-colors ${
                  range === r
                    ? 'bg-info-subtle text-info'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        }
      />

      <div className="space-y-4">
        {/* Summary stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Stat label="الطلبات" value={summary?.totalRequests ?? 0} className="text-info" />
          <Stat label="نسبة النجاح" value={`${summary?.successRate ?? 0}%`} className="text-success" />
          <Stat label="توكنز الدخل" value={fmtTokens(summary?.totalInputTokens)} />
          <Stat label="توكنز الخرج" value={fmtTokens(summary?.totalOutputTokens)} />
          <Stat label="متوسط زمن الاستجابة" value={`${summary?.avgLatencyMs ?? 0} ms`} />
          <Stat
            label="التوفير التقديري"
            value={`$${summary?.estimatedCostSavings ?? '0.00'}`}
            className="text-success"
            hint="تقدير المبلغ الموفَّر مقابل تشغيل نفس التوكنز على واجهة مدفوعة مماثلة، مُسعّرة حسب فئة النموذج."
          />
        </div>

        {/* Bento grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Reliability & quality (from captured request metadata) */}
          <div className="lg:col-span-12">
            <Panel title="الموثوقية والجودة">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="زمن الاستجابة p50" value={`${quality?.p50LatencyMs ?? 0} ms`} />
                <Stat label="زمن الاستجابة p95" value={`${quality?.p95LatencyMs ?? 0} ms`} className="text-warn" />
                <Stat label="نجاح من أول محاولة" value={quality?.firstTryRate == null ? '—' : `${quality.firstTryRate}%`} className="text-success" hint="نسبة الطلبات اللي خدمها أول نموذج بدون تحويل احتياطي" />
                <div className="card-sheen rounded-xl border bg-card px-4 py-3.5">
                  <p className="text-xs text-muted-foreground">أسباب الإنهاء</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {(quality?.finishReasons ?? []).length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      quality!.finishReasons.map(f => (
                        <span key={f.reason} className="inline-flex h-5 items-center gap-1 rounded-md border bg-muted px-1.5 text-xs">
                          <span className="font-mono">{f.reason}</span>
                          <span className="text-muted-foreground tabular-nums">{f.count.toLocaleString('ar-EG-u-nu-latn')}</span>
                        </span>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </Panel>
          </div>

          <div className="lg:col-span-6">
          <Panel title="الطلبات حسب المزوّد">
            {byPlatform.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">لا توجد بيانات بعد</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={byPlatform} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke={gridStyle} />
                  <XAxis dataKey="platform" tick={axisStyle} tickLine={false} axisLine={{ stroke: gridStyle }} />
                  <YAxis tick={axisStyle} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="requests" fill={primaryFill} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>
          </div>

          <div className="lg:col-span-6">
          <Panel title="متوسط زمن الاستجابة حسب المزوّد">
            {byPlatform.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">لا توجد بيانات بعد</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={byPlatform} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke={gridStyle} />
                  <XAxis dataKey="platform" tick={axisStyle} tickLine={false} axisLine={{ stroke: gridStyle }} />
                  <YAxis unit="ms" tick={axisStyle} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="avgLatencyMs" name="زمن الاستجابة (ms)" fill="var(--muted-foreground)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>
          </div>

          <div className="lg:col-span-12">
            <Panel title="الطلبات عبر الزمن">
              {timeline.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">لا توجد بيانات بعد</p>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={timeline} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="2 4" stroke={gridStyle} />
                    <XAxis dataKey="timestamp" tick={axisStyle} tickLine={false} axisLine={{ stroke: gridStyle }} />
                    <YAxis tick={axisStyle} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} iconType="line" />
                    <Line type="monotone" dataKey="successCount" name="ناجحة" stroke={primaryFill} strokeWidth={1.5} dot={false} />
                    <Line type="monotone" dataKey="failureCount" name="فاشلة" stroke="var(--destructive)" strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </Panel>
          </div>

          <div className="lg:col-span-12">
            <Panel title="تفصيل حسب النموذج">
              {byModel.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">لا توجد بيانات بعد</p>
              ) : (
                <div tabIndex={0} className="max-h-[360px] overflow-y-auto -mx-4 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/70">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="ps-4">النموذج</TableHead>
                        <TableHead>المزوّد</TableHead>
                        <TableHead className="text-end">الطلبات</TableHead>
                        <TableHead className="text-end">النجاح</TableHead>
                        <TableHead className="text-end">الاستجابة</TableHead>
                        <TableHead className="text-end">توكنز دخل</TableHead>
                        <TableHead className="text-end pe-4">توكنز خرج</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {byModel.map((m: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="ps-4 text-sm font-medium">{m.displayName}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{m.platform}</TableCell>
                          <TableCell className="text-end tabular-nums">{m.requests}</TableCell>
                          <TableCell className="text-end tabular-nums">{m.successRate}%</TableCell>
                          <TableCell className="text-end tabular-nums">{m.avgLatencyMs} ms</TableCell>
                          <TableCell className="text-end tabular-nums">{fmtTokens(m.totalInputTokens)}</TableCell>
                          <TableCell className="text-end tabular-nums pe-4">{fmtTokens(m.totalOutputTokens)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Panel>
          </div>

          <div className="lg:col-span-6">
          <Panel title="الأخطاء حسب المزوّد" accent="destructive">
            {!errorDist?.byPlatform?.length ? (
              <p className="text-sm text-muted-foreground text-center py-8">لا أخطاء</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={errorDist.byPlatform} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke={gridStyle} />
                  <XAxis dataKey="platform" tick={axisStyle} tickLine={false} axisLine={{ stroke: gridStyle }} />
                  <YAxis tick={axisStyle} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="count" fill="var(--destructive)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Panel>
          </div>

          <div className="lg:col-span-6">
          <Panel title="أحدث الأخطاء" accent="destructive">
            {errors.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">لا أخطاء</p>
            ) : (
              <div tabIndex={0} className="max-h-[240px] overflow-y-auto -mx-4 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/70">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="ps-4">المزوّد</TableHead>
                      <TableHead>الرسالة</TableHead>
                      <TableHead className="text-end pe-4">الوقت</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {errors.slice(0, 20).map((e: any) => (
                      <TableRow key={e.id}>
                        <TableCell className="ps-4 text-xs">{e.platform}</TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate">{e.error}</TableCell>
                        <TableCell className="text-end text-xs text-muted-foreground tabular-nums pe-4">
                          {new Date(e.createdAt).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Panel>
          </div>
        </div>
      </div>
    </div>
  )
}
