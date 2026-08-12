import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PageHeader } from '@/components/page-header'
import type { ApiKey, Platform } from '../../../shared/types'
import { tokens } from '@/lib/format'

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: 'google', label: 'Google AI Studio' },
  { value: 'groq', label: 'Groq' },
  { value: 'cerebras', label: 'Cerebras' },
  { value: 'sambanova', label: 'SambaNova' },
  { value: 'nvidia', label: 'NVIDIA NIM' },
  { value: 'mistral', label: 'Mistral' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'github', label: 'GitHub Models' },
  { value: 'cohere', label: 'Cohere' },
  { value: 'cloudflare', label: 'Cloudflare Workers AI' },
  { value: 'zhipu', label: 'Zhipu AI (Z.ai)' },
  { value: 'ollama', label: 'Ollama Cloud' },
  { value: 'kilo', label: 'Kilo Gateway (anon ok)' },
  { value: 'pollinations', label: 'Pollinations (anon ok)' },
  { value: 'llm7', label: 'LLM7 (anon ok)' },
  { value: 'meridian', label: 'Meridian Local (Claude)' },
  { value: 'cliproxyapi', label: 'CLIProxyAPI Local' },
]

const CREDIT_PROVIDER_META: Partial<Record<Platform, { href: string; credit: string; keyHint?: string }>> = {
  google: {
    href: 'https://aistudio.google.com/apikey',
    credit: 'باقة API مجانية',
  },
  groq: {
    href: 'https://console.groq.com/keys',
    credit: 'حدود مجانية للمطوّرين',
  },
  cerebras: {
    href: 'https://cloud.cerebras.ai/platform/',
    credit: 'فئة استدلال مجانية',
  },
  sambanova: {
    href: 'https://cloud.sambanova.ai/apis',
    credit: 'أرصدة سحابية مجانية',
  },
  mistral: {
    href: 'https://console.mistral.ai/api-keys/',
    credit: 'باقة API مجانية',
  },
  openrouter: {
    href: 'https://openrouter.ai/keys',
    credit: 'نماذج وأرصدة مجانية',
  },
  github: {
    href: 'https://github.com/settings/tokens',
    credit: 'استخدام GitHub Models مشمول',
  },
  cohere: {
    href: 'https://dashboard.cohere.com/api-keys',
    credit: 'مفتاح تجريبي',
  },
  cloudflare: {
    href: 'https://dash.cloudflare.com/?to=/:account/workers-ai',
    credit: 'حصة يومية من Workers AI',
    keyHint: 'account_id:token',
  },
  zhipu: {
    href: 'https://bigmodel.cn/usercenter/apikeys',
    credit: 'نماذج Flash مجانية',
  },
  ollama: {
    href: 'https://ollama.com/settings/keys',
    credit: 'خطة سحابية مجانية',
  },
  kilo: {
    href: 'https://kilocode.ai/',
    credit: 'حصة مجانية للبوابة',
  },
}

const statusDot: Record<string, string> = {
  healthy: 'bg-success',
  rate_limited: 'bg-warn',
  invalid: 'bg-destructive',
  error: 'bg-destructive',
  unknown: 'bg-muted-foreground/40',
}

const statusText: Record<string, string> = {
  healthy: 'text-success',
  rate_limited: 'text-warn',
  invalid: 'text-destructive',
  error: 'text-destructive',
  unknown: 'text-muted-foreground',
}

const statusLabel: Record<string, string> = {
  healthy: 'يعمل',
  rate_limited: 'تجاوز حد المعدّل',
  invalid: 'غير صالح',
  error: 'خطأ',
  unknown: 'لم يُفحص',
}

interface HealthPlatform {
  platform: string
  totalKeys: number
  healthyKeys: number
  rateLimitedKeys: number
  invalidKeys: number
  errorKeys: number
  unknownKeys: number
}

interface HealthData {
  platforms: HealthPlatform[]
  keys: { id: number; platform: string; status: string; lastCheckedAt: string | null }[]
}

interface ProviderUsage {
  platform: string
  requests: number
  successCount: number
  inputTokens: number
  outputTokens: number
  usedTokens: number
  budgetTokens: number | null
  remainingTokens: number | null
  usedPercent: number | null
  budgetLabels: string[]
  keyCount: number
  enabledKeyCount: number
  healthyKeyCount: number
}

function platformLabel(platform: string) {
  return PLATFORMS.find(p => p.value === platform)?.label ?? platform
}


const fmtTokens = (n: number | null | undefined) => tokens(n, 'غير معروف')

