/**
 * Read-only projection of the skills and MCP servers one Session sees.
 *
 * Sources (all existing Host services; nothing is rediscovered here):
 * - skills: the `skills` registry (`@deepseek-ai/dsh-skill`), through the
 *   Session's agent-preset view when one is mounted, read with the Session's
 *   cwd and scope exactly like the built-in `skills/list` Remote;
 * - MCP tools: the `tools` registry view for the same scope, filtered to the
 *   `mcp__<serverName>__` namespace mcp-client guarantees;
 * - MCP instances: Cordis registry fibers of the `mcp-client` plugin (Loader
 *   rows and programmatic `ctx.plugin` mounts alike), plus disabled Loader
 *   rows that have no fiber;
 * - MCP errors: {@link McpLogTracker}, fed by mcp-client's own log records.
 */

import type { Context } from '@deepseek-ai/cordis'
import { scopeChainOf, scopeOf, type ScopeKey } from '@deepseek-ai/dsh-scope'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-working-directory'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  ReconnectResult,
  CapabilitiesSnapshot, CapabilityMcpServer, CapabilitySkill, McpOrigin, McpStatus, McpTransport, SkillScope,
} from '../shared.ts'
import type { McpLogTracker } from './mcp-log.ts'

/** Plugin name mcp-client exports; Cordis copies it onto the registry runtime. */
export const MCP_CLIENT_PLUGIN_NAME = 'mcp-client'

/** Loader module specifiers that denote mcp-client rows. */
const MCP_CLIENT_MODULE = /(?:^|\/)dsh-mcp-client(?:\/lib\/index\.js)?$/

/** Runtime mirror of Cordis's const enum `FiberState`. */
const FIBER = { PENDING: 0, LOADING: 1, ACTIVE: 2, FAILED: 3, DISPOSED: 4, UNLOADING: 5 } as const

/** Structural view of a Cordis fiber; private fields are read defensively. */
interface FiberLike {
  readonly state: number
  readonly ctx: Context
  readonly config?: unknown
  readonly uid: number | null
  readonly entry?: { readonly id?: string }
  readonly _error?: unknown
  readonly _config?: unknown
  restart(): Promise<unknown>
  update(config: unknown): void
}

interface RuntimeLike {
  readonly name?: string
  readonly fibers: Iterable<FiberLike>
}

interface McpInstance {
  readonly serverName: string
  readonly transport: McpTransport
  readonly endpoint?: string
  readonly state: number | 'disabled'
  readonly scope: ScopeKey | undefined
  readonly entryId?: string
  readonly error?: string
  /** The live fiber, for reload; absent for disabled Loader rows. */
  readonly fiber?: FiberLike
}

/** Resolved view one snapshot reads through. */
interface SessionView {
  cwd: string | undefined
  agentPreset: string | undefined
  scope: ScopeKey | undefined
  skills: Context['skills'] | undefined
  tools: Context['tools'] | undefined
  /** Skill name → invocation count derived from the Session log. */
  invocations: Map<string, number>
  events: readonly { readonly type: string; readonly data?: unknown }[]
  release: () => Promise<void>
}

function messageOf(error: unknown): string {
  try {
    if (error instanceof Error) return error.message
    return String(error)
  } catch {
    return '[unrenderable error]'
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
}

/**
 * Fold the registry's open `SkillSource` vocabulary into UI groups.
 * @param source - raw registry source.
 * @returns the UI scope bucket.
 */
export function skillScopeOf(source: string): SkillScope {
  if (source.startsWith('project-')) return 'workspace'
  if (source.startsWith('user-')) return 'user'
  if (source === 'bundled') return 'builtin'
  if (source === 'custom') return 'custom'
  // `runtime` skills are registered by plugins through ctx.skills.register();
  // unknown third-party sources come from plugin-owned providers as well.
  return 'plugin'
}

function toSkill(skill: SkillSummary, invocations: ReadonlyMap<string, number>): CapabilitySkill {
  return {
    name: skill.name,
    description: skill.description,
    ...skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse },
    source: skill.source,
    scope: skillScopeOf(skill.source),
    provider: skill.provider,
    modelInvocable: skill.invocation.modelInvocable,
    userInvocable: skill.invocation.userInvocable,
    enabled: skill.invocation.modelInvocable,
    invocations: invocations.get(skill.name) ?? 0,
  }
}

