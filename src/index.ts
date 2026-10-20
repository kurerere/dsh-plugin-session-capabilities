/**
 * dsh-plugin-session-capabilities — Host face.
 *
 * Serves a read-only, per-Session projection of the skills and MCP servers the
 * Session sees, over two exact Connection Fetch routes inside the Connection's
 * trust and authentication fence (owner Peers only):
 *
 * - `GET /api/session-capabilities.snapshot?sessionId=<id>` → CapabilitiesSnapshot
 * - `GET /api/session-capabilities.wait?since=<revision>`   → CapabilitiesRevision
 * - `POST /api/session-capabilities.reconnect` `{ sessionId, serverName }` → ReconnectResult
 *
 * The wait route is a long poll: it answers as soon as the Host catalog
 * revision moves past `since` (driven by `skills/change`, `tools/change`,
 * mcp-client fiber status transitions, and mcp-client diagnostics), or after
 * WAIT_TIMEOUT_MS with the unchanged revision. This gives the browser push-like
 * updates without a generated Typert Remote contract, which an out-of-tree
 * package cannot add to the shipped `api-remotes` assembly.
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-tools'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { RECONNECT_PATH, SNAPSHOT_PATH, WAIT_PATH, WAIT_TIMEOUT_MS, type CapabilitiesRevision } from './shared.ts'
import { collectSnapshot, MCP_CLIENT_PLUGIN_NAME, reconnectMcp } from './host/collect.ts'
import { McpLogTracker, type LogRecord } from './host/mcp-log.ts'

export type * from './shared.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'session-capabilities'

/**
 * Hard dependency: the Connection's exact Fetch-route registry. Every other
 * source (skills, tools, agents, sessionQuery, workingDirectory, agentPresets,
 * loader) is optional and read per request with `ctx.get`, so the plugin still
 * mounts — and reports what is missing — in slimmer compositions.
 */
export const inject = ['connection']

export interface Config {
  /** Coalescing window for change notifications, in milliseconds. */
  debounceMs: number
}

export const Config: Schema<Config> = Schema.object({
  debounceMs: Schema.number().min(0).max(5_000).default(150),
})

const SESSION_ID = /^[A-Za-z0-9._:-]{1,200}$/
const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/

const NO_STORE = { 'cache-control': 'no-store' } as const

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE })
}

/**
 * Plugin body.
 * @param ctx - Host plugin context.
 * @param config - resolved configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const tracker = new McpLogTracker()
  let revision = 1
  let pendingBump: ReturnType<typeof setTimeout> | undefined
  const waiters = new Set<() => void>()
  const lifetime = new AbortController()

  const flush = (): void => {
    pendingBump = undefined
    revision += 1
    for (const wake of [...waiters]) wake()
  }
  const bump = (): void => {
    if (lifetime.signal.aborted || pendingBump !== undefined) return
    pendingBump = setTimeout(flush, config.debounceMs)
  }

  ctx.effect(() => () => {
    lifetime.abort()
    if (pendingBump !== undefined) clearTimeout(pendingBump)
    for (const wake of [...waiters]) wake()
  }, 'session-capabilities: lifetime')

  // ---- change sources ----
  ctx.on('skills/change', bump)
  ctx.on('tools/change', bump)
  ctx.on('internal/status', (fiber) => {
    if (fiber.runtime?.name !== MCP_CLIENT_PLUGIN_NAME) return
    const serverName = (fiber.config as { serverName?: unknown } | undefined)?.serverName
    // A fresh load starts a fresh diagnostic history for that namespace.
    if (typeof serverName === 'string' && fiber.state === 1 /* LOADING */) tracker.reset(serverName)
    bump()
  }, { global: true })

  // mcp-client reports connection health only through its logger. Replay the
  // retained ring buffer, then follow new records for this plugin's lifetime.
  const logger = ctx.logger as unknown as {
    buffer?: readonly LogRecord[]
    exporter(exporter: { levels: Record<string, number>; export(message: LogRecord): void }): unknown
  }
  for (const record of logger.buffer ?? []) tracker.observe(record)
  logger.exporter({
    // Cordis levels count up with verbosity (ERROR 0, INFO 1, WARN 2, DEBUG 3);
    // 2 admits errors, infos, and the warnings that carry attempt failures.
    levels: { default: 2 },
    export(record) {
      if (tracker.observe(record)) bump()
    },
  })

  // ---- routes ----
  ctx.connection.fetch.register({
    path: SNAPSHOT_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const sessionId = new URL(request.url).searchParams.get('sessionId')
      if (sessionId === null || !SESSION_ID.test(sessionId)) {
        return json({ error: 'invalid sessionId' }, 400)
      }
      const signal = AbortSignal.any([request.signal, lifetime.signal])
      try {
        const snapshot = await collectSnapshot(ctx, sessionId as SessionId, revision, tracker, signal)
        return json(snapshot)
      } catch (error) {
        if (signal.aborted) return json({ error: 'aborted' }, 499)
        ctx.logger.warn(`session-capabilities: snapshot for ${sessionId} failed: ${String(error)}`)
        return json({ error: String(error) }, 500)
      }
    },
  })

  ctx.connection.fetch.register({
    path: RECONNECT_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let body: { sessionId?: unknown; serverName?: unknown }
      try {
        body = await request.json() as typeof body
      } catch {
        return json({ reloaded: 0, error: 'invalid JSON body' }, 400)
      }
      if (typeof body.sessionId !== 'string' || !SESSION_ID.test(body.sessionId)
        || typeof body.serverName !== 'string' || !SERVER_NAME.test(body.serverName)) {
        return json({ reloaded: 0, error: 'invalid sessionId or serverName' }, 400)
      }
      try {
        const result = await reconnectMcp(ctx, body.sessionId as SessionId, body.serverName, tracker,
          AbortSignal.any([request.signal, lifetime.signal]))
        bump()
        return json(result, result.reloaded === 0 ? 404 : 200)
      } catch (error) {
        return json({ reloaded: 0, error: String(error) }, 500)
      }
    },
  })

  ctx.connection.fetch.register({
    path: WAIT_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: (request) => {
      const since = Number(new URL(request.url).searchParams.get('since') ?? '0')
      const answer = (): Response => json({ revision } satisfies CapabilitiesRevision)
      if (!Number.isFinite(since) || since !== revision || lifetime.signal.aborted) {
        return Promise.resolve(answer())
      }
      return new Promise<Response>((resolve) => {
        const finish = (): void => {
          waiters.delete(finish)
          clearTimeout(timer)
          request.signal.removeEventListener('abort', finish)
          resolve(answer())
        }
        const timer = setTimeout(finish, WAIT_TIMEOUT_MS)
        waiters.add(finish)
        request.signal.addEventListener('abort', finish, { once: true })
      })
    },
  })
}
