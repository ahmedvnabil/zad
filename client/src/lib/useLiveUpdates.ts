import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { authHeaders } from '@/lib/api'

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

/**
 * Subscribe to the server's SSE change stream. On each `change` event we
 * (debounced) invalidate React Query so the open page refetches — Analytics,
 * Requests, and Overview all update live as the proxy serves requests.
 *
 * This reads the stream with `fetch` rather than `EventSource`. `/api/events`
 * is owner-only now, and `EventSource` cannot send an Authorization header —
 * it would 401 on every connect. Putting the key in the query string would
 * work but contradicts the rule in api.ts (never in the URL) and would land
 * the key in the reverse proxy's access log, so we read the body stream by
 * hand instead. Reconnects with backoff, the way EventSource used to.
 *
 * Returns connection state and a pause toggle for the header status pill.
 */
export function useLiveUpdates(enabled = true) {
  const qc = useQueryClient()
  const [connected, setConnected] = useState(false)
  const [paused, setPaused] = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (paused || !enabled) {
      setConnected(false)
      return
    }

    const controller = new AbortController()
    let retry: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    let stopped = false

    function onChange() {
      clearTimeout(debounce.current)
      debounce.current = setTimeout(() => qc.invalidateQueries(), 400)
    }

    // One SSE frame is a block of lines ending in a blank line. We only care
    // about the event name; the payload is always `{}` and the reaction is the
    // same refetch either way.
    function handleFrame(frame: string) {
      if (frame.startsWith(':')) return // heartbeat comment
      const name = frame
        .split('\n')
        .find((line) => line.startsWith('event:'))
        ?.slice(6)
        .trim()
      if (name === 'change') onChange()
    }

    async function connect() {
      try {
        const res = await fetch(`${BASE}/api/events`, {
          headers: { Accept: 'text/event-stream', ...authHeaders() },
          signal: controller.signal,
        })
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

        setConnected(true)
        attempt = 0

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          // Frames are separated by a blank line; keep the trailing partial.
          const frames = buffer.split('\n\n')
          buffer = frames.pop() ?? ''
          frames.forEach(handleFrame)
        }
      } catch {
        /* network error, 401, or abort — the finally block decides */
      } finally {
        setConnected(false)
        if (!stopped) {
          // Back off to 30s so a 401 (wrong key) doesn't hammer the gateway.
          attempt += 1
          retry = setTimeout(connect, Math.min(1000 * 2 ** attempt, 30_000))
        }
      }
    }

    void connect()

    return () => {
      stopped = true
      clearTimeout(retry)
      clearTimeout(debounce.current)
      controller.abort()
    }
  }, [paused, enabled, qc])

  return { connected, paused, setPaused }
}
