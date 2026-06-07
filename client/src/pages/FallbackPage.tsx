import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { PageHeader } from '@/components/page-header'

interface FallbackEntry {
  modelDbId: number
  priority: number
  effectivePriority: number
  penalty: number
  rateLimitHits: number
  enabled: boolean
  platform: string
  modelId: string
  displayName: string
  intelligenceRank: number
  speedRank: number
  sizeLabel: string
  rpmLimit: number | null
  rpdLimit: number | null
  monthlyTokenBudget: string
  contextWindow: number | null
  inputModalities: string[]
  outputModalities: string[]
  capabilities: {
    text: boolean | 'unknown'
    toolCalling: boolean | 'unknown'
    imageInput: boolean | 'unknown'
    imageOutput: boolean | 'unknown'
    audioInput: boolean | 'unknown'
    audioOutput: boolean | 'unknown'
  }
  features: string[]
  budgetExhausted?: boolean
  keyCount: number
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatContextWindow(n: number | null): string {
  if (!n) return 'ctx ?'
  if (n >= 1_000_000) return `ctx ${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `ctx ${Math.round(n / 1_000)}K`
  return `ctx ${n}`
}

function capabilityLabel(value: boolean | 'unknown'): string {
  if (value === true) return 'نعم'
  if (value === false) return 'لا'
  return '?'
}

function capabilityClass(value: boolean | 'unknown'): string {
  if (value === true) return 'border-success/30 bg-success/10 text-success'
  if (value === false) return 'border-border bg-muted text-muted-foreground'
  return 'border-warn/30 bg-warn/10 text-warn'
}

// Feature tags already represented by the capability pills (or universal), so
// they are hidden from the secondary feature chips to avoid redundancy.
const PILL_FEATURES = new Set(['chat-completions', 'tool-calling', 'vision', 'image-input', 'audio-input'])

function CapabilityPill({
  label,
  value,
}: {
  label: string
  value: boolean | 'unknown'
}) {
  return (
    <span className={`inline-flex h-5 items-center gap-1 rounded-full border px-2 text-[11px] font-medium ${capabilityClass(value)}`}>
      {label}
      <span className="font-mono">{capabilityLabel(value)}</span>
    </span>
  )
}

interface TokenUsageData {
  totalBudget: number
  totalUsed: number
  models: { displayName: string; platform: string; budget: number }[]
}

interface OptimizeTip {
  level: 'good' | 'warn' | 'info'
  text: string
}

interface OptimizeResult {
  order: { modelDbId: number; priority: number; enabled: boolean }[]
  tips: OptimizeTip[]
}

const platformColors: Record<string, string> = {
  google:      '#4285f4',
  groq:        '#f55036',
  cerebras:    '#8b5cf6',
  sambanova:   '#14b8a6',
  nvidia:      '#76b900',
  mistral:     '#f59e0b',
  openrouter:  '#ec4899',
  github:      '#6e7b8b',
  cohere:      '#d946ef',
  cloudflare:  '#f38020',
  zhipu:       '#06b6d4',
  ollama:      '#000000',
  kilo:        '#7c3aed',
  pollinations: '#a855f7',
  llm7:        '#0ea5e9',
}

function TokenUsageBar({ data }: { data: TokenUsageData }) {
  const { totalBudget, totalUsed, models } = data
  const remaining = Math.max(0, totalBudget - totalUsed)
  const remainingPct = totalBudget > 0 ? Math.round((remaining / totalBudget) * 100) : 0

  // Scale each model's segment proportionally so the colored portion of the
  // bar sums to `remaining`; the grey tail represents what's been used.
  const modelsWithWidth = models.map(m => ({
    ...m,
    remainingTokens: totalBudget > 0 ? (m.budget / totalBudget) * remaining : 0,
    widthPct: totalBudget > 0 ? (m.budget / totalBudget) * (remaining / totalBudget) * 100 : 0,
  }))
  const usedPct = totalBudget > 0 ? (totalUsed / totalBudget) * 100 : 0

  return (
    <section className="rounded-xl border bg-gradient-to-br from-brand/5 via-card to-card p-5 shadow-sm">
      <div className="flex items-end justify-between gap-4 mb-4">
        <div className="min-w-0">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">ميزانية الرموز الشهرية</h2>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-foreground tabular-nums">{formatTokens(remaining)}</span>
            <span className="text-sm text-muted-foreground">متبقٍّ</span>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand tabular-nums">
          {remainingPct}% من {formatTokens(totalBudget)}
        </span>
      </div>

      <div className="flex h-3 rounded-full overflow-hidden bg-muted ring-1 ring-border/50">
        {modelsWithWidth.map((m, i) => (
          <div
            key={i}
            title={`${m.displayName} (${m.platform}) — ${formatTokens(m.remainingTokens)} متبقٍّ`}
            style={{
              width: `${m.widthPct}%`,
              backgroundColor: platformColors[m.platform] ?? '#94a3b8',
            }}
          />
        ))}
        {totalUsed > 0 && (
          <div
            title={`المستهلَك — ${formatTokens(totalUsed)}`}
            className="bg-muted-foreground/30"
            style={{ width: `${usedPct}%` }}
          />
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-1.5 text-xs tabular-nums">
        {modelsWithWidth.map((m, i) => (
          <div key={i} className="flex items-center gap-2 min-w-0">
            <span
              className="size-2 rounded-full flex-shrink-0 ring-1 ring-border/40"
              style={{ backgroundColor: platformColors[m.platform] ?? '#94a3b8' }}
            />
            <span className="truncate">{m.displayName}</span>
            <span className="flex-1" />
            <span className="font-mono text-muted-foreground">{formatTokens(m.remainingTokens)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function SortableModelRow({
  entry,
  index,
  onToggle,
}: {
  entry: FallbackEntry
  index: number
  onToggle: (modelDbId: number, enabled: boolean) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.modelDbId,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:border-brand/40 ${isDragging ? 'opacity-50 border-brand/40 shadow-md' : ''} ${entry.enabled ? '' : 'opacity-50'}`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing rounded-md p-1 -ms-1 text-muted-foreground/40 hover:bg-muted hover:text-foreground transition-colors"
        aria-label="اسحب لإعادة الترتيب"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
          <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
          <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
        </svg>
      </button>
      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-brand/10 text-xs font-semibold font-mono text-brand tabular-nums">{index + 1}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{entry.displayName}</span>
          <span className="text-xs text-muted-foreground">{entry.platform}</span>
          <span className="text-xs font-mono text-muted-foreground">{formatContextWindow(entry.contextWindow)}</span>
          {entry.penalty > 0 && (
            <span className="inline-flex h-5 items-center rounded-full bg-warn/10 px-2 text-[11px] font-medium text-warn tabular-nums">
              −{entry.penalty} غرامة
            </span>
          )}
          {entry.budgetExhausted && (
            <span className="inline-flex h-5 items-center rounded-full border border-destructive/30 bg-destructive/10 px-2 text-[11px] font-medium text-destructive" title="استنفد هذا المزوّد ميزانيته الشهرية المجانية المقدّرة">
              تجاوز الميزانية
            </span>
          )}
        </div>
        <div className="flex gap-3 mt-0.5 text-xs text-muted-foreground tabular-nums flex-wrap">
          <span>الذكاء #{entry.intelligenceRank}</span>
          <span>السرعة #{entry.speedRank}</span>
          {entry.rpmLimit && <span>{entry.rpmLimit} rpm</span>}
          {entry.rpdLimit && <span>{entry.rpdLimit} rpd</span>}
          <span>{entry.monthlyTokenBudget} رمز/شهر</span>
          <span>{entry.inputModalities.join('+')} → {entry.outputModalities.join('+')}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <CapabilityPill label="الأدوات" value={entry.capabilities.toolCalling} />
          <CapabilityPill label="إدخال صور" value={entry.capabilities.imageInput} />
          <CapabilityPill label="إخراج صور" value={entry.capabilities.imageOutput} />
          <CapabilityPill label="إدخال صوت" value={entry.capabilities.audioInput} />
          <CapabilityPill label="إخراج صوت" value={entry.capabilities.audioOutput} />
          {entry.features
            // The pills above already convey tool-calling / vision / audio, and
            // every model has chat-completions — show only the extra signal.
            .filter(f => !PILL_FEATURES.has(f))
            .slice(0, 4)
            .map(feature => (
              <span key={feature} className="inline-flex h-5 items-center rounded-full bg-muted px-2 text-[11px] text-muted-foreground">
                {feature}
              </span>
            ))}
        </div>
      </div>
      <Switch
        checked={entry.enabled}
        onCheckedChange={(checked) => onToggle(entry.modelDbId, checked)}
      />
    </div>
  )
}

