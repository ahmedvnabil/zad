import { useCallback, useEffect, useState } from 'react'
import { apiFetch, getStoredKey, subscribeKey } from '@/lib/api'

/**
 * Whether this browser holds a working API key.
 *
 * The control plane is authenticated now, so the shell can no longer just
 * render the dashboard and hope: every page would fire requests that 401 and
 * show empty tables with no explanation. It asks `/api/whoami` first and shows
 * the sign-in screen when the answer is no.
 */
export function useSession() {
  const [signedIn, setSignedIn] = useState(false)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!getStoredKey()) {
      setSignedIn(false)
      setLoading(false)
      return
    }
    try {
      await apiFetch<{ signedIn: boolean }>('/api/whoami')
      setSignedIn(true)
    } catch {
      // Wrong key, or the gateway is unreachable — either way this browser
      // cannot use the dashboard, and the sign-in screen is the honest render.
      setSignedIn(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    return subscribeKey(() => { void refresh() })
  }, [refresh])

  return { signedIn, loading, refresh }
}
