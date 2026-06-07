import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

/**
 * Subscribe to the server's SSE change stream. On each `change` event we
 * (debounced) invalidate React Query so the open page refetches — Analytics,
 * Requests, and Overview all update live as the proxy serves requests.
 *
 * Returns connection state and a pause toggle for the header status pill.
 */
export function useLiveUpdates() {
  const qc = useQueryClient()
  const [connected, setConnected] = useState(false)
  const [paused, setPaused] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (paused) {
      setConnected(false)
      return
    }
    const es = new EventSource(`${BASE}/api/events`)
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)
    es.addEventListener('change', () => {
      clearTimeout(debounce.current)
      debounce.current = setTimeout(() => qc.invalidateQueries(), 400)
    })
    return () => {
      clearTimeout(debounce.current)
      es.close()
    }
  }, [paused, qc])

  return { connected, paused, setPaused }
}