// Provider usage was five <span> headers over a grid of <div>s: to a screen
// reader that is a flat stream of 30+ unlabelled numbers, with no way to know
// that "45.2M" is the "المتبقّي" column for Groq. It is a real <table> now.
function ProviderUsageSection({ rows }: { rows: ProviderUsage[] }) {
  const visible = rows
    .filter(row => row.keyCount > 0 || row.usedTokens > 0)
    .sort((a, b) => (b.usedTokens - a.usedTokens) || platformLabel(a.platform).localeCompare(platformLabel(b.platform)))

  return (
    <section className="rounded-xl border bg-card card-sheen overflow-hidden">
      <div className="flex items-baseline justify-between px-4 py-3 border-b">
        <h2 className="text-sm font-medium">الاستخدام هذا الشهر</h2>
        <span className="text-xs text-muted-foreground">عدّادات الوكيل المحلي</span>
      </div>
      {visible.length === 0 ? (
        <div className="p-6 text-center">
          <p className="text-sm text-muted-foreground">لا توجد بيانات استخدام بعد.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="ps-4">المزوّد</TableHead>
              <TableHead className="text-end">المُستخدَم</TableHead>
              <TableHead className="text-end">الميزانية</TableHead>
              <TableHead className="text-end">المتبقّي</TableHead>
              <TableHead className="text-end pe-4">الطلبات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map(row => (
              <TableRow key={row.platform}>
                <TableCell className="ps-4 min-w-0">
                  <div className="font-medium truncate">{platformLabel(row.platform)}</div>
                  <div className="text-xs text-success-subtle-foreground tabular-nums">
                    {row.healthyKeyCount}/{row.keyCount} مفاتيح تعمل
                  </div>
                  <div
                    role="progressbar"
                    aria-valuenow={Math.round(row.usedPercent ?? 0)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`استخدام ${platformLabel(row.platform)}`}
                    className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden"
                  >
                    <div className="h-full bg-brand" style={{ width: `${row.usedPercent ?? 0}%` }} />
                  </div>
                </TableCell>
                <TableCell className="text-end tabular-nums">{fmtTokens(row.usedTokens)}</TableCell>
                <TableCell className="text-end tabular-nums text-muted-foreground">{fmtTokens(row.budgetTokens)}</TableCell>
                <TableCell className="text-end tabular-nums text-muted-foreground">{fmtTokens(row.remainingTokens)}</TableCell>
                <TableCell className="text-end pe-4 tabular-nums text-muted-foreground">{row.requests.toLocaleString('ar-EG-u-nu-latn')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}

function ProviderDirectory({ keys }: { keys: ApiKey[] }) {
  const configured = new Set(keys.map(key => key.platform))
  const candidates = PLATFORMS.filter(provider => CREDIT_PROVIDER_META[provider.value])

  return (
    <section className="rounded-xl border bg-card card-sheen overflow-hidden">
      <div className="px-4 py-3 border-b text-sm font-medium">مزوّدون بأرصدة مجانية</div>
      <div className="grid gap-3 grid-cols-1 p-4">
        {candidates.map(provider => {
          const meta = CREDIT_PROVIDER_META[provider.value]
          if (!meta) return null
          const isConfigured = configured.has(provider.value)
          return (
            <div key={provider.value} className="rounded-xl border bg-card p-4 transition-colors hover:border-brand-border">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-medium truncate">{provider.label}</h2>
                  <p className="text-xs text-success-subtle-foreground mt-1">{meta.credit}</p>
                  {meta.keyHint && <code className="block text-xs font-mono text-muted-foreground mt-2">{meta.keyHint}</code>}
                </div>
                <span className={`text-xs rounded-full px-2 py-0.5 ring-1 ${isConfigured ? 'bg-success-subtle text-success-subtle-foreground ring-success-border' : 'bg-muted text-muted-foreground ring-transparent'}`}>
                  {isConfigured ? 'مُضاف' : 'متاح'}
                </span>
              </div>
              <a
                href={meta.href}
                target="_blank"
                rel="noreferrer"
                className="inline-flex mt-4 text-xs font-medium text-brand-subtle-foreground underline underline-offset-4 hover:no-underline"
              >
                احصل على مفتاح
              </a>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function UnifiedKeySection() {
  const queryClient = useQueryClient()
  const [showKey, setShowKey] = useState(false)
  const [copied, setCopied] = useState(false)

  const { data } = useQuery<{ apiKey: string }>({
    queryKey: ['unified-key'],
    queryFn: () => apiFetch('/api/settings/api-key'),
  })

  const regenerate = useMutation({
    mutationFn: () => apiFetch('/api/settings/api-key/regenerate', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['unified-key'] }),
  })

  const apiKey = data?.apiKey ?? ''
  const masked = apiKey ? apiKey.slice(0, 13) + '•'.repeat(32) : '…'
  const baseUrl = import.meta.env.DEV
    ? `http://${window.location.hostname}:${__SERVER_PORT__}/v1`
    : `${window.location.origin}/v1`

  function copy() {
    navigator.clipboard.writeText(apiKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <section className="rounded-xl border border-brand-border bg-brand-subtle card-sheen p-5">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-brand">مفتاح API الموحّد الخاص بك</h2>
          <p className="text-xs text-muted-foreground mt-1">
            استخدمه كقيمة <code className="font-mono text-foreground">api_key</code> في OpenAI؛ فهو يصادق الطلبات الواردة إلى هذا الوكيل.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => regenerate.mutate()}
          disabled={regenerate.isPending}
        >
          إعادة توليد
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <code className="flex-1 font-mono text-xs bg-card border rounded-lg px-3 py-2.5 select-all truncate tabular-nums">
          {showKey ? apiKey : masked}
        </code>
        <Button variant="outline" size="sm" onClick={() => setShowKey(!showKey)}>
          {showKey ? 'إخفاء' : 'إظهار'}
        </Button>
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? 'تم النسخ' : 'نسخ'}
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
        <span className="text-muted-foreground">رابط القاعدة</span>
        <code className="font-mono">{baseUrl}</code>
        <span className="text-muted-foreground">نقطة النهاية</span>
        <code className="font-mono">/v1/chat/completions</code>
      </div>
    </section>
  )
}

// ---- custom (dynamically-added) OpenAI-compatible providers ----------------

interface CustomProvider {
  platform: string
  name: string
  baseUrl: string
  enabled: boolean
  modelCount: number
  keyCount: number
  active: boolean
}

function invalidateProviderQueries(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['custom-providers'] })
  qc.invalidateQueries({ queryKey: ['models'] })
  qc.invalidateQueries({ queryKey: ['fallback'] })
  qc.invalidateQueries({ queryKey: ['provider-usage'] })
}

function CustomProviderRow({ p }: { p: CustomProvider }) {
  const qc = useQueryClient()
  const [url, setUrl] = useState(p.baseUrl)
  const dirty = url.trim() !== p.baseUrl

  const patch = useMutation({
    mutationFn: (baseUrl: string) =>
      apiFetch(`/api/providers/${p.platform}`, { method: 'PATCH', body: JSON.stringify({ baseUrl }) }),
    onSuccess: () => invalidateProviderQueries(qc),
  })
  const del = useMutation({
    mutationFn: () => apiFetch(`/api/providers/${p.platform}`, { method: 'DELETE' }),
    onSuccess: () => invalidateProviderQueries(qc),
  })

  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-sm font-medium">{p.name}</span>
          <span className="ms-2 text-xs text-muted-foreground font-mono">{p.platform}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`inline-flex items-center gap-1 text-xs ${p.active ? 'text-success' : 'text-muted-foreground'}`}>
            <span className={`size-1.5 rounded-full ${p.active ? 'bg-success' : 'bg-muted-foreground/50'}`} />
            {p.active ? 'نشط' : 'متوقف'}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">{p.modelCount} نموذج · {p.keyCount} مفتاح</span>
          <Button variant="ghost" size="xs" className="text-destructive"
            onClick={() => { if (confirm(`حذف المزوّد "${p.name}"؟ هيتشال هو وموديلاته ومفاتيحه.`)) del.mutate() }}>
            حذف
          </Button>
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Input value={url} onChange={e => setUrl(e.target.value)} dir="ltr" className="font-mono text-xs"
          placeholder="http://192.168.1.50:11434/v1" />
        <Button size="sm" disabled={!dirty || patch.isPending} onClick={() => patch.mutate(url.trim())}>
          {patch.isPending ? 'جارٍ…' : 'حفظ الرابط'}
        </Button>
      </div>
    </div>
  )
}

function CustomProviders() {
  const qc = useQueryClient()
  const { data: providers = [] } = useQuery<CustomProvider[]>({
    queryKey: ['custom-providers'],
    queryFn: () => apiFetch('/api/providers'),
  })
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [baseUrl, setBaseUrl] = useState('')

  const add = useMutation({
    mutationFn: () =>
      apiFetch('/api/providers', { method: 'POST', body: JSON.stringify({ platform: slug.trim(), name: name.trim(), baseUrl: baseUrl.trim() }) }),
    onSuccess: () => { setName(''); setSlug(''); setBaseUrl(''); invalidateProviderQueries(qc) },
  })

  const canAdd = name.trim() && /^[a-z0-9][a-z0-9-]{1,29}$/.test(slug.trim()) && /^https?:\/\//.test(baseUrl.trim())

  return (
    <section className="rounded-xl border bg-card card-sheen overflow-hidden">
      <div className="px-4 py-3 border-b flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">مزوّدون مخصّصون</h2>
        <span className="text-xs text-muted-foreground">أي خدمة متوافقة مع OpenAI (Ollama محلي، vLLM، LM Studio…)</span>
      </div>
      <div className="p-4 space-y-3">
        {providers.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-2">لا مزوّدون مخصّصون بعد. أضِف واحداً بالأسفل.</p>
        ) : (
          providers.map(p => <CustomProviderRow key={p.platform} p={p} />)
        )}

        <div className="rounded-lg border border-dashed p-3 space-y-2">
          <p className="text-xs text-muted-foreground">إضافة مزوّد جديد</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <Label htmlFor="provider-name" className="text-xs text-muted-foreground">الاسم</Label>
              <Input id="provider-name" value={name} onChange={e => setName(e.target.value)} className="mt-1" placeholder="Ollama المحلي" />
            </div>
            <div>
              <Label htmlFor="provider-slug" className="text-xs text-muted-foreground">المعرّف (slug)</Label>
              <Input id="provider-slug" value={slug} onChange={e => setSlug(e.target.value)} dir="ltr" className="mt-1 font-mono text-xs" placeholder="ollama-local" />
            </div>
          </div>
          <div>
            <Label htmlFor="provider-base-url" className="text-xs text-muted-foreground">رابط القاعدة (Base URL)</Label>
            <Input id="provider-base-url" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} dir="ltr" className="mt-1 font-mono text-xs" placeholder="http://192.168.1.50:11434/v1" />
          </div>
          {add.isError && <p className="text-[12px] text-destructive">{(add.error as any)?.message ?? 'فشل الإضافة'}</p>}
          <div className="flex justify-end">
            <Button size="sm" disabled={!canAdd || add.isPending} onClick={() => add.mutate()}>
              {add.isPending ? 'جارٍ الإضافة…' : 'إضافة المزوّد'}
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}

export default function KeysPage() {
  const queryClient = useQueryClient()
  const [platform, setPlatform] = useState<Platform | ''>('')
  const [apiKey, setApiKey] = useState('')
  const [accountId, setAccountId] = useState('')
  const [label, setLabel] = useState('')

  const { data: keys = [], isLoading } = useQuery<ApiKey[]>({
    queryKey: ['keys'],
    queryFn: () => apiFetch('/api/keys'),
  })

  const { data: healthData } = useQuery<HealthData>({
    queryKey: ['health'],
    queryFn: () => apiFetch('/api/health'),
    refetchInterval: 30000,
  })

  const { data: providerUsage = [] } = useQuery<ProviderUsage[]>({
    queryKey: ['provider-usage'],
    queryFn: () => apiFetch('/api/analytics/provider-usage'),
    refetchInterval: 30000,
  })

  const addKey = useMutation({
    mutationFn: (body: { platform: string; key: string; label?: string }) =>
      apiFetch('/api/keys', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['fallback'] })
      queryClient.invalidateQueries({ queryKey: ['provider-usage'] })
      setPlatform('')
      setApiKey('')
      setAccountId('')
      setLabel('')
    },
  })

  const deleteKey = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['provider-usage'] })
    },
  })

  const checkAll = useMutation({
    mutationFn: () => apiFetch('/api/health/check-all', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      queryClient.invalidateQueries({ queryKey: ['provider-usage'] })
    },
  })

  const checkKey = useMutation({
    mutationFn: (keyId: number) => apiFetch(`/api/health/check/${keyId}`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['health'] })
      queryClient.invalidateQueries({ queryKey: ['keys'] })
      queryClient.invalidateQueries({ queryKey: ['provider-usage'] })
    },
  })

  const needsAccountId = platform === 'cloudflare'

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!platform || !apiKey) return
    if (needsAccountId && !accountId) return
    const key = needsAccountId ? `${accountId}:${apiKey}` : apiKey
    addKey.mutate({ platform, key, label: label || undefined })
  }

  const healthKeyMap = new Map<number, { status: string; lastCheckedAt: string | null }>()
  for (const k of healthData?.keys ?? []) healthKeyMap.set(k.id, k)

  const grouped = PLATFORMS.map(p => ({
    ...p,
    keys: keys.filter(k => k.platform === p.value),
  })).filter(p => p.keys.length > 0)

  return (
    <div>
      <PageHeader
        title="المفاتيح"
        description="بيانات اعتماد المزوّدين ومفتاح API الموحّد الذي تتصل به تطبيقاتك."
        accent="success"
        icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>}
        actions={
          keys.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => checkAll.mutate()} disabled={checkAll.isPending}>
              {checkAll.isPending ? 'جارٍ الفحص…' : 'فحص الكل'}
            </Button>
          )
        }
      />

      <div className="space-y-6">
        <UnifiedKeySection />

        <CustomProviders />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <ProviderUsageSection rows={providerUsage} />

            <section className="rounded-xl border bg-card card-sheen overflow-hidden">
          <div className="px-4 py-3 border-b text-sm font-medium">المزوّدون المُعدّون</div>
          <div className="p-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">جارٍ التحميل…</p>
          ) : keys.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">
                لا توجد مفاتيح مزوّدين بعد. أضف واحدًا أعلاه لبدء التوجيه.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {grouped.map(group => (
                <div key={group.value}>
                  <div className="flex items-baseline justify-between mb-2">
                    <h2 className="text-sm font-medium">{group.label}</h2>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {group.keys.length} {group.keys.length === 1 ? 'مفتاح' : 'مفاتيح'}
                    </span>
                  </div>
                  <div className="rounded-lg border divide-y bg-background overflow-hidden">
                    {group.keys.map(k => {
                      const h = healthKeyMap.get(k.id)
                      const status = h?.status ?? k.status
                      const lastChecked = h?.lastCheckedAt
                      return (
                        <div key={k.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors">
                          <span className={`size-1.5 rounded-full flex-shrink-0 ${statusDot[status] ?? statusDot.unknown}`} />
                          <code className="text-xs font-mono flex-shrink-0">{k.maskedKey}</code>
                          {k.label && <span className="text-xs text-muted-foreground">{k.label}</span>}
                          <span className={`text-xs font-medium ${statusText[status] ?? statusText.unknown}`}>{statusLabel[status] ?? status}</span>
                          <div className="flex-1" />
                          {lastChecked && (
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {new Date(lastChecked).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                          <Button variant="ghost" size="xs" onClick={() => checkKey.mutate(k.id)} disabled={checkKey.isPending}>
                            اختبار
                          </Button>
                          <Button variant="ghost" size="xs" className="text-muted-foreground hover:text-destructive" onClick={() => deleteKey.mutate(k.id)} disabled={deleteKey.isPending}>
                            حذف
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          </div>
            </section>
          </div>

          <div className="lg:col-span-1 space-y-4 lg:sticky lg:top-20 self-start">
            <section className="rounded-xl border bg-card card-sheen overflow-hidden">
          <div className="px-4 py-3 border-b text-sm font-medium">إضافة مفتاح مزوّد</div>
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 p-4">
            <div className="space-y-1.5">
              <Label id="key-platform-label" className="text-xs text-muted-foreground">المنصّة</Label>
              <Select value={platform} onValueChange={(v) => setPlatform(v as Platform)}>
                <SelectTrigger aria-labelledby="key-platform-label" className="w-[220px]">
                  <SelectValue placeholder="اختر المزوّد" />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORMS.map(p => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {needsAccountId && (
              <div className="space-y-1.5">
                <Label htmlFor="key-account-id" className="text-xs text-muted-foreground">معرّف الحساب</Label>
                <Input
                  id="key-account-id"
                  value={accountId}
                  onChange={e => setAccountId(e.target.value)}
                  placeholder="a1b2c3d4…"
                  className="w-[200px] font-mono text-xs"
                />
              </div>
            )}
            <div className="space-y-1.5 flex-1 min-w-[240px]">
              <Label htmlFor="key-api" className="text-xs text-muted-foreground">{needsAccountId ? 'توكن API' : 'مفتاح API'}</Label>
              <Input
                id="key-api"
                autoComplete="off"
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={needsAccountId ? 'توكن Bearer' : 'الصق مفتاحك هنا'}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="key-label" className="text-xs text-muted-foreground">التسمية</Label>
              <Input
                id="key-label"
                value={label}
                onChange={e => setLabel(e.target.value)}
                placeholder="اختياري"
                className="w-[160px]"
              />
            </div>
            <Button type="submit" size="sm" disabled={!platform || !apiKey || (needsAccountId && !accountId) || addKey.isPending}>
              {addKey.isPending ? 'جارٍ الإضافة…' : 'إضافة مفتاح'}
            </Button>
          </form>
          {addKey.isError && (
            <p className="text-destructive-subtle-foreground text-xs px-4 pb-4 -mt-1">{(addKey.error as Error).message}</p>
          )}
            </section>

            <ProviderDirectory keys={keys} />
          </div>
        </div>
      </div>
    </div>
  )
}
