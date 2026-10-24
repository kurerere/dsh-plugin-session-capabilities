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
import type { Context } from '@deepseek-ai/cordis';
import { type ScopeKey } from '@deepseek-ai/dsh-scope';
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { ReconnectResult, CapabilitiesSnapshot, McpTransport, SkillScope } from '../shared.ts';
import type { McpLogTracker } from './mcp-log.ts';
/** Plugin name mcp-client exports; Cordis copies it onto the registry runtime. */
export declare const MCP_CLIENT_PLUGIN_NAME = "mcp-client";
/** Structural view of a Cordis fiber; private fields are read defensively. */
interface FiberLike {
    readonly state: number;
    readonly ctx: Context;
    readonly config?: unknown;
    readonly uid: number | null;
    readonly entry?: {
        readonly id?: string;
    };
    readonly _error?: unknown;
    readonly _config?: unknown;
    restart(): Promise<unknown>;
    update(config: unknown): void;
}
interface McpInstance {
    readonly serverName: string;
    readonly transport: McpTransport;
    readonly endpoint?: string;
    readonly state: number | 'disabled';
    readonly scope: ScopeKey | undefined;
    readonly entryId?: string;
    readonly error?: string;
    /** The live fiber, for reload; absent for disabled Loader rows. */
    readonly fiber?: FiberLike;
}
/** Resolved view one snapshot reads through. */
interface SessionView {
    cwd: string | undefined;
    agentPreset: string | undefined;
    scope: ScopeKey | undefined;
    skills: Context['skills'] | undefined;
    tools: Context['tools'] | undefined;
    /** Skill name → invocation count derived from the Session log. */
    invocations: Map<string, number>;
    events: readonly {
        readonly type: string;
        readonly data?: unknown;
    }[];
    release: () => Promise<void>;
}
/**
 * Fold the registry's open `SkillSource` vocabulary into UI groups.
 * @param source - raw registry source.
 * @returns the UI scope bucket.
 */
export declare function skillScopeOf(source: string): SkillScope;
/**
 * Enumerate mcp-client instances known to this Host.
 * @param ctx - plugin context (reads the root registry and optional loader).
 * @returns live fibers plus disabled Loader rows.
 */
export declare function listMcpInstances(ctx: Context): McpInstance[];
/**
 * Count skill uses recorded in the Session log: model calls of the `skill`
 * tool (`tool/call` with `{ name }` arguments) and user-explicit `/name`
 * invocations, which the Host injects as a message whose `source.kind` is
 * `skill-invocation`. Unknown event shapes are ignored.
 * @param events - the observed Session events.
 * @returns skill name → count.
 */
export declare function countSkillInvocations(events: readonly {
    readonly type: string;
    readonly data?: unknown;
}[]): Map<string, number>;
/** Count recorded MCP tool calls, including failed calls, using the same namespace ownership as the catalog. */
export declare function countMcpInvocations(events: readonly {
    readonly type: string;
    readonly data?: unknown;
}[], servers: readonly string[]): Map<string, number>;
/**
 * Resolve the Session's cwd, preset, scope, and the registries that serve it.
 * Mirrors `@deepseek-ai/dsh-api-session-controller`'s SessionSkillCatalog so
 * the panel shows what the `/` menu and the model see, without activating a
 * cold Agent.
 */
export declare function resolveView(ctx: Context, sessionId: SessionId, signal: AbortSignal): Promise<SessionView>;
/**
 * Build one Session's capability snapshot.
 * @param ctx - plugin context.
 * @param sessionId - target Session.
 * @param revision - Host catalog revision at read start.
 * @param tracker - folded mcp-client diagnostics.
 * @param signal - request cancellation.
 * @returns the JSON snapshot.
 */
export declare function collectSnapshot(ctx: Context, sessionId: SessionId, revision: number, tracker: McpLogTracker, signal: AbortSignal): Promise<CapabilitiesSnapshot>;
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
export declare function reconnectMcp(ctx: Context, sessionId: SessionId, serverName: string, tracker: McpLogTracker, signal: AbortSignal): Promise<ReconnectResult>;
export {};
