import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Compass, Plus, Search, BookOpen, Check, Loader2, AlertCircle } from 'lucide-react'

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

export default function DiscoverPage() {
  const [query, setQuery] = useState('')
  const qc = useQueryClient()
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [importingId, setImportingId] = useState<string | null>(null)

  const stats = useQuery<RegistryStats>({
    queryKey: ['registry-stats'],
    queryFn: () => fetch('/api/registry/stats').then((r) => r.json()),
    refetchInterval: 60_000,
  })

  const providers = useQuery<ProviderSummary[]>({
    queryKey: ['registry-providers'],
    queryFn: () => fetch('/api/registry/providers').then((r) => r.json()),
    staleTime: 5 * 60_000,
  })

  // which platforms are already installed locally? (mark them with a check)
  const installed = useQuery<{ platform: string }[]>({
    queryKey: ['providers'],
    queryFn: () => fetch('/api/providers').then((r) => r.json()),
  })
  const installedSet = useMemo(
    () => new Set((installed.data || []).map((p) => p.platform)),
    [installed.data]
  )

  const importMutation = useMutation({
    mutationFn: async (id: string) => {
      setImportingId(id)
      const res = await fetch(`/api/registry/import/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error?.message || 'فشل الاستيراد')
      return body as { platform: string; modelCount: number; name: string }
    },
    onSuccess: (d) => {
      setToast({ kind: 'ok', text: `تم: ${d.name} (${d.modelCount} نموذج)` })
      qc.invalidateQueries({ queryKey: ['providers'] })
      qc.invalidateQueries({ queryKey: ['models'] })
      setImportingId(null)
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
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold tabular-nums">{stats.data?.providers ?? '—'}</div>
            <div className="text-xs text-muted-foreground">مزوّد متاح</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold tabular-nums">{stats.data?.models ?? '—'}</div>
            <div className="text-xs text-muted-foreground">نموذج إجمالاً</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold tabular-nums">{installedSet.size}</div>
            <div className="text-xs text-muted-foreground">مثبّت عندك</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold">{formatAge(stats.data?.age_seconds ?? null)}</div>
            <div className="text-xs text-muted-foreground">عمر الفهرس</div>
          </CardContent>
        </Card>
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

      {/* Toast */}
      {toast && (
        <div
          className={`text-sm rounded-md border px-3 py-2 ${
            toast.kind === 'ok'
              ? 'bg-success/10 border-success/30 text-success'
              : 'bg-destructive/10 border-destructive/30 text-destructive'
          }`}
        >
          {toast.text}
        </div>
      )}

      {/* Providers grid */}
      {providers.isLoading && (
        <div className="text-center py-12 text-muted-foreground text-sm">جاري تحميل الفهرس…</div>
      )}
      {providers.isError && (
        <div className="text-center py-12 text-destructive text-sm">
          <AlertCircle className="inline size-4 me-2" />
          تعذّر تحميل الفهرس
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {list.map((p) => {
          const isInstalled = installedSet.has(p.id)
          const isImporting = importingId === p.id
          const canQuickImport = p.is_openai_compat
          return (
            <Card key={p.id} className="overflow-hidden">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground font-mono truncate" dir="ltr">
                      {p.id}
                    </div>
                  </div>
                  {isInstalled && (
                    <Badge variant="outline" className="bg-success/10 border-success/30 text-success text-[10px]">
                      <Check className="size-3 me-1" />
                      مثبّت
                    </Badge>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  <Badge variant="outline" className="tabular-nums">
                    {p.model_count} نموذج
                  </Badge>
                  {p.is_openai_compat && (
                    <Badge variant="outline" className="bg-brand/10 border-brand/30 text-brand">
                      OpenAI-compatible
                    </Badge>
                  )}
                  {p.env[0] && (
                    <Badge variant="outline" className="font-mono text-[10px]" dir="ltr">
                      {p.env[0]}
                    </Badge>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={isInstalled ? 'outline' : 'default'}
                    disabled={isImporting || isInstalled || !canQuickImport}
                    onClick={() => importMutation.mutate(p.id)}
                    className="flex-1"
                    title={
                      !canQuickImport
                        ? 'هذا المزوّد ليس متوافقاً مع OpenAI تلقائياً — أضفه يدوياً'
                        : isInstalled
                          ? 'مضاف بالفعل'
                          : ''
                    }
                  >
                    {isImporting ? (
                      <>
                        <Loader2 className="size-3.5 me-1.5 animate-spin" />
                        جاري…
                      </>
                    ) : isInstalled ? (
                      <>
                        <Check className="size-3.5 me-1.5" />
                        مثبّت
                      </>
                    ) : (
                      <>
                        <Plus className="size-3.5 me-1.5" />
                        أضِف
                      </>
                    )}
                  </Button>
                  {p.doc && (
                    <a
                      href={p.doc}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="الوثائق"
                      className="inline-flex items-center justify-center rounded-md h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    >
                      <BookOpen className="size-3.5" />
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {!providers.isLoading && list.length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          لا نتائج لـ «{query}»
        </div>
      )}

      <div className="text-xs text-muted-foreground text-center pt-4 border-t">
        الفهرس مبني على <a href="https://models.dev" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">models.dev</a>
        {' '}— نفس المصدر الذي يستخدمه{' '}
        <a href="https://opencode.ai" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">opencode</a>
      </div>
    </div>
  )
}