/** Safe endpoint hint: never args, env, headers, credentials, or query strings. */
function endpointOf(config: Record<string, unknown>): string | undefined {
  if (config.transport === 'stdio' && typeof config.command === 'string') {
    const parts = config.command.split(/[\\/]/)
    return parts[parts.length - 1] || undefined
  }
  if (typeof config.url === 'string') {
    try {
      const url = new URL(config.url)
      return `${url.protocol}//${url.host}`
    } catch {
      return undefined
    }
  }
  return undefined
}

function transportOf(config: Record<string, unknown>): McpTransport {
  switch (config.transport) {
    case 'stdio': return 'stdio'
    case 'streamable-http': return 'http'
    case 'http': return 'http'
    case 'sse': return 'sse'
    default: return 'unknown'
  }
}

/**
 * Enumerate mcp-client instances known to this Host.
 * @param ctx - plugin context (reads the root registry and optional loader).
 * @returns live fibers plus disabled Loader rows.
 */
export function listMcpInstances(ctx: Context): McpInstance[] {
  const instances: McpInstance[] = []
  const registry = (ctx as unknown as { registry: { values(): Iterable<RuntimeLike> } }).registry
  for (const runtime of registry.values()) {
    if (runtime.name !== MCP_CLIENT_PLUGIN_NAME) continue
    for (const fiber of runtime.fibers) {
      if (fiber.uid === null || fiber.state === FIBER.DISPOSED) continue
      const config = asRecord(fiber.config)
      if (config === undefined || typeof config.serverName !== 'string') continue
      const endpoint = endpointOf(config)
      instances.push({
        serverName: config.serverName,
        transport: transportOf(config),
        ...endpoint === undefined ? {} : { endpoint },
        state: fiber.state,
        scope: scopeOf(fiber.ctx),
        ...typeof fiber.entry?.id === 'string' ? { entryId: fiber.entry.id } : {},
        ...fiber.state === FIBER.FAILED && fiber._error !== undefined ? { error: messageOf(fiber._error) } : {},
        fiber,
      })
    }
  }
  const loader = ctx.get('loader')
  if (loader !== undefined) {
    for (const entry of loader.entries()) {
      if (entry.options.group || !MCP_CLIENT_MODULE.test(entry.options.name)) continue
      if (!entry.disabled || entry.fiber !== undefined) continue
      const config = asRecord(entry.options.config) ?? {}
      const serverName = typeof config.serverName === 'string' ? config.serverName : entry.options.id
      const endpoint = endpointOf(config)
      instances.push({
        serverName,
        transport: transportOf(config),
        ...endpoint === undefined ? {} : { endpoint },
        state: 'disabled',
        scope: undefined,
        entryId: entry.id,
      })
    }
  }
  return instances
}

/**
 * Derive status and error from fiber state and folded diagnostics.
 * @returns the status pair shown in the UI.
 */
