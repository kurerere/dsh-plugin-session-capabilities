/**
 * Passive observer of `@deepseek-ai/dsh-mcp-client` connection diagnostics.
 *
 * mcp-client exposes no status service: its connection supervisor reports
 * attempts, reconnects, and give-ups only through `ctx.logger` with the stable
 * `mcp-client(<serverName>): ...` label. This module reads those records
 * (the Logger ring buffer for history, a lifecycle-owned exporter for new
 * records) and folds them into a per-server phase. It never mutates the
 * client and never imports it.
 */

/** Folded connection phase derived from the newest relevant log record. */
export type McpLogPhase =
  /** A connection attempt failed and the supervisor is (or will be) retrying. */
  | 'retrying'
  /** The supervisor stopped for good (attempt budget exhausted or unsafe close). */
  | 'gave-up'
  /** The connection is up but the latest tool (re)sync failed. */
  | 'sync-failed'
  /** The connection recovered after failures. */
  | 'ok'

/** Last observed diagnostic for one server namespace. */
export interface McpLogState {
  readonly phase: McpLogPhase
  /** Human-readable error text, when the record carried one. */
  readonly error?: string
  readonly at: number
}

/** Minimal shape of a Cordis log record. */
export interface LogRecord {
  readonly type: string
  readonly args: readonly unknown[]
  readonly ts?: number
}

const LABEL = /^mcp-client\(([A-Za-z0-9_-]{1,32})\): ([\s\S]*)$/

/** Hard cap on retained error text so a noisy server cannot bloat snapshots. */
const MAX_ERROR_CHARS = 600

function clip(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > MAX_ERROR_CHARS ? `${trimmed.slice(0, MAX_ERROR_CHARS)}…` : trimmed
}

/**
 * Classify one mcp-client log line.
 * @param record - a Cordis log record.
 * @returns the server namespace and its folded state, or undefined for unrelated or uninformative lines.
 */
export function classifyMcpLog(record: LogRecord): { server: string; state: McpLogState } | undefined {
  const head = record.args[0]
  if (typeof head !== 'string') return undefined
  const match = LABEL.exec(head)
  if (match === null) return undefined
  const server = match[1] as string
  const body = match[2] as string
  const at = typeof record.ts === 'number' ? record.ts : Date.now()
  if (body.startsWith('connection attempt failed:')) {
    return { server, state: { phase: 'retrying', error: clip(body.slice('connection attempt failed:'.length)), at } }
  }
  if (body.startsWith('giving up after') || body.startsWith('failed generation could not confirm')) {
    return { server, state: { phase: 'gave-up', error: clip(body), at } }
  }
  if (body.startsWith('tool registration failed') || body.startsWith('tool re-sync failed')) {
    return { server, state: { phase: 'sync-failed', error: clip(body), at } }
  }
  if (body.startsWith('reconnected')) {
    return { server, state: { phase: 'ok', at } }
  }
  if (record.type === 'error') {
    // Any other error line still carries actionable text for the UI.
    return { server, state: { phase: 'sync-failed', error: clip(body), at } }
  }
  return undefined
}

/** Per-server folded diagnostics. */
export class McpLogTracker {
  private readonly states = new Map<string, McpLogState>()

  /**
   * Fold one record.
   * @param record - a Cordis log record.
   * @returns whether a tracked state changed.
   */
  observe(record: LogRecord): boolean {
    const classified = classifyMcpLog(record)
    if (classified === undefined) return false
    const previous = this.states.get(classified.server)
    // The ring buffer replay may hand us records older than live ones.
    if (previous !== undefined && previous.at > classified.state.at) return false
    let state = classified.state
    // "giving up" names no cause; keep the root cause from the last failed attempt in front.
    if (state.phase === 'gave-up' && previous?.phase === 'retrying' && previous.error !== undefined) {
      state = { ...state, error: clip(`${previous.error} — ${state.error ?? ''}`) }
    }
    this.states.set(classified.server, state)
    return true
  }

  /** Forget a server, e.g. when its instance starts loading again. */
  reset(server: string): void {
    this.states.delete(server)
  }

  get(server: string): McpLogState | undefined {
    return this.states.get(server)
  }
}
