import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageHeader } from '@/components/page-header'

interface FallbackEntry {
  modelDbId: number
  priority: number
  enabled: boolean
  platform: string
  modelId: string
  displayName: string
  sizeLabel: string
  keyCount: number
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  meta?: {
    platform?: string
    model?: string
    latency?: number
    fallbackAttempts?: number
  }
}

export default function PlaygroundPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedModel, setSelectedModel] = useState<string>('auto')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const { data: keyData } = useQuery<{ apiKey: string }>({
    queryKey: ['unified-key'],
    queryFn: () => apiFetch('/api/settings/api-key'),
  })

  const { data: fallbackEntries = [] } = useQuery<FallbackEntry[]>({
    queryKey: ['fallback'],
    queryFn: () => apiFetch('/api/fallback'),
  })

  const availableModels = fallbackEntries.filter(e => e.keyCount > 0 && e.enabled)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [messages])

  // Replay handoff from the Requests page: prefill the prompt + model.
  useEffect(() => {
    const raw = sessionStorage.getItem('freellm:replay')
    if (!raw) return
    sessionStorage.removeItem('freellm:replay')
    try {
      const { prompt, model } = JSON.parse(raw)
      if (typeof prompt === 'string' && prompt) setInput(prompt)
      if (typeof model === 'string' && model) setSelectedModel(model)
      setTimeout(() => inputRef.current?.focus(), 0)
    } catch { /* ignore malformed handoff */ }
  }, [])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: ChatMessage = { role: 'user', content: text }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)
    inputRef.current?.focus()

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (keyData?.apiKey) headers['Authorization'] = `Bearer ${keyData.apiKey}`

      const body: any = {
        messages: newMessages.map(m => ({ role: m.role, content: m.content })),
      }
      if (selectedModel !== 'auto') body.model = selectedModel

      const base = import.meta.env.BASE_URL.replace(/\/$/, '')
      const start = Date.now()
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      const latency = Date.now() - start
      const routedVia = res.headers.get('X-Routed-Via')
      const fallbackAttempts = res.headers.get('X-Fallback-Attempts')

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }))
        setMessages([...newMessages, {
          role: 'assistant',
          content: `خطأ: ${err.error?.message ?? 'خطأ غير معروف'}`,
        }])
        return
      }

      const data = await res.json()
      const content = data.choices?.[0]?.message?.content ?? JSON.stringify(data, null, 2)
      const via = data._routed_via ?? (routedVia ? {
        platform: routedVia.split('/')[0],
        model: routedVia.split('/').slice(1).join('/'),
      } : undefined)

      setMessages([...newMessages, {
        role: 'assistant',
        content,
        meta: {
          platform: via?.platform,
          model: via?.model,
          latency,
          fallbackAttempts: fallbackAttempts ? parseInt(fallbackAttempts) : undefined,
        },
      }])
    } catch (err: any) {
      setMessages([...newMessages, {
        role: 'assistant',
        content: `خطأ: ${err.message}`,
      }])
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleClear = () => {
    setMessages([])
    inputRef.current?.focus()
  }

  const activeModelLabel = selectedModel === 'auto'
    ? 'تلقائي (سلسلة التحويل الاحتياطي)'
    : availableModels.find(m => m.modelId === selectedModel)?.displayName ?? selectedModel

  const lastResponseMeta = [...messages].reverse().find(m => m.role === 'assistant' && m.meta)?.meta

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <PageHeader
        title="ساحة التجربة"
        description="أرسل طلب محادثة عبر المُوجِّه وشاهد أي مزوّد يخدمه."
        accent="brand"
        icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>}
        actions={
          messages.length > 0 ? (
            <Button variant="outline" size="sm" onClick={handleClear}>
              مسح
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 flex-1 min-h-0">
        {/* MAIN pane */}
        <div className="flex flex-col rounded-xl border bg-card card-sheen overflow-hidden min-h-0">
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-center">
              <div className="space-y-3 max-w-sm flex flex-col items-center">
                <span className="inline-flex size-12 items-center justify-center rounded-2xl ring-1 ring-brand-border bg-brand-subtle text-brand">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                </span>
                <p className="text-base font-medium">أرسل رسالة للبدء.</p>
                <p className="text-sm text-muted-foreground">
                  باستخدام <span className="text-brand-subtle-foreground font-medium">{activeModelLabel}</span>. بدّل النماذج من اللوحة الجانبية.
                </p>
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-brand text-brand-foreground'
                        : 'border bg-muted'
                    }`}
                  >
                    <div dir="auto" className="whitespace-pre-wrap">{msg.content}</div>
                    {msg.meta && (
                      <div className="flex items-center gap-2 mt-2 flex-wrap text-xs opacity-70 tabular-nums">
                        {msg.meta.platform && <span>{msg.meta.platform}</span>}
                        {msg.meta.model && <span className="font-mono">· {msg.meta.model}</span>}
                        {msg.meta.latency != null && <span>· {msg.meta.latency} مللي ثانية</span>}
                        {msg.meta.fallbackAttempts != null && msg.meta.fallbackAttempts > 0 && (
                          <span>· {msg.meta.fallbackAttempts} تحويل احتياطي</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="border bg-muted rounded-2xl px-4 py-3">
                    <div className="flex gap-1">
                      <span className="size-1.5 rounded-full bg-brand/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="size-1.5 rounded-full bg-brand/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="size-1.5 rounded-full bg-brand/60 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        <div className="border-t bg-background/50 p-3">
          <div className="flex gap-2 items-end rounded-xl border bg-background p-1.5 transition-colors focus-within:border-brand-border focus-within:ring-2 focus-within:ring-brand/15">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="اكتب رسالة… (⏎ للإرسال، ⇧⏎ لسطر جديد)"
              rows={1}
              className="flex-1 resize-none bg-transparent px-2 py-2 text-sm focus:outline-none min-h-[40px] max-h-[160px]"
              style={{ height: 'auto', overflow: 'hidden' }}
              onInput={e => {
                const el = e.target as HTMLTextAreaElement
                el.style.height = 'auto'
                el.style.height = Math.min(el.scrollHeight, 160) + 'px'
              }}
            />
            <Button onClick={handleSend} disabled={loading || !input.trim()} size="default" className="bg-brand text-brand-foreground hover:bg-brand/90">
              {loading ? 'جارٍ الإرسال…' : 'إرسال'}
            </Button>
          </div>
        </div>
        </div>

        {/* SIDE RAIL — inspector */}
        <aside className="space-y-4">
          <div className="rounded-xl border bg-card card-sheen p-4 space-y-3">
            <label className="block text-sm font-medium">النموذج</label>
            <Select value={selectedModel} onValueChange={(v) => setSelectedModel(v ?? 'auto')}>
              <SelectTrigger className="w-full border-brand-border text-brand-subtle-foreground focus:ring-brand">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">تلقائي (سلسلة التحويل الاحتياطي)</SelectItem>
                {availableModels.map(m => (
                  <SelectItem key={m.modelDbId} value={m.modelId}>
                    <span className="flex items-center gap-2">
                      <span>{m.displayName}</span>
                      <span className="text-xs text-muted-foreground">{m.platform}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-xl border bg-card card-sheen p-4 space-y-2">
            <h2 className="text-sm font-medium">كيف يعمل</h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              زاد يختار النموذج المناسب تلقائياً ويحوّل احتياطياً لو فشل واحد.
            </p>
          </div>

          {lastResponseMeta && (
            <div className="rounded-xl border bg-card card-sheen p-4 space-y-2">
              <h2 className="text-sm font-medium">آخر استجابة</h2>
              <dl className="space-y-1.5 text-xs tabular-nums">
                {lastResponseMeta.platform && (
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">المزوّد</dt>
                    <dd>{lastResponseMeta.platform}</dd>
                  </div>
                )}
                {lastResponseMeta.model && (
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">النموذج</dt>
                    <dd className="font-mono text-end">{lastResponseMeta.model}</dd>
                  </div>
                )}
                {lastResponseMeta.latency != null && (
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">زمن الاستجابة</dt>
                    <dd>{lastResponseMeta.latency} مللي ثانية</dd>
                  </div>
                )}
                {lastResponseMeta.fallbackAttempts != null && lastResponseMeta.fallbackAttempts > 0 && (
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">تحويل احتياطي</dt>
                    <dd>{lastResponseMeta.fallbackAttempts}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
