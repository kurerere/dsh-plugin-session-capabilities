/**
 * dsh-session-capabilities — Host face.
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
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
export type * from './shared.ts';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "session-capabilities";
/**
 * Hard dependency: the Connection's exact Fetch-route registry. Every other
 * source (skills, tools, agents, sessionQuery, workingDirectory, agentPresets,
 * loader) is optional and read per request with `ctx.get`, so the plugin still
 * mounts — and reports what is missing — in slimmer compositions.
 */
export declare const inject: string[];
export interface Config {
    /** Coalescing window for change notifications, in milliseconds. */
    debounceMs: number;
}
export declare const Config: Schema<Config>;
/**
 * Plugin body.
 * @param ctx - Host plugin context.
 * @param config - resolved configuration.
 */
export declare function apply(ctx: Context, config: Config): void;
