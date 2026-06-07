import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { apiFetch } from '@/lib/api'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PageHeader } from '@/components/page-header'
import { Logo } from '@/components/logo'
import { Button } from '@/components/ui/button'

// ---- shapes ---------------------------------------------------------------

interface ModelRow {
  platform: string
  modelId: string
  displayName: string
  rpmLimit: number | null
  rpdLimit: number | null
  contextWindow: number | null
  keyCount: number
  hasProvider: boolean
  intelligenceRank: number | null
  paidEquivalent: { input: number; output: number }
}

interface Summary {
  estimatedCostSavings?: string | number
  totalRequests?: number
  totalInputTokens?: number
  totalOutputTokens?: number
}

// Display names for providers (proper nouns stay Latin; locals tagged عربي).
const PROVIDER_NAMES: Record<string, string> = {
  groq: 'Groq',
  cerebras: 'Cerebras',
  sambanova: 'SambaNova',
  nvidia: 'NVIDIA NIM',
  mistral: 'Mistral',
  openrouter: 'OpenRouter',
  github: 'GitHub Models',
  cohere: 'Cohere',
  cloudflare: 'Cloudflare',
  zhipu: 'Zhipu AI',
  ollama: 'Ollama Cloud',
  kilo: 'Kilo Gateway',
  pollinations: 'Pollinations',
  llm7: 'LLM7',
  google: 'Google Gemini',
  meridian: 'Meridian (محلي)',
  cliproxyapi: 'CLIProxyAPI (محلي)',
}

// ---- helpers --------------------------------------------------------------

function fmt(n?: number | null): string {
  if (!n) return '0'
  return n.toLocaleString('en-US')
}

function fmtCtx(n?: number | null): string {
  if (!n) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${Math.round(n / 1000)}K`
  return String(n)
}

function money(n: number): string {
  if (n >= 100) return `$${n.toFixed(0)}`
  return `$${n.toFixed(2)}`
}

// ---- small UI primitives --------------------------------------------------

function BigStat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-lg border bg-card card-sheen px-4 py-4 transition-colors hover:border-brand/40">
      <p className="text-[11px] text-muted-foreground tracking-wider">{label}</p>
      <p className={`text-3xl font-bold tabular-nums mt-1.5 ${accent ?? ''}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
    </div>
  )
}

