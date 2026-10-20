/**
 * React-free browser model: per-Session capability snapshots kept current by
 * one shared long-poll loop against the Host's wait route.
 *
 * - `watch(sessionId)` is reference-counted; the first watcher fetches the
 *   snapshot, the last one stops tracking that Session.
 * - While any Session is watched, one loop long-polls `wait?since=<rev>`; a
 *   revision change refetches every watched Session.
 * - If the wait route fails (older Host, transport error) the loop degrades to
 *   plain polling every POLL_FALLBACK_MS, and retries the long poll later.
 * - `refresh(sessionId)` forces a fetch (used when the panel opens).
 */

import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { RECONNECT_ROUTE, SNAPSHOT_ROUTE, WAIT_ROUTE, type CapabilitiesRevision, type CapabilitiesSnapshot, type ReconnectResult } from '../shared.ts'

/** Fallback cadence when long polling is unavailable. */
const POLL_FALLBACK_MS = 5_000

/** One Session's view state. */
export interface SessionCapabilitiesEntry {
  /** Latest good snapshot; kept while a refetch runs or after a failed one. */
  readonly snapshot?: CapabilitiesSnapshot
  /** A fetch is in flight. */
  readonly loading: boolean
  /** The latest fetch failed; the previous snapshot (if any) is stale. */
  readonly error?: string
}

/** Store shape: Session id → entry. */
export type CapabilitiesState = Record<string, SessionCapabilitiesEntry | undefined>

/** Minimal fetch signature, injectable for tests. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}

export class CapabilitiesModel {
  /** Observable state the renderer binds as `useCapabilities`. */
  readonly state = createSnapshotStore<CapabilitiesState>({})

  private readonly watchers = new Map<string, number>()
  private readonly inflight = new Map<string, AbortController>()
  private readonly lifetime = new AbortController()
  private loop: AbortController | undefined
  private revision = 0

  constructor(private readonly doFetch: FetchLike = (input, init) => globalThis.fetch(input, init)) {}

  /**
   * Track one Session while a view shows it.
   * @param sessionId - Session to keep current.
   * @returns release function.
   */
  watch(sessionId: string): () => void {
    this.watchers.set(sessionId, (this.watchers.get(sessionId) ?? 0) + 1)
    if (this.watchers.get(sessionId) === 1) void this.fetchSnapshot(sessionId)
    this.ensureLoop()
    let released = false
    return () => {
      if (released) return
      released = true
      const count = (this.watchers.get(sessionId) ?? 1) - 1
      if (count > 0) {
        this.watchers.set(sessionId, count)
        return
      }
      this.watchers.delete(sessionId)
      this.inflight.get(sessionId)?.abort()
      if (this.watchers.size === 0) {
        this.loop?.abort()
        this.loop = undefined
      }
    }
  }

  /**
   * Fetch one Session now.
   * @param sessionId - Session to refetch.
   */
  refresh(sessionId: string): void {
    void this.fetchSnapshot(sessionId)
  }

  /**
   * Ask the Host to reload one MCP server instance, then refetch.
   * @param sessionId - Session whose view selects the instance.
   * @param serverName - MCP namespace.
   * @returns whether the Host reloaded at least one instance.
   */
  async reconnect(sessionId: string, serverName: string): Promise<boolean> {
    try {
      const response = await this.doFetch(RECONNECT_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, serverName }),
        credentials: 'same-origin',
        signal: this.lifetime.signal,
      })
      const result = await response.json() as ReconnectResult
      return response.ok && result.reloaded > 0
    } catch {
      return false
    } finally {
      void this.fetchSnapshot(sessionId)
    }
  }

  /** Forget everything after a Connection generation change. */
  reset(): void {
    for (const controller of this.inflight.values()) controller.abort()
    this.inflight.clear()
    this.state.set({})
    this.revision = 0
    for (const sessionId of this.watchers.keys()) void this.fetchSnapshot(sessionId)
  }

  /** Stop every loop and fetch. */
  dispose(): void {
    this.lifetime.abort()
    this.loop?.abort()
    for (const controller of this.inflight.values()) controller.abort()
  }

  private async fetchSnapshot(sessionId: string): Promise<void> {
    if (this.lifetime.signal.aborted) return
    this.inflight.get(sessionId)?.abort()
    const controller = new AbortController()
    this.inflight.set(sessionId, controller)
    this.state.update((draft) => {
      const previous = draft[sessionId]
      draft[sessionId] = { ...previous, loading: true }
    })
    try {
      const response = await this.doFetch(`${SNAPSHOT_ROUTE}?sessionId=${encodeURIComponent(sessionId)}`, {
        signal: AbortSignal.any([controller.signal, this.lifetime.signal]),
        credentials: 'same-origin',
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const snapshot = await response.json() as CapabilitiesSnapshot
      if (controller.signal.aborted) return
      if (snapshot.revision > this.revision) this.revision = snapshot.revision
      this.state.update((draft) => {
        draft[sessionId] = { snapshot, loading: false }
      })
    } catch (error) {
      if (controller.signal.aborted || this.lifetime.signal.aborted) return
      this.state.update((draft) => {
        const previous = draft[sessionId]
        draft[sessionId] = {
          ...previous?.snapshot === undefined ? {} : { snapshot: previous.snapshot },
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }
      })
    } finally {
      if (this.inflight.get(sessionId) === controller) this.inflight.delete(sessionId)
    }
  }

  private ensureLoop(): void {
    if (this.loop !== undefined || this.lifetime.signal.aborted) return
    const controller = new AbortController()
    this.loop = controller
    void this.runLoop(controller.signal)
  }

  private async runLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      let changed = false
      try {
        const response = await this.doFetch(`${WAIT_ROUTE}?since=${this.revision}`, {
          signal: AbortSignal.any([signal, this.lifetime.signal]),
          credentials: 'same-origin',
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const { revision } = await response.json() as CapabilitiesRevision
        // Revision 0 means no snapshot has landed yet: the watch() fetches
        // already cover that case, so only a later move triggers a refetch.
        changed = this.revision !== 0 && revision !== this.revision
        this.revision = revision
      } catch {
        if (signal.aborted) return
        // Degrade to plain polling, then retry the long poll.
        await sleep(POLL_FALLBACK_MS, signal)
        changed = true
      }
      if (signal.aborted) return
      if (changed) {
        for (const sessionId of this.watchers.keys()) void this.fetchSnapshot(sessionId)
      }
    }
  }
}
