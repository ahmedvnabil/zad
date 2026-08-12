import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { apiFetch } from '@/lib/api'
import {
  Compass, Plus, Search, BookOpen, Check, Loader2, AlertCircle,
  X, Brain, Wrench, Image as ImageIcon, Zap, ExternalLink,
} from 'lucide-react'

interface ProviderSummary {
  id: string
  name: string
  model_count: number
  has_api: boolean
  is_openai_compat: boolean
  env: string[]
  doc?: string
  api?: string | null
}

interface RegistryModel {
  id: string
  name?: string
  family?: string
  reasoning?: boolean
  tool_call?: boolean
  attachment?: boolean
  open_weights?: boolean
  knowledge?: string
  limit?: { context?: number; output?: number }
  cost?: { input?: number; output?: number }
  modalities?: { input?: string[]; output?: string[] }
}

interface ProviderDetail {
  id: string
  name: string
  env?: string[]
  doc?: string
  api?: string | null
  models: Record<string, RegistryModel>
}

interface RegistryStats {
  providers: number
  models: number
  cached_at: number | null
  age_seconds: number | null
}

function formatAge(s: number | null) {
  if (s == null) return '—'
  if (s < 60) return `${s}ث`
  if (s < 3600) return `${Math.floor(s / 60)}د`
  if (s < 86400) return `${Math.floor(s / 3600)}س`
  return `${Math.floor(s / 86400)}ي`
}

