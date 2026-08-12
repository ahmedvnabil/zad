import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

interface TgConfig {
  master: boolean
  connected: boolean
  hasToken: boolean
  chatId: string
  events: { keys: boolean; providers: boolean; digest: boolean; errors: boolean }
}

const bellIcon = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
)

function Card({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card card-sheen">
      <div className="px-4 py-3 border-b">
        <h2 className="text-sm font-medium">{title}</h2>
        {desc && <p className="text-[12px] text-muted-foreground mt-0.5">{desc}</p>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

const EVENT_META: { key: keyof TgConfig['events']; label: string; desc: string }[] = [
  { key: 'keys', label: '🔑 مفتاح جديد / غير صالح', desc: 'عند إضافة مفتاح ونتيجة التحقق، أو لمّا مفتاح يبقى غير صالح.' },
  { key: 'providers', label: '🔴 مزوّد وقع / رجع', desc: 'لمّا مزوّد يفقد كل مفاتيحه الصالحة أو يرجع يعمل.' },
  { key: 'digest', label: '📊 الملخص اليومي', desc: 'رسالة كل صباح: الطلبات، نسبة النجاح، التوفير، أعلى المزوّدين.' },
  { key: 'errors', label: '🚨 طفرة أخطاء', desc: 'لمّا نسبة الفشل ترتفع بشكل غير طبيعي خلال آخر 30 دقيقة.' },
]

export default function NotificationsPage() {
  const qc = useQueryClient()
  const { data: cfg } = useQuery<TgConfig>({
    queryKey: ['telegram', 'config'],
    queryFn: () => apiFetch('/api/integrations/telegram/config'),
  })

  const [token, setToken] = useState('')
  const [chatId, setChatId] = useState('')
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => { if (cfg) setChatId(cfg.chatId ?? '') }, [cfg?.chatId])

  const invalidate = () => qc.invalidateQueries({ queryKey: ['telegram', 'config'] })

  const saveMut = useMutation({
    mutationFn: (body: any) => apiFetch('/api/integrations/telegram/config', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => { setToken(''); invalidate() },
  })
  const testMut = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>('/api/integrations/telegram/test', { method: 'POST' }),
    onSuccess: () => setTestMsg({ ok: true, text: '✅ تمام — وصلتك رسالة اختبار على تليجرام.' }),
    onError: (e: any) => setTestMsg({ ok: false, text: e?.message ?? 'فشل الإرسال — راجع التوكن و chat id.' }),
  })

  const connected = cfg?.connected ?? false

  return (
    <div>
      <PageHeader
        title="التنبيهات"
        description="اربط بوت تليجرام لاستقبال تنبيهات زاد — كله من هنا، بدون تعديل أي ملفات."
        accent="warn"
        icon={bellIcon}
        actions={
          <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] ${connected ? 'text-success-subtle-foreground border-success-border bg-success-subtle' : 'text-muted-foreground'}`}>
            <span className={`size-1.5 rounded-full ${connected ? 'bg-success animate-pulse' : 'bg-muted-foreground/50'}`} />
            {connected ? 'متصل' : 'غير متصل'}
          </span>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* connection (left, 2 cols) */}
        <div className="lg:col-span-2 space-y-4">
          <Card title="ربط بوت تليجرام" desc="التوكن بيتخزّن مشفّراً على سيرفرك ومش بيظهر تاني.">
            <div className="space-y-4">
              <div>
                <Label htmlFor="tg-token" className="text-xs text-muted-foreground">توكن البوت (Bot Token)</Label>
                <Input
                  id="tg-token"
                  type="password" className="mt-1 font-mono" dir="ltr"
                  placeholder={cfg?.hasToken ? 'محفوظ ••••••••  — اتركه فارغاً للإبقاء عليه' : '123456:ABC-DEF…'}
                  value={token} onChange={e => setToken(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="tg-chat-id" className="text-xs text-muted-foreground">معرّف المحادثة (Chat ID)</Label>
                <Input
                  id="tg-chat-id"
                  className="mt-1 font-mono tabular-nums" dir="ltr" placeholder="123456789"
                  value={chatId} onChange={e => setChatId(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border bg-background px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium">تفعيل الإشعارات</p>
                  <p className="text-xs text-muted-foreground">المفتاح الرئيسي — يوقف/يشغّل كل التنبيهات.</p>
                </div>
                <Switch
                  aria-label="تفعيل الإشعارات"
                  checked={cfg?.master ?? false}
                  onCheckedChange={c => saveMut.mutate({ enabled: c })}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  onClick={() => saveMut.mutate({ chatId, ...(token.trim() ? { botToken: token.trim() } : {}) })}
                  disabled={saveMut.isPending}
                >
                  {saveMut.isPending ? 'جارٍ الحفظ…' : 'حفظ'}
                </Button>
                <Button variant="secondary" disabled={!connected || testMut.isPending} onClick={() => { setTestMsg(null); testMut.mutate() }}>
                  {testMut.isPending ? 'جارٍ الإرسال…' : 'إرسال رسالة اختبار'}
                </Button>
                {cfg?.hasToken && (
                  <Button variant="ghost" className="text-destructive" onClick={() => { if (confirm('حذف التوكن المحفوظ؟')) saveMut.mutate({ botToken: '' }) }}>
                    حذف التوكن
                  </Button>
                )}
              </div>
              {testMsg && (
                <p className={`text-[13px] ${testMsg.ok ? 'text-success' : 'text-destructive'}`}>{testMsg.text}</p>
              )}
            </div>
          </Card>

          <Card title="أنواع التنبيهات" desc="اختار اللي يوصلك — كله مفعّل افتراضياً.">
            <div className="space-y-2">
              {EVENT_META.map(ev => (
                <div key={ev.key} className="flex items-center justify-between rounded-lg border bg-background px-3 py-2.5">
                  <div className="min-w-0 pe-3">
                    <p id={`ev-${ev.key}-label`} className="text-sm font-medium">{ev.label}</p>
                    <p id={`ev-${ev.key}-desc`} className="text-xs text-muted-foreground">{ev.desc}</p>
                  </div>
                  <Switch
                    aria-labelledby={`ev-${ev.key}-label`}
                    aria-describedby={`ev-${ev.key}-desc`}
                    checked={cfg?.events?.[ev.key] ?? true}
                    onCheckedChange={c => saveMut.mutate({ events: { [ev.key]: c } })}
                  />
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* setup guide (right) */}
        <div className="lg:col-span-1">
          <div className="rounded-xl border bg-card card-sheen lg:sticky lg:top-20">
            <div className="px-4 py-3 border-b"><h2 className="text-sm font-medium">إزاي تجيب التوكن و chat id؟</h2></div>
            {/* A real <ol>: assistive tech announces "list, 5 items" and offers
                step navigation, and the markers render in the document's own
                numbering system instead of five hand-typed Arabic-Indic digits
                sitting beside Latin ones everywhere else in the app. */}
            <ol className="p-4 ps-8 space-y-3 text-[13px] text-muted-foreground list-decimal marker:text-foreground marker:font-bold">
              <li>على تليجرام كلّم <span className="font-mono text-brand" dir="ltr">@BotFather</span> وابعت <span className="font-mono" dir="ltr">/newbot</span> — هياخد منك اسم ويوزرنيم ويديك التوكن.</li>
              <li>ابعت أي رسالة لبوتك الجديد.</li>
              <li>
                افتح في المتصفح (غيّر <span className="font-mono" dir="ltr">&lt;TOKEN&gt;</span>):
                <p className="mt-2 font-mono text-xs text-foreground bg-background border rounded-lg p-2 break-all" dir="ltr">https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</p>
              </li>
              <li>دوّر على <span className="font-mono" dir="ltr">"chat":{'{'}"id":…{'}'}</span> — الرقم ده هو الـ chat id.</li>
              <li>الصقهم فوق، فعّل الإشعارات، واضغط «إرسال رسالة اختبار».</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
