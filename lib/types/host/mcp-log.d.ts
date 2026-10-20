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
'retrying'
/** The supervisor stopped for good (attempt budget exhausted or unsafe close). */
 | 'gave-up'
/** The connection is up but the latest tool (re)sync failed. */
 | 'sync-failed'
/** The connection recovered after failures. */
 | 'ok';
/** Last observed diagnostic for one server namespace. */
export interface McpLogState {
    readonly phase: McpLogPhase;
    /** Human-readable error text, when the record carried one. */
    readonly error?: string;
    readonly at: number;
}
/** Minimal shape of a Cordis log record. */
export interface LogRecord {
    readonly type: string;
    readonly args: readonly unknown[];
    readonly ts?: number;
}
/**
 * Classify one mcp-client log line.
 * @param record - a Cordis log record.
 * @returns the server namespace and its folded state, or undefined for unrelated or uninformative lines.
 */
export declare function classifyMcpLog(record: LogRecord): {
    server: string;
    state: McpLogState;
} | undefined;
/** Per-server folded diagnostics. */
export declare class McpLogTracker {
    private readonly states;
    /**
     * Fold one record.
     * @param record - a Cordis log record.
     * @returns whether a tracked state changed.
     */
    observe(record: LogRecord): boolean;
    /** Forget a server, e.g. when its instance starts loading again. */
    reset(server: string): void;
    get(server: string): McpLogState | undefined;
}
