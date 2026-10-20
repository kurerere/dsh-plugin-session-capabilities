# dsh-session-capabilities

[中文](./README.zh.md)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) plugin for the Web/Desktop
client: a docked **session details card** that shows the skills and MCP servers loaded for
the current Session. Open it from the icon at the top right of the Session header; it docks
in the right sidebar and the conversation column reflows beside it.

![Light](docs/screenshots/light.png)
![Dark](docs/screenshots/dark.png)

## What it shows

- **Summary** — number of skills, connected / active MCP servers, and MCP tools available.
- **MCP servers** — status dot (connected / connecting / failed / disabled), transport and
  tool count, expandable tool chips, the failure cause for a broken server, and a
  **Reconnect** button that reloads that mcp-client instance. Refresh and settings
  (opens the Plugins page) buttons sit on the section header.
- **Skills** — searchable list with scope chips (workspace / user / plugin / built-in),
  a "used in this session" filter and badge, and descriptions in the tooltip.
- Updates live: the Host pushes catalog changes over a long poll, and usage refreshes after
  each turn.

Everything is read-only except Reconnect. Endpoints are shown as a command basename or an
HTTP origin only — never arguments, env, headers, or query strings.

## Install

The package ships prebuilt `lib/`, so it installs straight from a directory or a git host:

```sh
# from a local checkout
dsh plugin --profile web add link:/absolute/path/to/dsh-session-capabilities

# from GitHub (once published)
dsh plugin --profile web add github:<owner>/dsh-session-capabilities
```

Then start `dsh --profile web` as usual. Check that the layer is composed with:

```sh
dsh --profile web --dump-config | grep -A2 'dsh-session-capabilities'
# == dsh-session-capabilities
# - id: session-capabilities
#   name: dsh-session-capabilities
```

Remove with `dsh plugin --profile web remove dsh-session-capabilities`.

## Development

```sh
pnpm install
node scripts/link-dsh-checkout.mjs /path/to/deepseek-harness   # optional: type against a local checkout
pnpm run check        # typecheck + build lib/ + verify artifacts
pnpm run types        # emit lib/types
```

Run it inside a deepseek-harness checkout without installing, using the dev overlay
(copy `dev/cordis.dev.yml.example` to `dev/cordis.dev.yml` and put in the absolute path):

```sh
cd /path/to/deepseek-harness
pnpm dsh --profile web --patch /abs/path/dsh-session-capabilities/dev/cordis.dev.yml --no-open
```

Use the explicit `--profile web --patch …` form. The `pnpm dsh web --patch …` shorthand has
failed in some setups; the explicit form is the one tested.

Screenshots are produced by `scripts/e2e-screenshot.mjs` against a running server with an
existing Session (no API key needed):

```sh
PLAYWRIGHT=/path/to/node_modules/playwright DSH_URL='http://127.0.0.1:3080/?token=…' \
  SESSION_TITLE='part of the session title' node scripts/e2e-screenshot.mjs docs/screenshots
```

## Compatibility

| | |
|---|---|
| Tested with | dsh **0.2.1-rc.2** (`687f282`), web profile, Chromium |
| Declared range | `engines.dsh: >=0.2.1-rc.2 <0.3.0` |
| Client | Web / Desktop only (no TUI view) |

## Known limitations

- The column width is the right sidebar's shared setting (default ≈45 % of the window).
  dsh exposes no API for a plugin to set it; drag the edge once and it sticks.
- dsh has no MCP status service: status is assembled from mcp-client instances, their
  config, the Session's tool list, and mcp-client log lines. If mcp-client rewords its
  logs, failure details degrade to fiber state only.
- Reconnect reloads the mcp-client plugin instance (mcp-client has no reconnect API).
- The settings gear opens the Plugins page; there is no dedicated MCP settings page.
- The star on skill rows is decorative (no favourites yet).
- Skill usage counts the current Session's log only (not sub-agent Sessions).

See [notes/design.md](notes/design.md) for the design decisions.

## License

[MIT](./LICENSE) © yy wan