export default function FallbackPage() {
  const queryClient = useQueryClient()
  const [localEntries, setLocalEntries] = useState<FallbackEntry[] | null>(null)
  const [tips, setTips] = useState<OptimizeTip[]>([])

  const { data: entries = [], isLoading } = useQuery<FallbackEntry[]>({
    queryKey: ['fallback'],
    queryFn: () => apiFetch('/api/fallback'),
  })

  const { data: tokenUsage } = useQuery<TokenUsageData>({
    queryKey: ['fallback', 'token-usage'],
    queryFn: () => apiFetch('/api/fallback/token-usage'),
  })

  const saveMutation = useMutation({
    mutationFn: (data: { modelDbId: number; priority: number; enabled: boolean }[]) =>
      apiFetch('/api/fallback', { method: 'PUT', body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fallback'] })
      setLocalEntries(null)
      setTips([])
    },
  })

  const sortMutation = useMutation({
    mutationFn: (preset: string) =>
      apiFetch(`/api/fallback/sort/${preset}`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fallback'] })
      setLocalEntries(null)
      setTips([])
    },
  })

  // Deterministic credit-optimizer: previews a suggested order + tips. The user
  // reviews the reordered list and Saves or Discards (same flow as drag/sort).
  const optimizeMutation = useMutation({
    mutationFn: (): Promise<OptimizeResult> => apiFetch('/api/fallback/optimize'),
    onSuccess: (result) => {
      const byId = new Map(entries.map(e => [e.modelDbId, e]))
      const reordered = result.order
        .map(o => {
          const entry = byId.get(o.modelDbId)
          return entry ? { ...entry, priority: o.priority, enabled: o.enabled } : null
        })
        .filter((e): e is FallbackEntry => e !== null)
      setLocalEntries(reordered)
      setTips(result.tips ?? [])
    },
  })

  // Auto-optimize toggle: when on, the server re-applies this optimal order
  // periodically (every few hours) so the chain stays drained-optimally.
  const { data: autoOpt } = useQuery<{ enabled: boolean }>({
    queryKey: ['settings', 'auto-optimize'],
    queryFn: () => apiFetch('/api/settings/auto-optimize'),
  })
  const autoOptMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch('/api/settings/auto-optimize', { method: 'PUT', body: JSON.stringify({ enabled }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings', 'auto-optimize'] }),
  })

  // Budget guard: auto-disable providers that exhausted their monthly free budget.
  const { data: budgetGuard } = useQuery<{ enabled: boolean }>({
    queryKey: ['settings', 'budget-guard'],
    queryFn: () => apiFetch('/api/settings/budget-guard'),
  })
  const budgetGuardMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch('/api/settings/budget-guard', { method: 'PUT', body: JSON.stringify({ enabled }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'budget-guard'] })
      queryClient.invalidateQueries({ queryKey: ['fallback'] })
    },
  })

  const allEntries = localEntries ?? entries
  const displayEntries = allEntries.filter(e => e.keyCount > 0)
  const unconfiguredPlatforms = [...new Set(allEntries.filter(e => e.keyCount === 0).map(e => e.platform))]

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = displayEntries.findIndex(e => e.modelDbId === active.id)
    const newIndex = displayEntries.findIndex(e => e.modelDbId === over.id)
    const reorderedVisible = arrayMove(displayEntries, oldIndex, newIndex)
    const unconfigured = allEntries.filter(e => e.keyCount === 0)
    const merged = [
      ...reorderedVisible.map((e, i) => ({ ...e, priority: i + 1 })),
      ...unconfigured.map((e, i) => ({ ...e, priority: reorderedVisible.length + i + 1 })),
    ]
    setLocalEntries(merged)
  }

  function handleToggle(modelDbId: number, enabled: boolean) {
    const updated = allEntries.map(e =>
      e.modelDbId === modelDbId ? { ...e, enabled } : e
    )
    setLocalEntries(updated)
  }

  function handleSave() {
    if (!localEntries) return
    saveMutation.mutate(
      allEntries.map(e => ({
        modelDbId: e.modelDbId,
        priority: e.priority,
        enabled: e.enabled,
      }))
    )
  }

  const hasChanges = localEntries !== null

  return (
    <div>
      <PageHeader
        title="سلسلة التحويل الاحتياطي"
        description="اسحب لإعادة الترتيب. تجرّب الطلبات النماذج من الأعلى للأسفل حتى ينجح أحدها."
        accent="warn"
        icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>}
        actions={
          <>
            <Button size="sm" onClick={() => optimizeMutation.mutate()} disabled={optimizeMutation.isPending}>
              {optimizeMutation.isPending ? 'جارٍ التحسين…' : 'تحسين للرصيد'}
            </Button>
            <label className="flex items-center gap-2 text-xs text-muted-foreground select-none" title="إعادة تطبيق هذا الترتيب الأمثل تلقائيًا كل بضع ساعات">
              <Switch checked={autoOpt?.enabled ?? false} onCheckedChange={(c) => autoOptMutation.mutate(c)} />
              تلقائي
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground select-none" title="تعطيل المزوّدين الذين استنفدوا ميزانيتهم الشهرية المجانية تلقائيًا، وإعادة تفعيلهم عند تجدّدها">
              <Switch checked={budgetGuard?.enabled ?? false} onCheckedChange={(c) => budgetGuardMutation.mutate(c)} />
              حارس الميزانية
            </label>
            <div className="inline-flex items-center rounded-lg border bg-card p-0.5 text-xs">
              <button
                onClick={() => sortMutation.mutate('intelligence')}
                disabled={sortMutation.isPending}
                className="rounded-md px-2.5 py-1 font-medium text-muted-foreground transition-colors hover:bg-brand/10 hover:text-brand disabled:opacity-50"
              >
                ترتيب حسب الذكاء
              </button>
              <button
                onClick={() => sortMutation.mutate('speed')}
                disabled={sortMutation.isPending}
                className="rounded-md px-2.5 py-1 font-medium text-muted-foreground transition-colors hover:bg-brand/10 hover:text-brand disabled:opacity-50"
              >
                ترتيب حسب السرعة
              </button>
              <button
                onClick={() => sortMutation.mutate('budget')}
                disabled={sortMutation.isPending}
                className="rounded-md px-2.5 py-1 font-medium text-muted-foreground transition-colors hover:bg-brand/10 hover:text-brand disabled:opacity-50"
              >
                ترتيب حسب الميزانية
              </button>
            </div>
          </>
        }
      />

      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {tokenUsage && tokenUsage.totalBudget > 0 && (
            <div className="lg:col-span-2">
              <TokenUsageBar data={tokenUsage} />
            </div>
          )}

          <aside className="lg:col-span-1 card-sheen rounded-xl border bg-card p-5">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">الترتيب والحماية</h2>
            <div className="mt-3 space-y-2.5 text-xs">
              <div className="flex items-start gap-2">
                <span className="mt-1 size-1.5 rounded-full flex-shrink-0 bg-brand" />
                <span className="text-muted-foreground">رتّب السلسلة حسب الذكاء أو السرعة أو الميزانية من الأزرار أعلى الصفحة.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1 size-1.5 rounded-full flex-shrink-0 bg-success" />
                <span className="text-muted-foreground">«حارس الميزانية» يعطّل المزوّدين المُستنفَدين تلقائيًا ويعيد تفعيلهم عند تجدّد الميزانية.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1 size-1.5 rounded-full flex-shrink-0 bg-warn" />
                <span className="text-muted-foreground">«تحسين للرصيد» يقترح ترتيبًا أمثل تراجعه ثم تحفظه أو تتجاهله.</span>
              </div>
            </div>
            <p className="mt-3 border-t pt-3 text-[11px] text-muted-foreground">
              تلميح: فعّل «تلقائي» لإعادة تطبيق الترتيب الأمثل كل بضع ساعات دون تدخّل.
            </p>
          </aside>
        </div>

        {tips.length > 0 && (
          <section className="rounded-xl border border-brand/30 bg-brand/5 p-5">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-sm font-semibold text-brand">تحسين الرصيد — ترتيب مقترح</h2>
              <span className="text-xs text-muted-foreground">راجع الترتيب الجديد أدناه، ثم احفظ أو تجاهل</span>
            </div>
            <ul className="space-y-2">
              {tips.map((tip, i) => (
                <li key={i} className="flex items-start gap-2.5 text-xs">
                  <span
                    className={`mt-1 size-1.5 rounded-full flex-shrink-0 ${
                      tip.level === 'good' ? 'bg-success'
                        : tip.level === 'warn' ? 'bg-warn'
                        : 'bg-muted-foreground/40'
                    }`}
                  />
                  <span
                    className={
                      tip.level === 'good' ? 'text-success'
                        : tip.level === 'warn' ? 'text-warn'
                        : 'text-muted-foreground'
                    }
                  >
                    {tip.text}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">جارٍ التحميل…</p>
        ) : displayEntries.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">
              لا توجد نماذج متاحة. أضف مفاتيح API أولًا من <a href="/keys" className="underline text-foreground">صفحة المفاتيح</a>.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={displayEntries.map(e => e.modelDbId)}
                  strategy={verticalListSortingStrategy}
                >
                  {displayEntries.map((entry, index) => (
                    <SortableModelRow
                      key={entry.modelDbId}
                      entry={entry}
                      index={index}
                      onToggle={handleToggle}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>

            {hasChanges && (
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => { setLocalEntries(null); setTips([]) }}>
                  تجاهل
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? 'جارٍ الحفظ…' : 'حفظ الترتيب'}
                </Button>
              </div>
            )}

            {unconfiguredPlatforms.length > 0 && (
              <p className="text-xs text-muted-foreground">
                مخفية (بلا مفاتيح): {unconfiguredPlatforms.join(', ')}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
