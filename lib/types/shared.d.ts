/**
 * Wire contract shared by the Host face and the browser face.
 *
 * Everything here is plain JSON data plus route constants, so both builds can
 * inline it without sharing any runtime identity.
 */
/** Exact Connection Fetch route returning one Session's capability snapshot. */
export declare const SNAPSHOT_PATH = "/api/session-capabilities.snapshot";
/** Exact Connection Fetch route that long-polls for the next catalog revision. */
export declare const WAIT_PATH = "/api/session-capabilities.wait";
/** Exact Connection Fetch route (POST `{ sessionId, serverName }`) that reloads one mcp-client instance. */
export declare const RECONNECT_PATH = "/api/session-capabilities.reconnect";
/** Document-relative forms the browser fetches (the page may live under a mount prefix). */
export declare const SNAPSHOT_ROUTE: string;
export declare const WAIT_ROUTE: string;
export declare const RECONNECT_ROUTE: string;
/** Upper bound the Host holds one wait request open before answering "unchanged". */
export declare const WAIT_TIMEOUT_MS = 25000;
/** Where a skill came from, folded from the registry's open `SkillSource` string. */
export type SkillScope = 'workspace' | 'user' | 'builtin' | 'plugin' | 'custom';
/** One skill visible to the Session's composition. */
export interface CapabilitySkill {
    /** Kebab-case skill name. */
    readonly name: string;
    /** Routing description (may be long; the UI truncates). */
    readonly description: string;
    /** Optional extra routing guidance. */
    readonly whenToUse?: string;
    /** Raw registry source, e.g. `project-dsh`, `user-agents`, `bundled`, `runtime`. */
    readonly source: string;
    /** UI grouping derived from `source`. */
    readonly scope: SkillScope;
    /** Provider that owns the skill body. */
    readonly provider: string;
    /** Whether the model catalog advertises this skill. */
    readonly modelInvocable: boolean;
    /** Whether the `/` command menu offers this skill. */
    readonly userInvocable: boolean;
    /**
     * Convenience flag: the skill is usable by the model in this Session.
     * The registry has no separate on/off switch; a skill hidden from the model
     * (`disable-model-invocation`) is reported as not enabled.
     */
    readonly enabled: boolean;
    /** How often this Session invoked the skill (model `skill` tool calls plus user `/name` invocations). */
    readonly invocations: number;
}
/** Connection status of one MCP server as observed by the Host. */
export type McpStatus = 'connected' | 'connecting' | 'failed' | 'disabled';
/** MCP transport label; `sse` is reserved for transports the current mcp-client does not ship. */
export type McpTransport = 'stdio' | 'http' | 'sse' | 'unknown';
/** Where the Host learned about one MCP server. */
export type McpOrigin = 
/** A host-level mcp-client plugin instance (Loader row or programmatic `ctx.plugin`). */
'global'
/** An mcp-client instance mounted by the Session's agent-preset composition. */
 | 'preset'
/** Only `mcp__<server>__*` tools were found; no mcp-client instance owns them. */
 | 'tools-only';
/** One MCP server visible to the Session. */
export interface CapabilityMcpServer {
    /** Configured `serverName` (the tool namespace). */
    readonly serverName: string;
    readonly transport: McpTransport;
    readonly status: McpStatus;
    readonly origin: McpOrigin;
    /** Loader entry id when the instance came from a cordis row. */
    readonly entryId?: string;
    /** Safe endpoint hint: stdio command basename or HTTP origin (never args, env, headers, or query). */
    readonly endpoint?: string;
    /** Number of this server's tools visible to the Session. */
    readonly toolCount: number;
    /** Raw MCP tool names (the `mcp__<server>__` prefix removed), sorted. */
    readonly tools: readonly string[];
    /** Last error the Host observed for this server, when any. */
    readonly error?: string;
    /** Whether the Host can reload this instance (an mcp-client fiber it owns, not a disabled row or tools-only bridge). */
    readonly reconnectable: boolean;
}
/** Complete answer of the snapshot route. */
export interface CapabilitiesSnapshot {
    readonly sessionId: string;
    /** Host catalog revision this snapshot was computed at. */
    readonly revision: number;
    /** Epoch milliseconds. */
    readonly generatedAt: number;
    /** Working directory used for project-scoped skill discovery, when known. */
    readonly cwd?: string;
    /** Agent preset recorded for the Session, when any. */
    readonly agentPreset?: string;
    readonly skills: readonly CapabilitySkill[];
    /** False when a skill provider failed or the catalog changed mid-read. */
    readonly skillsComplete: boolean;
    /** Set when no skill registry could serve this Session. */
    readonly skillsError?: string;
    readonly mcpServers: readonly CapabilityMcpServer[];
    /** Set when the tool registry was unavailable. */
    readonly mcpError?: string;
}
/** Answer of the reconnect route. */
export interface ReconnectResult {
    /** Number of mcp-client instances reloaded (0 when none matched). */
    readonly reloaded: number;
    readonly error?: string;
}
/** Answer of the wait route. */
export interface CapabilitiesRevision {
    readonly revision: number;
}