function statusOf(instance: McpInstance, toolCount: number, tracker: McpLogTracker): { status: McpStatus; error?: string } {
  if (instance.state === 'disabled') return { status: 'disabled' }
  switch (instance.state) {
    case FIBER.FAILED:
      return { status: 'failed', ...instance.error === undefined ? {} : { error: instance.error } }
    case FIBER.PENDING:
    case FIBER.LOADING:
    case FIBER.UNLOADING: {
      const log = tracker.get(instance.serverName)
      return { status: 'connecting', ...log?.error === undefined ? {} : { error: log.error } }
    }
    default: {
      const log = tracker.get(instance.serverName)
      if (log === undefined || log.phase === 'ok') return { status: 'connected' }
      if (log.phase === 'gave-up') return { status: 'failed', ...log.error === undefined ? {} : { error: log.error } }
      if (log.phase === 'retrying') return { status: 'connecting', ...log.error === undefined ? {} : { error: log.error } }
      // sync-failed: the transport is up; without tools the server is effectively unusable.
      return { status: toolCount > 0 ? 'connected' : 'failed', ...log.error === undefined ? {} : { error: log.error } }
    }
  }
}

/** Split visible tool names into `server → raw tool names`, longest server namespace first. */
function groupMcpTools(names: readonly string[], servers: readonly string[]): { byServer: Map<string, string[]>; orphans: Map<string, string[]> } {
  const ordered = [...new Set(servers)].sort((a, b) => b.length - a.length)
  const byServer = new Map<string, string[]>(ordered.map(server => [server, []]))
  const orphans = new Map<string, string[]>()
  for (const name of names) {
    if (!name.startsWith('mcp__')) continue
    const owner = ordered.find(server => name.startsWith(`mcp__${server}__`))
    if (owner !== undefined) {
      byServer.get(owner)?.push(name.slice(`mcp__${owner}__`.length))
      continue
    }
    const match = /^mcp__(.+?)__(.+)$/.exec(name)
    if (match === null) continue
    const list = orphans.get(match[1] as string) ?? []
    list.push(match[2] as string)
    orphans.set(match[1] as string, list)
  }
  return { byServer, orphans }
}

/**
 * Count skill uses recorded in the Session log: model calls of the `skill`
 * tool (`tool/call` with `{ name }` arguments) and user-explicit `/name`
 * invocations, which the Host injects as a message whose `source.kind` is
 * `skill-invocation`. Unknown event shapes are ignored.
 * @param events - the observed Session events.
 * @returns skill name → count.
 */