function ctxLabel(n?: number) {
  if (!n) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}K`
  return `${n}`
}

// Everything a hand-rolled overlay has to do to be a dialog: hold focus,
// close on Escape, stop the page behind it scrolling, and put focus back
// where it came from. Missing all four is why this was a keyboard trap.
function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const restoreTo = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab' || !ref.current) return
      const focusable = ref.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
      restoreTo?.focus()
    }
  }, [open, onClose])
  return ref
}

export default function DiscoverPage() {
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const closeModal = useCallback(() => setOpenId(null), [])
  const dialogRef = useDialog(!!openId, closeModal)
  const qc = useQueryClient()
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [importingId, setImportingId] = useState<string | null>(null)

  const stats = useQuery<RegistryStats>({
    queryKey: ['registry-stats'],
    queryFn: () => apiFetch<RegistryStats>('/api/registry/stats'),
    refetchInterval: 60_000,
  })

  const providers = useQuery<ProviderSummary[]>({
    queryKey: ['registry-providers'],
    queryFn: () => apiFetch<ProviderSummary[]>('/api/registry/providers'),
    staleTime: 5 * 60_000,
  })

  const installed = useQuery<{ platform: string }[]>({
    queryKey: ['providers'],
    queryFn: () => apiFetch<{ platform: string }[]>('/api/providers'),
  })
  const installedSet = useMemo(
    () => new Set((installed.data || []).map((p) => p.platform)),
    [installed.data]
  )

  // detail for the open modal
  const detail = useQuery<ProviderDetail>({
    queryKey: ['registry-provider', openId],
    queryFn: () => apiFetch<ProviderDetail>(`/api/registry/providers/${openId}`),
    enabled: !!openId,
  })

  const importMutation = useMutation({
    mutationFn: async (id: string) => {
      setImportingId(id)
      return await apiFetch<{ platform: string; modelCount: number; name: string }>(
        `/api/registry/import/${id}`,
        { method: 'POST', body: JSON.stringify({}) },
      )
    },
    onSuccess: (d) => {
      setToast({ kind: 'ok', text: `تم: ${d.name} (${d.modelCount} نموذج)` })
      qc.invalidateQueries({ queryKey: ['providers'] })
      qc.invalidateQueries({ queryKey: ['models'] })
      setImportingId(null)
      setOpenId(null)
      setTimeout(() => setToast(null), 3000)
    },
    onError: (e: Error) => {
      setToast({ kind: 'err', text: e.message })
      setImportingId(null)
      setTimeout(() => setToast(null), 4000)
    },
  })

  const list = useMemo(() => {
    const all = providers.data || []
    if (!query.trim()) return all
    const q = query.toLowerCase()
    return all.filter((p) => p.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
  }, [providers.data, query])

  const openSummary = useMemo(
    () => (providers.data || []).find((p) => p.id === openId),
    [providers.data, openId]
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="اكتشف مزوّدين"
        description="140 مزوّداً · ~5,140 نموذجاً · كلكة واحدة لإضافة أي واحد منهم"
        icon={<Compass className="size-5" />}
        accent="info"
      />

      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><div className="text-2xl font-bold tabular-nums">{stats.data?.providers ?? '—'}</div><div className="text-xs text-muted-foreground">مزوّد متاح</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-2xl font-bold tabular-nums">{stats.data?.models ?? '—'}</div><div className="text-xs text-muted-foreground">نموذج إجمالاً</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-2xl font-bold tabular-nums">{installedSet.size}</div><div className="text-xs text-muted-foreground">مثبّت عندك</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-2xl font-bold">{formatAge(stats.data?.age_seconds ?? null)}</div><div className="text-xs text-muted-foreground">عمر الفهرس</div></CardContent></Card>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث عن مزوّد بالاسم أو الـ id (مثل: groq, mistral, novita)..."
          className="ps-10"
        />
      </div>

      {toast && (
        <div role="status" aria-live="polite" dir="auto"
            className={`text-sm rounded-md border px-3 py-2 ${toast.kind === 'ok' ? 'bg-success-subtle border-success-border text-success' : 'bg-destructive-subtle border-destructive-border text-destructive'}`}>
          {toast.text}
        </div>
      )}

      {providers.isLoading && <div className="text-center py-12 text-muted-foreground text-sm">جاري تحميل الفهرس…</div>}
      {providers.isError && <div className="text-center py-12 text-destructive-subtle-foreground text-sm"><AlertCircle className="inline size-4 me-2" />تعذّر تحميل الفهرس</div>}

      {/* Providers grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {list.map((p) => {
          const isInstalled = installedSet.has(p.id)
          const isImporting = importingId === p.id
          const canQuickImport = p.is_openai_compat
          return (
            <Card
              key={p.id}
              className="overflow-hidden cursor-pointer hover:border-brand-border transition-colors"
              onClick={() => setOpenId(p.id)}
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground font-mono truncate" dir="ltr">{p.id}</div>
                  </div>
                  {isInstalled && (
                    <Badge variant="outline" className="bg-success-subtle border-success-border text-success-subtle-foreground text-xs"><Check className="size-3 me-1" />مثبّت</Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <Badge variant="outline" className="tabular-nums">{p.model_count} نموذج</Badge>
                  {p.is_openai_compat && <Badge variant="outline" className="bg-brand-subtle border-brand-border text-brand">OpenAI-compatible</Badge>}
                  {p.env[0] && <Badge variant="outline" className="font-mono text-xs" dir="ltr">{p.env[0]}</Badge>}
                </div>
                <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="sm"
                    variant={isInstalled ? 'outline' : 'default'}
                    disabled={isImporting || isInstalled || !canQuickImport}
                    onClick={() => importMutation.mutate(p.id)}
                    className="flex-1"
                    title={!canQuickImport ? 'ليس متوافقاً مع OpenAI تلقائياً' : isInstalled ? 'مضاف بالفعل' : ''}
                  >
                    {isImporting ? <><Loader2 className="size-3.5 me-1.5 animate-spin" />جاري…</>
                      : isInstalled ? <><Check className="size-3.5 me-1.5" />مثبّت</>
                      : <><Plus className="size-3.5 me-1.5" />أضِف</>}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setOpenId(p.id)} title="التفاصيل">
                    التفاصيل
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {!providers.isLoading && list.length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-sm">لا نتائج لـ «{query}»</div>
      )}

      <div className="text-xs text-muted-foreground text-center pt-4 border-t">
        الفهرس مبني على <a href="https://models.dev" target="_blank" rel="noopener noreferrer" className="text-brand-subtle-foreground hover:underline">models.dev</a>
        {' '}— نفس المصدر الذي يستخدمه{' '}
        <a href="https://opencode.ai" target="_blank" rel="noopener noreferrer" className="text-brand-subtle-foreground hover:underline">opencode</a>
      </div>

      {/* ===== Detail modal ===== */}
      {openId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={closeModal}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="discover-modal-title"
            tabIndex={-1}
            className="bg-card border rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden focus:outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            {/* header */}
            <div className="flex items-start justify-between gap-3 p-5 border-b">
              <div className="min-w-0">
                <h2 id="discover-modal-title" className="text-lg font-bold">{openSummary?.name || openId}</h2>
                <div className="text-xs text-muted-foreground font-mono" dir="ltr">{openId}</div>
              </div>
              <button type="button" aria-label="إغلاق" onClick={closeModal} className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/70">
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>

            {/* meta */}
            <div className="px-5 py-3 border-b flex flex-wrap gap-2 text-xs items-center">
              <Badge variant="outline" className="tabular-nums">{detail.data ? Object.keys(detail.data.models).length : openSummary?.model_count} نموذج</Badge>
              {openSummary?.is_openai_compat && <Badge variant="outline" className="bg-brand-subtle border-brand-border text-brand">OpenAI-compatible</Badge>}
              {detail.data?.env?.[0] && <Badge variant="outline" className="font-mono text-xs" dir="ltr">{detail.data.env[0]}</Badge>}
              {detail.data?.doc && (
                <a href={detail.data.doc} target="_blank" rel="noopener noreferrer" className="text-brand-subtle-foreground hover:underline inline-flex items-center gap-1">
                  <BookOpen className="size-3" />الوثائق<ExternalLink className="size-2.5" />
                </a>
              )}
            </div>

            {/* models list */}
            <div className="flex-1 overflow-y-auto p-3">
              {detail.isLoading && <div className="text-center py-8 text-muted-foreground text-sm">جاري التحميل…</div>}
              {detail.data && (
                <div className="space-y-1.5">
                  {Object.values(detail.data.models).map((m) => (
                    <div key={m.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent transition-colors">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{m.name || m.id}</div>
                        <div className="text-xs text-muted-foreground font-mono truncate" dir="ltr">{m.id}</div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-none">
                        {m.reasoning && <span title="reasoning" className="text-info"><Brain className="size-3.5" /></span>}
                        {m.tool_call && <span title="tool-calling" className="text-warn"><Wrench className="size-3.5" /></span>}
                        {m.attachment && <span title="vision" className="text-success"><ImageIcon className="size-3.5" /></span>}
                        {m.open_weights && <span title="open weights" className="text-muted-foreground"><Zap className="size-3.5" /></span>}
                      </div>
                      <div className="text-xs text-muted-foreground tabular-nums flex-none w-12 text-end" dir="ltr">{ctxLabel(m.limit?.context)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* footer / action */}
            <div className="p-4 border-t flex items-center justify-between gap-3">
              <div className="text-xs text-muted-foreground flex items-center gap-3">
                <span className="inline-flex items-center gap-1"><Brain className="size-3 text-info" />تفكير</span>
                <span className="inline-flex items-center gap-1"><Wrench className="size-3 text-warn" />أدوات</span>
                <span className="inline-flex items-center gap-1"><ImageIcon className="size-3 text-success" />رؤية</span>
              </div>
              {installedSet.has(openId) ? (
                <Button variant="outline" disabled><Check className="size-4 me-1.5" />مثبّت بالفعل</Button>
              ) : openSummary?.is_openai_compat ? (
                <Button onClick={() => importMutation.mutate(openId)} disabled={importingId === openId}>
                  {importingId === openId ? <><Loader2 className="size-4 me-1.5 animate-spin" />جاري الإضافة…</> : <><Plus className="size-4 me-1.5" />أضِف كل النماذج</>}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">ليس متوافقاً مع OpenAI — أضفه يدوياً من «المفاتيح»</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
