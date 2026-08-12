import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PageHeader } from '@/components/page-header'

interface ChatMsg { role: string; content: unknown }

interface RequestRow {
  id: number
  platform: string
  modelId: string
  displayName: string
  status: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCostUsd: number
  latencyMs: number
  error: string | null
  createdAt: string
  requestedModel: string | null
  messageCount: number | null
  hadTools: boolean | null
  streamed: boolean | null
  attempts: number | null
  finishReason: string | null
  requestMessages: ChatMsg[] | null
  promptPreview: string | null
  responsePreview: string | null
}

interface RequestsResponse {
  total: number
  limit: number
  offset: number
  requests: RequestRow[]
}

const PAGE_SIZE = 50
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

function statusClass(status: string): string {
  if (status === 'success') return 'text-success'
  if (status === 'error' || status === 'failure') return 'text-destructive'
  return 'text-warn'
}

function statusDotClass(status: string): string {
  if (status === 'success') return 'bg-success'
  if (status === 'error' || status === 'failure') return 'bg-destructive'
  return 'bg-warn'
}

function fmtCost(usd: number): string {
  if (usd <= 0) return '$0'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-mono break-all">{value}</span>
    </div>
  )
}

function RequestDetail({ r, onReplay }: { r: RequestRow; onReplay: (r: RequestRow) => void }) {
  const yn = (v: boolean | null) => (v === null ? '—' : v ? 'نعم' : 'لا')
  const canReplay = !!r.requestMessages?.some(m => m.role === 'user' && typeof m.content === 'string')
  return (
    <div className="bg-muted px-4 py-4 border-t space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-4 rounded-lg border bg-card p-4">
        <Detail label="معرّف الطلب" value={`#${r.id}`} />
        <Detail label="المطلوب" value={r.requestedModel ?? '—'} />
        <Detail label="النموذج المُستخدَم" value={r.modelId} />
        <Detail label="المزوّد" value={r.platform} />
        <Detail label="محاولات التحويل الاحتياطي" value={r.attempts ?? '—'} />
        <Detail label="الرسائل" value={r.messageCount ?? '—'} />
        <Detail label="الأدوات" value={yn(r.hadTools)} />
        <Detail label="بثّ متدفّق" value={yn(r.streamed)} />
        <Detail label="سبب الإنهاء" value={r.finishReason ?? '—'} />
        <Detail label="توكنز الدخل" value={r.inputTokens.toLocaleString('ar-EG-u-nu-latn')} />
        <Detail label="توكنز الخرج" value={r.outputTokens.toLocaleString('ar-EG-u-nu-latn')} />
        <Detail label="إجمالي التوكنز" value={r.totalTokens.toLocaleString('ar-EG-u-nu-latn')} />
        <Detail label="زمن الاستجابة" value={`${r.latencyMs} ms`} />
        <Detail label="التكلفة المقدّرة" value={fmtCost(r.estimatedCostUsd)} />
        <Detail label="الوقت والتاريخ" value={new Date(r.createdAt).toLocaleString('ar-EG-u-nu-latn')} />
        <Detail label="الحالة" value={<span className={statusClass(r.status)}>{r.status}</span>} />
      </div>

      {(r.promptPreview || r.responsePreview) ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {r.promptPreview && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">الموجّه (معاينة)</span>
              <pre dir="auto" className="text-xs whitespace-pre-wrap break-all bg-background border rounded-lg p-3 max-h-40 overflow-auto">{r.promptPreview}</pre>
            </div>
          )}
          {r.responsePreview && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">الاستجابة (معاينة)</span>
              <pre dir="auto" className="text-xs whitespace-pre-wrap break-all bg-background border rounded-lg p-3 max-h-40 overflow-auto">{r.responsePreview}</pre>
            </div>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">لم يُسجَّل المحتوى — فعّل «التقاط المحتوى» لتسجيل الموجّهات والاستجابات.</p>
      )}

      {r.error && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-destructive">خطأ</span>
          <pre className="text-xs text-destructive-subtle-foreground whitespace-pre-wrap break-all bg-destructive-subtle border border-destructive-border rounded-lg p-3 max-h-40 overflow-auto">{r.error}</pre>
        </div>
      )}

      {canReplay && (
        <Button size="sm" variant="outline" onClick={() => onReplay(r)}>إعادة التشغيل في ساحة التجربة</Button>
      )}
    </div>
  )
}