export function countSkillInvocations(events: readonly { readonly type: string; readonly data?: unknown }[]): Map<string, number> {
  const counts = new Map<string, number>()
  const add = (name: unknown): void => {
    if (typeof name === 'string' && name.length > 0) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  for (const event of events) {
    const data = asRecord(event.data)
    if (data === undefined) continue
    if (event.type === 'tool/call') {
      if (data.name !== 'skill' || typeof data.arguments !== 'string') continue
      try {
        add(asRecord(JSON.parse(data.arguments))?.name)
      } catch {
        // Malformed model arguments: not a recorded invocation.
      }
      continue
    }
    const source = asRecord(asRecord(data.message)?.source) ?? asRecord(data.source)
    if (source?.kind === 'skill-invocation') add(source.name)
  }
  return counts
}

/** Count recorded MCP tool calls, including failed calls, using the same namespace ownership as the catalog. */
export function countMcpInvocations(events: readonly { readonly type: string; readonly data?: unknown }[], servers: readonly string[]): Map<string, number> {
  const calls: string[] = []
  for (const event of events) {
    const name = asRecord(event.data)?.name
    if (event.type === 'tool/call' && typeof name === 'string' && /^mcp__.+__.+$/.test(name)) calls.push(name)
  }
  const { byServer } = groupMcpTools(calls, servers)
  return new Map([...byServer].map(([server, tools]) => [server, tools.length]))
}

const STATUS_ORDER: Record<McpStatus, number> = { failed: 0, connecting: 1, connected: 2, disabled: 3 }

/**
 * Resolve the Session's cwd, preset, scope, and the registries that serve it.
 * Mirrors `@deepseek-ai/dsh-api-session-controller`'s SessionSkillCatalog so
 * the panel shows what the `/` menu and the model see, without activating a
 * cold Agent.
 */
export async function resolveView(ctx: Context, sessionId: SessionId, signal: AbortSignal): Promise<SessionView> {
  let cwd: string | undefined
  let agentPreset: string | undefined
  let invocations = new Map<string, number>()
  let events: SessionView['events'] = []
  const sessionQuery = ctx.get('sessionQuery')
  if (sessionQuery !== undefined) {
    try {
      const observation = await sessionQuery.observeSession(sessionId, { signal })
      try {
        const values = asRecord(observation.projections?.values)
        const projectedCwd = values?.workingDirectory
        cwd = typeof projectedCwd === 'string' ? projectedCwd : observation.header.cwd ?? undefined
        const preset = values?.agentPreset
        agentPreset = typeof preset === 'string' ? preset : undefined
        invocations = countSkillInvocations(observation.events)
        events = observation.events
      } finally {
        observation[Symbol.dispose]()
      }
    } catch {
      // A blank or unknown Session still gets the default composition's view.
    }
  }
  const workingDirectory = ctx.get('workingDirectory')
  cwd ??= workingDirectory?.defaultDirectory
  const live = ctx.get('agents')?.get(sessionId)
  if (live !== undefined && workingDirectory !== undefined) {
    try {
      cwd = await workingDirectory.ensure(live, signal)
    } catch {
      // Keep the projected cwd.
    }
  }
  const presets = ctx.get('agentPresets')
  let lease: ({ key: ScopeKey } & AsyncDisposable) | undefined
  if (live === undefined && presets !== undefined) {
    try {
      lease = await presets.acquireScope(agentPreset)
    } catch {
      lease = undefined
    }
  }
  const skills = (live === undefined ? undefined : presets?.serviceFor(live, 'skills')) ?? ctx.get('skills')
  const tools = (live === undefined ? undefined : presets?.serviceFor(live, 'tools')) ?? ctx.get('tools')
  return {
    cwd,
    agentPreset,
    scope: live ?? lease?.key,
    skills,
    tools,
    invocations,
    events,
    release: async () => { await lease?.[Symbol.asyncDispose]() },
  }
}

/**
 * Build one Session's capability snapshot.
 * @param ctx - plugin context.
 * @param sessionId - target Session.
 * @param revision - Host catalog revision at read start.
 * @param tracker - folded mcp-client diagnostics.
 * @param signal - request cancellation.
 * @returns the JSON snapshot.
 */
export async function collectSnapshot(
  ctx: Context,
  sessionId: SessionId,
  revision: number,
  tracker: McpLogTracker,
  signal: AbortSignal,
): Promise<CapabilitiesSnapshot> {
  const view = await resolveView(ctx, sessionId, signal)
  try {
    // ---- skills ----
    let skills: CapabilitySkill[] = []
    let skillsComplete = true
    let skillsError: string | undefined
    if (view.skills === undefined) {
      skillsError = 'skill registry is not mounted in this composition'
    } else {
      try {
        const snapshot = await view.skills.snapshot({ cwd: view.cwd, scope: view.scope, signal })
        skills = snapshot.skills.map(skill => toSkill(skill, view.invocations))
        skillsComplete = snapshot.complete
      } catch (error) {
        skillsError = messageOf(error)
      }
    }

    // ---- MCP ----
    let mcpError: string | undefined
    let toolNames: string[] = []
    if (view.tools === undefined) {
      mcpError = 'tool registry is not mounted in this composition'
    } else {
      try {
        toolNames = view.tools.schemas(view.scope).map(schema => schema.name)
      } catch (error) {
        mcpError = messageOf(error)
      }
    }
    const chain = new Set<ScopeKey>(scopeChainOf(view.scope))
    const instances = listMcpInstances(ctx)
      .filter(instance => instance.scope === undefined || chain.has(instance.scope))
    const { byServer, orphans } = groupMcpTools(toolNames, instances.map(instance => instance.serverName))
    const mcpInvocations = countMcpInvocations(view.events, [...byServer.keys(), ...orphans.keys()])
    const servers: CapabilityMcpServer[] = []
    const seen = new Set<string>()
    // A preset instance shadows a global one with the same namespace; visit nearest first.
    const nearestFirst = [...instances].sort((a, b) => Number(b.scope !== undefined) - Number(a.scope !== undefined))
    for (const instance of nearestFirst) {
      if (seen.has(instance.serverName)) continue
      seen.add(instance.serverName)
      const tools = (byServer.get(instance.serverName) ?? []).sort()
      const { status, error } = statusOf(instance, tools.length, tracker)
      const origin: McpOrigin = instance.scope === undefined ? 'global' : 'preset'
      servers.push({
        serverName: instance.serverName,
        invocations: mcpInvocations.get(instance.serverName) ?? 0,
        transport: instance.transport,
        status,
        origin,
        ...instance.entryId === undefined ? {} : { entryId: instance.entryId },
        ...instance.endpoint === undefined ? {} : { endpoint: instance.endpoint },
        toolCount: status === 'disabled' ? 0 : tools.length,
        tools: status === 'disabled' ? [] : tools,
        ...error === undefined ? {} : { error },
        reconnectable: instance.fiber !== undefined,
      })
    }
    for (const [serverName, tools] of orphans) {
      if (seen.has(serverName)) continue
      servers.push({
        serverName,
        invocations: mcpInvocations.get(serverName) ?? 0,
        transport: 'unknown',
        status: 'connected',
        origin: 'tools-only',
        toolCount: tools.length,
        tools: tools.sort(),
        reconnectable: false,
      })
    }
    servers.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.serverName.localeCompare(b.serverName))

    return {
      sessionId,
      revision,
      generatedAt: Date.now(),
      ...view.cwd === undefined ? {} : { cwd: view.cwd },
      ...view.agentPreset === undefined ? {} : { agentPreset: view.agentPreset },
      skills,
      skillsComplete,
      ...skillsError === undefined ? {} : { skillsError },
      mcpServers: servers,
      ...mcpError === undefined ? {} : { mcpError },
    }
  } finally {
    await view.release()
  }
}

