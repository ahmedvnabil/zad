import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { useLiveUpdates } from '@/lib/useLiveUpdates'
import { Logo } from '@/components/logo'
import KeysPage from '@/pages/KeysPage'
import PlaygroundPage from '@/pages/PlaygroundPage'
import FallbackPage from '@/pages/FallbackPage'
import AnalyticsPage from '@/pages/AnalyticsPage'
import RequestsPage from '@/pages/RequestsPage'
import OverviewPage from '@/pages/OverviewPage'
import NotificationsPage from '@/pages/NotificationsPage'
import DiscoverPage from '@/pages/DiscoverPage'

const queryClient = new QueryClient()

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `relative text-sm px-1 py-4 transition-colors ${
          isActive
            ? 'text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand'
            : 'text-muted-foreground hover:text-foreground'
        }`
      }
    >
      {children}
    </NavLink>
  )
}

function DarkModeToggle() {
  const [dark, setDark] = useState(() =>
    typeof window !== 'undefined' && document.documentElement.classList.contains('dark')
  )

  useEffect(() => {
    const stored = localStorage.getItem('theme')
    if (stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark')
      setDark(true)
    }
  }, [])

  function toggle() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('theme', next ? 'dark' : 'light')
  }

  return (
    <Button variant="ghost" size="sm" onClick={toggle} aria-label="تبديل المظهر">
      {dark ? (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
      )}
    </Button>
  )
}

function Brand() {
  return (
    <a href="/overview" className="flex items-center gap-2 group">
      <Logo size={24} className="transition-transform group-hover:scale-110" />
      <span className="font-bold tracking-tight text-base">زاد</span>
    </a>
  )
}

function LivePill() {
  const { connected, paused, setPaused } = useLiveUpdates()
  const label = paused ? 'متوقف' : connected ? 'مباشر' : 'يتصل…'
  const dot = paused ? 'bg-muted-foreground/50' : connected ? 'bg-emerald-500' : 'bg-amber-500'
  return (
    <button
      onClick={() => setPaused(p => !p)}
      title={paused ? 'استئناف التحديث المباشر' : 'إيقاف التحديث المباشر'}
      className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
    >
      <span className={`size-1.5 rounded-full ${dot} ${!paused && connected ? 'animate-pulse' : ''}`} />
      {label}
    </button>
  )
}

function DemoBanner() {
  const [demo, setDemo] = useState(false)
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setDemo(!!d?.demoMode))
      .catch(() => {})
  }, [])
  if (!demo) return null
  return (
    <div className="bg-warn/15 border-b border-warn/30 text-warn text-[13px] text-center py-2 px-4">
      🧪 نسخة تجريبية عامة — البيانات تُعاد كل ساعة · لا تضع مفاتيح حقيقية حسّاسة
    </div>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <div className="min-h-screen bg-background">
          <DemoBanner />
          <header className="sticky top-0 z-40 bg-background/80 backdrop-blur border-b">
            <div className="max-w-6xl mx-auto px-6 flex items-center">
              <Brand />
              <nav className="flex items-center gap-6 ms-10">
                <NavItem to="/overview">نظرة عامة</NavItem>
                <NavItem to="/playground">ساحة التجربة</NavItem>
                <NavItem to="/keys">المفاتيح</NavItem>
                <NavItem to="/discover">اكتشف</NavItem>
                <NavItem to="/fallback">التحويل الاحتياطي</NavItem>
                <NavItem to="/analytics">التحليلات</NavItem>
                <NavItem to="/requests">الطلبات</NavItem>
                <NavItem to="/notifications">التنبيهات</NavItem>
              </nav>
              <div className="ms-auto py-2 flex items-center gap-1.5">
                <LivePill />
                <DarkModeToggle />
              </div>
            </div>
          </header>
          <main className="max-w-6xl mx-auto px-6 py-8">
            <Routes>
              <Route path="/" element={<Navigate to="/overview" replace />} />
              <Route path="/overview" element={<OverviewPage />} />
              <Route path="/playground" element={<PlaygroundPage />} />
              <Route path="/keys" element={<KeysPage />} />
              <Route path="/discover" element={<DiscoverPage />} />
              <Route path="/fallback" element={<FallbackPage />} />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path="/requests" element={<RequestsPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/test" element={<Navigate to="/playground" replace />} />
              <Route path="/health" element={<Navigate to="/keys" replace />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