function Panel({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="px-4 py-3 border-b flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium">{title}</h3>
        {note && <span className="text-[11px] text-muted-foreground">{note}</span>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

const axisStyle = { fontSize: 11, fill: 'var(--muted-foreground)' } as const

// ---- page -----------------------------------------------------------------

// Inline single-shot playground: send one prompt, show the answer + which
// provider/model actually served it. Reuses the proxy the way the full
// Playground does, but with no chat history. `model` is controlled by the
// parent so the providers-table "جرّب" buttons can preselect a provider.
interface TryResult { content: string; platform?: string; model?: string; latency?: number }

function QuickTry({ model, modelLabel, apiKey, onResetAuto, inputRef }: {
  model: string
  modelLabel: string
  apiKey?: string
  onResetAuto: () => void
  inputRef: React.RefObject<HTMLInputElement | null>
}) {
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<TryResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const send = async () => {
    const text = prompt.trim()
    if (!text || loading) return
    setLoading(true); setError(null); setResult(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
      const body: any = { messages: [{ role: 'user', content: text }] }
      if (model !== 'auto') body.model = model
      const base = import.meta.env.BASE_URL.replace(/\/$/, '')
      const start = Date.now()
      const res = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) })
      const latency = Date.now() - start
      const routedVia = res.headers.get('X-Routed-Via')
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        setError(e?.error?.message ?? `HTTP ${res.status}`)
        return
      }
      const data = await res.json()
      const content = data.choices?.[0]?.message?.content ?? JSON.stringify(data)
      const via = data._routed_via ?? (routedVia ? { platform: routedVia.split('/')[0], model: routedVia.split('/').slice(1).join('/') } : undefined)
      setResult({ content, platform: via?.platform, model: via?.model, latency })
    } catch (e: any) {
      setError(e?.message ?? 'خطأ غير معروف')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border bg-card card-sheen p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <span className="inline-flex size-6 items-center justify-center rounded-lg bg-brand/10 text-brand ring-1 ring-brand/25">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </span>
          جرّب زاد الآن
        </h3>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          النموذج:
          {model === 'auto' ? (
            <span className="text-foreground">تلقائي</span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md border border-brand/30 bg-brand/10 px-1.5 py-0.5 text-brand font-medium">
              {modelLabel}
              <button onClick={onResetAuto} title="رجوع للتلقائي" className="hover:text-foreground">✕</button>
            </span>
          )}
        </span>
      </div>

      <div className="mt-3 flex gap-2 items-center rounded-xl border bg-background p-1.5 transition-colors focus-within:border-brand/40 focus-within:ring-2 focus-within:ring-brand/15">
        <input
          ref={inputRef}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send() } }}
          placeholder="اكتب سؤالاً سريعاً وجرّب… (⏎ للإرسال)"
          className="flex-1 bg-transparent px-2 py-1.5 text-sm focus:outline-none"
        />
        <Button onClick={send} disabled={loading || !prompt.trim()} className="bg-brand text-white hover:bg-brand/90">
          {loading ? 'جارٍ…' : 'إرسال'}
        </Button>
      </div>

      {(loading || error || result) && (
        <div className="mt-3 rounded-lg border bg-background p-3 text-sm">
          {loading && (
            <div className="flex gap-1 py-1">
              <span className="size-1.5 rounded-full bg-brand/60 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="size-1.5 rounded-full bg-brand/60 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="size-1.5 rounded-full bg-brand/60 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          )}
          {error && <p className="text-destructive">خطأ: {error}</p>}
          {result && (
            <>
              <div className="whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto">{result.content}</div>
              <div className="mt-2 pt-2 border-t flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground tabular-nums">
                <span className="inline-flex items-center gap-1 text-success"><span className="size-1.5 rounded-full bg-success" />خدمه</span>
                {result.platform && <span className="text-foreground">{result.platform}</span>}
                {result.model && <span className="font-mono">· {result.model}</span>}
                {result.latency != null && <span>· {result.latency} مللي ثانية</span>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function OverviewPage() {
  const { data: models = [], isLoading } = useQuery({
    queryKey: ['models'],
    queryFn: () => apiFetch<ModelRow[]>(`/api/models`),
  })

  const { data: keyData } = useQuery<{ apiKey: string }>({
    queryKey: ['unified-key'],
    queryFn: () => apiFetch('/api/settings/api-key'),
  })

  const [tryModel, setTryModel] = useState('auto')
  const tryRef = useRef<HTMLDivElement>(null)
  const tryInputRef = useRef<HTMLInputElement>(null)

  // "جرّب" from a provider row: preselect that provider's first model, scroll up, focus.
  const tryProvider = (platform: string) => {
    const m = models.find(x => x.platform === platform)
    setTryModel(m?.modelId ?? 'auto')
    tryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => tryInputRef.current?.focus(), 300)
  }

  const tryModelLabel = tryModel === 'auto'
    ? 'تلقائي'
    : models.find(m => m.modelId === tryModel)?.displayName ?? tryModel

  const { data: summary } = useQuery({
    queryKey: ['analytics', 'summary', '30d'],
    queryFn: () => apiFetch<Summary>(`/api/analytics/summary?range=30d`),
  })

  const { data: pricingMeta } = useQuery({
    queryKey: ['models', 'pricing-meta'],
    queryFn: () => apiFetch<{ source: string; updatedAt: string | null; matchedModels: number; totalModels: number }>(`/api/models/pricing-meta`),
  })

  const stats = useMemo(() => {
    const byPlatform = new Map<string, {
      platform: string
      models: number
      rpd: number
      rpm: number
      maxCtx: number
      keyCount: number
      paidIn: number
      paidOut: number
    }>()

    for (const m of models) {
      const p = byPlatform.get(m.platform) ?? {
        platform: m.platform, models: 0, rpd: 0, rpm: 0, maxCtx: 0, keyCount: m.keyCount,
        paidIn: 0, paidOut: 0,
      }
      p.models += 1
      p.rpd += m.rpdLimit ?? 0
      p.rpm += m.rpmLimit ?? 0
      p.maxCtx = Math.max(p.maxCtx, m.contextWindow ?? 0)
      p.paidIn += m.paidEquivalent?.input ?? 0
      p.paidOut += m.paidEquivalent?.output ?? 0
      byPlatform.set(m.platform, p)
    }

    const providers = Array.from(byPlatform.values())
      .map(p => ({
        ...p,
        // blended $/1M (input+output) averaged across the provider's models
        paidBlended: p.models ? (p.paidIn + p.paidOut) / p.models : 0,
      }))
      .sort((a, b) => b.models - a.models)

    const totalModels = models.length
    const totalProviders = providers.length
    const totalRpd = providers.reduce((s, p) => s + p.rpd, 0)
    const maxCtx = providers.reduce((s, p) => Math.max(s, p.maxCtx), 0)
    const activeProviders = providers.filter(p => p.keyCount > 0 || ['pollinations', 'llm7', 'kilo'].includes(p.platform)).length

    // Blended paid price across ALL models: what 1M input + 1M output would cost
    const totalPaidIn = models.reduce((s, m) => s + (m.paidEquivalent?.input ?? 0), 0)
    const totalPaidOut = models.reduce((s, m) => s + (m.paidEquivalent?.output ?? 0), 0)
    const blendedInput = totalModels ? totalPaidIn / totalModels : 0
    const blendedOutput = totalModels ? totalPaidOut / totalModels : 0
    const blendedPerMillion = blendedInput + blendedOutput

    return { providers, totalModels, totalProviders, totalRpd, maxCtx, activeProviders, blendedInput, blendedOutput, blendedPerMillion }
  }, [models])

  const savings = Number(summary?.estimatedCostSavings ?? 0)

  if (isLoading) {
    return (
      <div>
        <PageHeader title="نظرة عامة" description="كل النماذج هنا مجانية بالكامل — الأرقام دي بتوضّح حجم اللي بتاخده مجاناً وكام كان هيتكلّف لو مدفوع." />
        <p className="text-sm text-muted-foreground text-center py-16">جارٍ تحميل البيانات…</p>
      </div>
    )
  }

  return (
    <div>
      {/* Branded hero */}
      <div className="hero-glow mb-8 pb-8 border-b">
        <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-[11px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
          مفتوح المصدر · بدون بطاقة دفع
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Logo size={44} />
          <h1 className="text-4xl font-bold tracking-tight">زاد</h1>
        </div>
        <p className="mt-3 max-w-2xl text-lg text-muted-foreground leading-relaxed">
<span className="text-brand-gradient font-semibold">زادك</span> من نماذج الذكاء الاصطناعي المجانية في واجهة واحدة متوافقة مع OpenAI —
          مع تحويل احتياطي تلقائي، تحليلات حيّة، وتوفير حقيقي مقابل الواجهات المدفوعة.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Hero numbers — each tile is its own bento cell */}
        <div className="col-span-6 sm:col-span-4 lg:col-span-2">
          <BigStat label="نماذج مجانية" value={fmt(stats.totalModels)} sub="كلها بسعر $0" accent="text-emerald-600 dark:text-emerald-400" />
        </div>
        <div className="col-span-6 sm:col-span-4 lg:col-span-2">
          <BigStat label="مزوّدون" value={fmt(stats.totalProviders)} sub={`${stats.activeProviders} نشط الآن`} />
        </div>
        <div className="col-span-6 sm:col-span-4 lg:col-span-2">
          <BigStat label="التكلفة الشهرية" value="$0" sub="بدون بطاقة دفع" accent="text-emerald-600 dark:text-emerald-400" />
        </div>
        <div className="col-span-6 sm:col-span-4 lg:col-span-2">
          <BigStat label="التوفير (آخر 30 يوم)" value={money(savings)} sub="مقابل واجهات مدفوعة مكافئة" accent="text-emerald-600 dark:text-emerald-400" />
        </div>
        <div className="col-span-6 sm:col-span-4 lg:col-span-2">
          <BigStat label="طاقة الطلبات اليومية" value={fmt(stats.totalRpd)} sub="طلب/يوم (الحدود المعلومة)" />
        </div>
        <div className="col-span-6 sm:col-span-4 lg:col-span-2">
          <BigStat label="أقصى نافذة سياق" value={fmtCtx(stats.maxCtx)} sub="توكن في الطلب الواحد" />
        </div>

        {/* Quick-try widget — interactive single-shot playground */}
        <div className="lg:col-span-12" ref={tryRef}>
          <QuickTry model={tryModel} modelLabel={tryModelLabel} apiKey={keyData?.apiKey} onResetAuto={() => setTryModel('auto')} inputRef={tryInputRef} />
        </div>

        {/* Free vs Paid compare — side by side bento cells */}
        <div className="lg:col-span-6">
          <div className="rounded-xl border-2 border-emerald-500/40 bg-emerald-500/5 card-sheen p-5 h-full">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">المجاني — اللي بتدفعه فعلاً</h3>
              <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">$0</span>
            </div>
            <ul className="mt-3 space-y-1.5 text-sm">
              <li className="flex justify-between border-b border-emerald-500/15 pb-1.5"><span className="text-muted-foreground">عدد النماذج</span><span className="tabular-nums font-medium">{fmt(stats.totalModels)}</span></li>
              <li className="flex justify-between border-b border-emerald-500/15 pb-1.5"><span className="text-muted-foreground">سعر مليون توكن (دخل)</span><span className="tabular-nums font-medium">$0</span></li>
              <li className="flex justify-between border-b border-emerald-500/15 pb-1.5"><span className="text-muted-foreground">سعر مليون توكن (خرج)</span><span className="tabular-nums font-medium">$0</span></li>
              <li className="flex justify-between"><span className="text-muted-foreground">بطاقة دفع مطلوبة</span><span className="font-medium">لا</span></li>
            </ul>
          </div>
        </div>

        <div className="lg:col-span-6">
          <div className="rounded-xl border bg-card card-sheen p-5 h-full">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">المدفوع — اللي كان هيتكلّف</h3>
              <span className="text-2xl font-bold tabular-nums">{money(stats.blendedPerMillion)}</span>
            </div>
            <ul className="mt-3 space-y-1.5 text-sm">
              <li className="flex justify-between border-b pb-1.5"><span className="text-muted-foreground">متوسط نموذج مكافئ</span><span className="tabular-nums font-medium">{stats.totalModels} نموذج</span></li>
              <li className="flex justify-between border-b pb-1.5"><span className="text-muted-foreground">سعر مليون توكن (دخل)</span><span className="tabular-nums font-medium">{money(stats.blendedInput)}</span></li>
              <li className="flex justify-between border-b pb-1.5"><span className="text-muted-foreground">سعر مليون توكن (خرج)</span><span className="tabular-nums font-medium">{money(stats.blendedOutput)}</span></li>
              <li className="flex justify-between"><span className="text-muted-foreground">بطاقة دفع مطلوبة</span><span className="font-medium">نعم</span></li>
            </ul>
            <p className="text-[11px] text-muted-foreground mt-3">
              {pricingMeta && pricingMeta.matchedModels > 0 ? (
                <>الأسعار الحقيقية من جدول LiteLLM — مطابقة {pricingMeta.matchedModels}/{pricingMeta.totalModels} نموذج{pricingMeta.updatedAt ? ` · آخر تحديث ${new Date(pricingMeta.updatedAt).toLocaleDateString('ar-EG')}` : ''}. الباقي تقديري حسب الفئة.</>
              ) : (
                <>الأسعار تقديرية لنماذج مدفوعة بجودة مماثلة (USD لكل مليون توكن)، مش أسعار رسمية مضبوطة.</>
              )}
            </p>
          </div>
        </div>

        {/* Models per provider chart */}
        <div className="lg:col-span-8">
          <Panel title="عدد النماذج المجانية لكل مزوّد">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={stats.providers} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" />
                <XAxis dataKey="platform" tick={axisStyle} tickLine={false} axisLine={{ stroke: 'var(--border)' }} angle={-35} textAnchor="end" height={56} interval={0} />
                <YAxis tick={axisStyle} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="models" name="نماذج" fill="var(--brand)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        </div>

        {/* Top providers companion card */}
        <div className="lg:col-span-4">
          <Panel title="أعلى المزوّدين" note="الأكثر نماذجاً">
            <ul className="space-y-3">
              {stats.providers.slice(0, 3).map((p, i) => {
                const max = stats.providers[0]?.models || 1
                const pct = Math.round((p.models / max) * 100)
                return (
                  <li key={p.platform}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium truncate">
                        <span className="text-muted-foreground font-mono text-[11px] me-1.5">{i + 1}.</span>
                        {PROVIDER_NAMES[p.platform] ?? p.platform}
                      </span>
                      <span className="text-sm font-bold tabular-nums text-brand">{fmt(p.models)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                )
              })}
            </ul>
          </Panel>
        </div>

        {/* Per-provider table */}
        <div className="lg:col-span-12">
        <Panel title="تفاصيل المزوّدين" note="الحدود المجانية مقابل السعر المدفوع المكافئ">
          <div className="overflow-x-auto -mx-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="ps-4">المزوّد</TableHead>
                  <TableHead className="text-center">نماذج</TableHead>
                  <TableHead className="text-center">حد/دقيقة</TableHead>
                  <TableHead className="text-center">حد/يوم</TableHead>
                  <TableHead className="text-center">أقصى سياق</TableHead>
                  <TableHead className="text-center">سعر مدفوع مكافئ</TableHead>
                  <TableHead className="text-center">الحالة</TableHead>
                  <TableHead className="text-center pe-4">تجربة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.providers.map(p => {
                  const anonymous = ['pollinations', 'llm7', 'kilo'].includes(p.platform)
                  const active = p.keyCount > 0 || anonymous
                  return (
                    <TableRow key={p.platform}>
                      <TableCell className="ps-4 text-sm font-medium">
                        {PROVIDER_NAMES[p.platform] ?? p.platform}
                        <span className="block text-[11px] text-muted-foreground font-mono">{p.platform}</span>
                      </TableCell>
                      <TableCell className="text-center tabular-nums">{p.models}</TableCell>
                      <TableCell className="text-center tabular-nums">{p.rpm ? fmt(p.rpm) : '—'}</TableCell>
                      <TableCell className="text-center tabular-nums">{p.rpd ? fmt(p.rpd) : '—'}</TableCell>
                      <TableCell className="text-center tabular-nums">{fmtCtx(p.maxCtx)}</TableCell>
                      <TableCell className="text-center tabular-nums">{money(p.paidBlended)}<span className="text-[11px] text-muted-foreground">/م</span></TableCell>
                      <TableCell className="text-center">
                        {active ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                            <span className="size-1.5 rounded-full bg-emerald-500" />{anonymous ? 'مجهول' : 'نشط'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                            <span className="size-1.5 rounded-full bg-muted-foreground/50" />يحتاج مفتاح
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-center pe-4">
                        <Button
                          variant="outline" size="xs"
                          disabled={!active}
                          title={active ? 'جرّب هذا المزوّد في الأعلى' : 'أضف مفتاحاً أولاً من صفحة المفاتيح'}
                          onClick={() => tryProvider(p.platform)}
                        >
                          جرّب
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">
            «—» في الحدود معناه إن المزوّد بيحسب الاستهلاك بطريقة تانية (وقت GPU أو حصة شهرية) مش بعدد الطلبات. «مجهول» = يشتغل بدون مفتاح، «يحتاج مفتاح» = أضف مفتاحاً من صفحة المفاتيح لتفعيله.
          </p>
        </Panel>
        </div>
      </div>
    </div>
  )
}