/**
 * Reload the mcp-client instance(s) named `serverName` that this Session sees.
 *
 * mcp-client has no reconnect API; after its supervisor gives up, its own
 * diagnostic says "reload the plugin or restart the Host". This performs
 * exactly that reload through the Cordis fiber: `restart()` for a live
 * instance, `update(config)` for a failed one (which clears the failure).
 * @param ctx - plugin context.
 * @param sessionId - Session whose view selects global and preset instances.
 * @param serverName - MCP namespace to reload.
 * @param tracker - diagnostics to reset for that namespace.
 * @param signal - request cancellation.
 * @returns how many instances were reloaded.
 */
export async function reconnectMcp(
  ctx: Context,
  sessionId: SessionId,
  serverName: string,
  tracker: McpLogTracker,
  signal: AbortSignal,
): Promise<ReconnectResult> {
  const view = await resolveView(ctx, sessionId, signal)
  try {
    const chain = new Set<ScopeKey>(scopeChainOf(view.scope))
    const targets = listMcpInstances(ctx).filter(instance => instance.serverName === serverName
      && instance.fiber !== undefined
      && (instance.scope === undefined || chain.has(instance.scope)))
    tracker.reset(serverName)
    let reloaded = 0
    for (const { fiber } of targets) {
      if (fiber === undefined) continue
      if (fiber.state === FIBER.FAILED) {
        fiber.update(fiber._config ?? fiber.config)
      } else {
        // Do not await the whole reconnect: mcp-client's apply blocks on the
        // first connection attempt; status changes stream through the wait route.
        void fiber.restart().catch((error: unknown) => {
          ctx.logger.warn(`session-capabilities: reload of mcp-client(${serverName}) failed: ${messageOf(error)}`)
        })
      }
      reloaded += 1
    }
    return { reloaded }
  } finally {
    await view.release()
  }
}