export default function RequestsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState<number | null>(null)
  const [status, setStatus] = useState('all')
  const [searchInput, setSearchInput] = useState('')
  const [q, setQ] = useState('')
  const [offset, setOffset] = useState(0)

  // Debounce the search box so we don't refetch on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => { setQ(searchInput); setOffset(0) }, 350)
    return () => clearTimeout(t)
  }, [searchInput])

  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
  if (status !== 'all') params.set('status', status)
  if (q) params.set('q', q)
  const filterQs = (() => { const p = new URLSearchParams(); if (status !== 'all') p.set('status', status); if (q) p.set('q', q); return p.toString() })()

  const { data, isLoading } = useQuery<RequestsResponse>({
    queryKey: ['requests', status, q, offset],
    queryFn: () => apiFetch(`/api/analytics/requests?${params.toString()}`),
    refetchInterval: offset === 0 ? 5000 : false, // only live-tail the first page
  })

  const { data: capture } = useQuery<{ enabled: boolean }>({
    queryKey: ['settings', 'capture-content'],
    queryFn: () => apiFetch('/api/settings/capture-content'),
  })
  const captureMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch('/api/settings/capture-content', { method: 'PUT', body: JSON.stringify({ enabled }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings', 'capture-content'] }),
  })
  const clearMutation = useMutation({
    mutationFn: () => apiFetch('/api/settings/clear-request-content', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['requests'] }),
  })

  function handleReplay(r: RequestRow) {
    const lastUser = [...(r.requestMessages ?? [])].reverse().find(m => m.role === 'user' && typeof m.content === 'string')
    const prompt = typeof lastUser?.content === 'string' ? lastUser.content : ''
    const model = r.requestedModel && !r.requestedModel.startsWith('auto') ? r.modelId : 'auto'
    sessionStorage.setItem('freellm:replay', JSON.stringify({ prompt, model }))
    navigate('/playground')
  }

  const rows = data?.requests ?? []
  const total = data?.total ?? 0
  const showingTo = offset + rows.length
  const selectedRow = rows.find(r => r.id === expanded) ?? null

  return (
    <div className="space-y-6">
      <PageHeader
        title="الطلبات"
        description="سجلّ حيّ لأحدث طلبات الوكيل — اضغط على أي صف لعرض كامل التفاصيل."
        accent="brand"
        icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>}
        actions={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground select-none" title="تخزين موجّه كل طلب مع معاينة للاستجابة (متوقّف افتراضيًا)">
              <Switch aria-label="حفظ محتوى الطلبات" checked={capture?.enabled ?? false} onCheckedChange={(c) => captureMutation.mutate(c)} />
              التقاط المحتوى
            </label>
            <Button
              variant="outline" size="sm"
              onClick={() => { if (confirm('مسح كل الموجّهات ومعاينات الاستجابات المخزّنة؟ تُحفظ المقاييس.')) clearMutation.mutate() }}
            >
              مسح المحتوى
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex h-8 items-center rounded-lg border bg-muted p-0.5">
          {(['all', 'success', 'error'] as const).map(s => (
            <button
              key={s}
              onClick={() => { setStatus(s); setOffset(0) }}
              className={`h-7 rounded-md px-3 text-xs font-medium transition-colors ${status === s ? 'bg-brand-subtle text-brand' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {s === 'all' ? 'كل الحالات' : s === 'success' ? 'ناجح' : 'خطأ'}
            </button>
          ))}
        </div>
        <input
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          placeholder="ابحث في النموذج / المزوّد / الخطأ…"
          className="h-8 flex-1 min-w-[200px] rounded-lg border bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-brand-border focus:border-brand-border"
        />
        <a href={`${BASE}/api/analytics/requests/export?format=csv&${filterQs}`} className="inline-flex h-8 items-center rounded-lg border px-3 text-xs transition-colors hover:bg-accent">تصدير CSV</a>
        <a href={`${BASE}/api/analytics/requests/export?format=json&${filterQs}`} className="inline-flex h-8 items-center rounded-lg border px-3 text-xs transition-colors hover:bg-accent">JSON</a>
        <span className="text-xs text-muted-foreground tabular-nums ms-auto">
          {total > 0 ? `${(offset + 1).toLocaleString('ar-EG-u-nu-latn')}–${showingTo.toLocaleString('ar-EG-u-nu-latn')} من ${total.toLocaleString('ar-EG-u-nu-latn')}` : `${total} الإجمالي`}
        </span>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">جارٍ التحميل…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center bg-card card-sheen">
          <p className="text-sm text-muted-foreground">لا توجد طلبات مطابقة.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-4">
          <div className="min-w-0">
            <div className="rounded-xl border bg-card card-sheen overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="ps-4">النموذج</TableHead>
                    <TableHead>المزوّد</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead className="text-end">التوكنز</TableHead>
                    <TableHead className="text-end">التكلفة</TableHead>
                    <TableHead className="text-end">زمن الاستجابة</TableHead>
                    <TableHead className="pe-4">الوقت</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(r => {
                    const isOpen = expanded === r.id
                    return (
                      <TableRow key={r.id} className={`cursor-pointer transition-colors hover:bg-accent ${isOpen ? 'bg-accent' : ''}`} onClick={() => setExpanded(isOpen ? null : r.id)}>
                        <TableCell className="ps-4 text-sm font-medium max-w-[240px] truncate">
                          {/* The row's onClick is a mouse convenience; a <tr> is
                              not focusable and takes no key events, so this
                              button is the only way in from the keyboard. */}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setExpanded(isOpen ? null : r.id) }}
                            aria-expanded={isOpen}
                            aria-controls={`req-detail-${r.id}`}
                            className="inline-flex max-w-full items-center gap-2 rounded-sm text-start focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/70"
                          >
                            <span aria-hidden="true" className={`inline-block size-1.5 rounded-full ${statusDotClass(r.status)}`} />
                            <span aria-hidden="true" className="inline-block w-3 text-muted-foreground">{isOpen ? '▾' : '▸'}</span>
                            <span className="truncate">{r.displayName}</span>
                            <span className="sr-only">— {r.status}{isOpen ? '، التفاصيل مفتوحة' : ''}</span>
                          </button>
                          {r.attempts && r.attempts > 1 && (
                            <span className="ms-2 text-xs text-warn-subtle-foreground tabular-nums">↻{r.attempts}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">{r.platform}</TableCell>
                        <TableCell className={`text-xs font-medium ${statusClass(r.status)}`}>{r.status}</TableCell>
                        <TableCell className="text-end tabular-nums text-xs">{r.totalTokens.toLocaleString('ar-EG-u-nu-latn')}</TableCell>
                        <TableCell className="text-end tabular-nums text-xs">{fmtCost(r.estimatedCostUsd)}</TableCell>
                        <TableCell className="text-end tabular-nums text-xs">{r.latencyMs} ms</TableCell>
                        <TableCell className="pe-4 text-xs text-muted-foreground tabular-nums">
                          {new Date(r.createdAt).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                  {/* Inline detail for the widths where the aside is hidden.
                      RequestDetail is already styled for exactly this — it has
                      its own border-t and padding. */}
                  {selectedRow && (
                    <TableRow className="lg:hidden">
                      <TableCell colSpan={7} className="p-0">
                        <RequestDetail r={selectedRow} onReplay={handleReplay} />
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-center justify-end gap-2 mt-4">
              <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>السابق</Button>
              <Button variant="outline" size="sm" disabled={showingTo >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>التالي</Button>
            </div>
          </div>

          <aside
            id={selectedRow ? `req-detail-${selectedRow.id}` : undefined}
            tabIndex={0}
            aria-label="تفاصيل الطلب"
            className="hidden lg:block rounded-xl border bg-card card-sheen lg:sticky lg:top-20 self-start max-h-[calc(100vh-7rem)] overflow-y-auto focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/70">
            {selectedRow ? (
              <RequestDetail r={selectedRow} onReplay={handleReplay} />
            ) : (
              <div className="flex min-h-[200px] items-center justify-center p-8 text-center">
                <p className="text-sm text-muted-foreground">اختر طلباً من القائمة لعرض تفاصيله</p>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}
