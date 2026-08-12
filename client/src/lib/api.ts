const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/**
 * The gateway went from "open control plane" to "authenticated", so the
 * dashboard has to carry the unified API key on every call. It lives in
 * localStorage only — never in the URL, never in a cookie sent cross-site.
 */
const STORAGE_KEY = 'zad.gateway.key';

/**
 * The shell renders differently signed in and signed out, and the SSE stream
 * has to reconnect with the new key, so anything key-dependent subscribes here
 * instead of only the component that changed it.
 */
const keyListeners = new Set<() => void>();

export function subscribeKey(listener: () => void): () => void {
  keyListeners.add(listener);
  return () => { keyListeners.delete(listener); };
}

export function getStoredKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setStoredKey(key: string): void {
  try {
    if (key) localStorage.setItem(STORAGE_KEY, key);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode — the session just won't persist */
  }
  keyListeners.forEach((listener) => listener());
}

/** Auth headers for callers that can't go through `apiFetch` (the SSE reader). */
export function authHeaders(): Record<string, string> {
  const key = getStoredKey();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...options?.headers,
    },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { message: res.statusText } }));
    const error = new Error(body.error?.message ?? `HTTP ${res.status}`);
    (error as Error & { status?: number }).status = res.status;
    throw error;
  }
  return res.json();
}
