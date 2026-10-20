# dsh-session-capabilities — design notes

Tested against DeepSeek Harness **0.2.1-rc.2** (checkout `687f282`, web profile).
Goal: a docked "session details" card, opened from the Session header's top-right,
that shows the skills and MCP servers the current Session actually sees, without
patching the harness.

## 1. Where the card mounts

**Decision: a right-sidebar page tab** (`sidebarRightTabs.register({ kind: 'session-capabilities' })`
plus a `sidebar.right.pane.tab` slot body), toggled by an icon button in
`conversation.session.header.utilities`.

Why:
- The right sidebar's *push* presentation already docks inside the session pane and
  reflows the conversation column (no overlay, no custom layout code). This is the
  behaviour the mockup asks for.
- Tabs are per-Session, get the Session's `useSession` hook, and are listed in the
  sidebar's "+" guide, so the card is reachable even without the header button.
- The header toggle opens the tab, or collapses the column when our tab is already the
  active one. The open/closed choice is remembered per browser profile
  (`localStorage['dsh-session-capabilities.open.v1']`) and restored once per Session.
- Both mounts sit inside `ctx.inject(['sidebarRight', 'sidebarRightTabs'], …)`, so a
  composition without the right sidebar simply shows nothing instead of failing.

Alternatives considered:
- **Floating popover from the header button** — simplest, but it covers the transcript
  and does not reflow; rejected against the mockup.
- **A new layout column / `rightbar` occupant** — the `rightbar` seat is owned by
  `ui-sidebar-right`; replacing it would remove every other right-sidebar tab.
- **Inline block in the conversation (`conversation.session.*` slots)** — scrolls away
  with the transcript; not a "panel".
- **Main panel (`layout.selectPanel`)** — replaces the conversation entirely.

## 2. Host ↔ browser transport

**Decision: three exact Connection Fetch routes** registered with
`ctx.connection.fetch.register` (inside the Connection's trust/auth fence — owner Peers only;
unauthenticated requests get 401):

| Route | Method | Answer |
|---|---|---|
| `/api/session-capabilities.snapshot?sessionId=<id>` | GET | `CapabilitiesSnapshot` |
| `/api/session-capabilities.wait?since=<revision>` | GET | `{ revision }` (long poll, ≤25 s) |
| `/api/session-capabilities.reconnect` `{ sessionId, serverName }` | POST | `{ reloaded, error? }` (404 when nothing matched, 400 on bad input) |

Why not a Typert Remote: Remote contracts are generated into the shipped `api-remotes`
assembly; an out-of-tree package cannot add one. Fetch routes are the supported
extension point for plugins.

The Host keeps a catalog **revision**, bumped (debounced 150 ms) on `skills/change`,
`tools/change`, mcp-client fiber status transitions (`internal/status`), and new
mcp-client diagnostics. The browser model runs one shared long-poll loop for all
watched Sessions and refetches snapshots when the revision moves; if `wait` fails it
degrades to 5 s polling and retries the long poll. Snapshots are also refetched when a
turn settles (skill usage grows per turn, not per catalog change).

## 3. Skills

- Source: the `skills` registry (`@deepseek-ai/dsh-skill`) **through the Session's
  agent-preset view** (`agentPresets.serviceFor(liveAgent, 'skills')`) when the Session
  has a live Agent, otherwise the root registry — read with the Session's cwd and scope,
  mirroring the session controller's `SessionSkillCatalog`, so the card lists what the
  `/` menu and the model see without activating a cold Agent.
- Scope chips (工作区/用户/插件/内置/自定义) fold the registry's open `SkillSource` string.
- "Enabled" = model-invocable; the registry has no separate on/off switch, so
  `disable-model-invocation` skills are shown muted as user-only.
- **Usage ("已用", "本会话已用 N")** is counted from the Session log: model `skill`
  tool calls (`tool/call` with `{ name }`) plus user `/name` invocations (messages with
  `source.kind === 'skill-invocation'`). Unknown event shapes are ignored.

## 4. MCP servers

There is **no MCP status service** in dsh 0.2.x, so status is assembled from:

1. **mcp-client instances** — Cordis registry fibers whose runtime is `mcp-client`
   (Loader rows and programmatic `ctx.plugin` mounts, global or preset-mounted), plus
   disabled Loader rows that have no fiber (shown as 已停用).
2. **Config** — `serverName`, transport, and a *safe* endpoint hint (stdio command
   basename or HTTP origin; never args, env, headers, or query strings).
3. **Tool list** — the Session's `tools` view filtered by the `mcp__<server>__`
   namespace; tool count and chip names come from here. Tools with no owning instance
   appear as a "tools-only" server.
4. **Log lines** — mcp-client reports retries / give-ups / sync failures only via
   `ctx.logger` (`mcp-client(<name>): …`). `McpLogTracker` replays the logger ring buffer
   and follows new records with a lifecycle-owned exporter, folding them into a
   per-server phase + last error.

Status = fiber state + folded phase (+ tools present ⇒ connected). The card shows the
error's cause (text before the first " — ", `Error:` prefix stripped) and keeps the full
text in the tooltip.

**Reconnect**: mcp-client has no reconnect API; its own give-up message says "reload the
plugin or restart the Host". The route does exactly that through the fiber —
`restart()` for a live instance, `update(config)` for a failed one — and resets that
server's diagnostics. Verified against an unreachable stdio server: `{"reloaded":1}`
(HTTP 200); unknown server → `{"reloaded":0}` (404); malformed body → 400.

## 5. Settings gear

There is no MCP settings route/page in 0.2.x, so the gear opens the shipped **Plugins**
main panel (`layout.selectPanel('plugins')`), where mcp-client rows live. The gear is
hidden when the composition has no `layout` service.

## 6. Known gaps

- **Column width** is the right sidebar's shared preference (default 45 % of the frame,
  min 300 px). `ctx.layout` exposes no width setter, so the plugin does not narrow it to
  the mockup's ~25 %; users drag the edge once and the width sticks for all tabs.
- **Star icon** on skill rows is decorative; there is no favourites store.
- No `sse` transport detection (current mcp-client ships stdio and streamable-http only).
- Status relies on mcp-client's log wording; a reworded log line degrades to
  fiber-state-only status (still correct for connected/disabled, less precise for failures).
- Skill usage counts only what the Session log records; skills used by sub-agents in
  their own Sessions are not attributed to the parent.
- Web/Desktop client only (`dsh.client.platform: web`); no TUI view.
- The browser face is built with a local esbuild script mirroring the monorepo's
  client bundler; it must track `PLATFORM_MODULES` if a future dsh changes it.
