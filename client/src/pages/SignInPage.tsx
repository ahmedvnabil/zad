import { useState } from 'react'
import { setStoredKey } from '@/lib/api'
import { Button } from '@/components/ui/button'

/**
 * The dashboard's key gate.
 *
 * `/api/*` requires the unified API key now, so without this every page just
 * renders empty tables full of failed requests. The key is printed once when
 * the server first boots, and lives in `settings.unified_api_key` after that.
 */
export default function SignInPage() {
  const [key, setKey] = useState('')

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">افتح لوحة التحكم</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          الصق مفتاح الـ API الموحّد. الخادم يطبعه مرة واحدة عند أول تشغيل، وهو نفسه
          المفتاح الذي ترسله إلى <code>/v1/chat/completions</code>.
        </p>
      </div>

      <form
        className="border border-border rounded-lg p-5 space-y-3"
        onSubmit={(e) => { e.preventDefault(); setStoredKey(key.trim()) }}
      >
        <label className="text-sm font-medium block" htmlFor="apikey">المفتاح الموحّد</label>
        <input
          id="apikey"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="zad-…"
          autoComplete="off"
          spellCheck={false}
          className="w-full border border-border rounded-md px-3 py-2 bg-transparent font-mono text-sm"
        />
        <Button type="submit" disabled={!key.trim()} className="w-full">دخول</Button>
        <p className="text-xs text-muted-foreground pt-1">
          نسيته؟ شغّل <code>docker compose logs</code> أو اقرأه من قاعدة البيانات:
          <br />
          <code className="text-xs">sqlite3 server/data/freeapi.db "select value from settings where key='unified_api_key'"</code>
        </p>
      </form>

      <p className="text-xs text-muted-foreground">
        يُحفظ في <code>localStorage</code> على هذا المتصفح فقط — لا يُرسل في أي رابط.
      </p>
    </div>
  )
}
