/**
 * Mount-agnostic "session details" card: summary tiles, MCP servers, skills.
 *
 * Pure props in — no ctx, no subscriptions — so the right-sidebar tab renders
 * it today and any other mount (a header popover, a different dock) can
 * render the same component by passing the same props.
 */

import { useId, useMemo, useState } from 'react'
import {
  IconChevronRightOutlineRegular, IconRefreshOutlineRegular, IconSearchOutlineRegular, IconSettingsOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { CapabilitiesSnapshot, CapabilityMcpServer, CapabilitySkill, McpStatus, SkillScope } from '../shared.ts'
import type { SessionCapabilitiesEntry } from './model.ts'
import type { NS } from './locales.ts'

export interface SessionDetailsCardProps {
  /** The Session's model entry (undefined before the first fetch starts). */
  entry: SessionCapabilitiesEntry | undefined
  t: TranslateNS<typeof NS>
  /** Force a refetch. */
  onRefresh: () => void
  /** Reload one MCP server instance; resolves whether the Host accepted it. */
  onReconnect: (serverName: string) => Promise<boolean>
  /** Open the place MCP servers are configured; omitted when the shell has none. */
  onOpenSettings?: (() => void) | undefined
}

/** Rows shown before "View all". */
const SKILL_PREVIEW = 5
/** Tool chips shown before "+N". */
const TOOL_PREVIEW = 4
/** The search box appears once the list is long enough to need it. */
const SEARCH_THRESHOLD = 6

type SkillFilter = 'all' | 'used' | SkillScope

const SCOPE_FILTERS: readonly SkillScope[] = ['workspace', 'user', 'plugin', 'builtin', 'custom']
const SCOPE_RANK: Record<SkillScope, number> = { workspace: 0, user: 1, plugin: 2, custom: 3, builtin: 4 }

function StarIcon() {
  return (
    <svg className="dshsc-skillIcon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
      <path d="M8 1.5l1.8 3.7 4 .6-2.9 2.8.7 4L8 10.7 4.4 12.6l.7-4L2.2 5.8l4-.6z" strokeLinejoin="round" />
    </svg>
  )
}

function Summary({ snapshot, t }: { snapshot: CapabilitiesSnapshot; t: TranslateNS<typeof NS> }) {
  const active = snapshot.mcpServers.filter(server => server.status !== 'disabled')
  const connected = active.filter(server => server.status === 'connected').length
  const tools = active.reduce((sum, server) => sum + server.toolCount, 0)
  return (
    <div className="dshsc-summary">
      <div className="dshsc-tile">
        <b>{snapshot.skills.length}</b>
        <span>{t('summary.skills')}</span>
      </div>
      <div className="dshsc-tile" data-tone={connected < active.length ? 'warn' : undefined}>
        <b>{connected}<small>/{active.length}</small></b>
        <span>{t('summary.mcp')}</span>
      </div>
      <div className="dshsc-tile">
        <b>{tools}</b>
        <span>{t('summary.tools')}</span>
      </div>
    </div>
  )
}

function statusValue(server: CapabilityMcpServer, t: TranslateNS<typeof NS>): string {
  switch (server.status) {
    case 'connecting': return t('mcp.connecting')
    case 'failed': return t('mcp.failed')
    case 'disabled': return t('mcp.disabled')
    default: return t('mcp.meta', { transport: t(`transport.${server.transport}`), count: server.toolCount })
  }
}

const STATUS_LABEL: Record<McpStatus, 'mcp.status.connected' | 'mcp.status.connecting' | 'mcp.status.failed' | 'mcp.status.disabled'> = {
  connected: 'mcp.status.connected',
  connecting: 'mcp.status.connecting',
  failed: 'mcp.status.failed',
  disabled: 'mcp.status.disabled',
}

/**
 * Split mcp-client's error text into the cause and its trailing advice.
 * Records look like `Error: spawn x ENOENT — giving up after 2 … — reload …`;
 * the card shows the cause and keeps the whole text in the tooltip.
 * @param error - raw error text the Host observed.
 * @returns the cause line.
 */
function errorHeadline(error: string): string {
  const cause = error.split(' — ')[0] ?? error
  return cause.replace(/^(Error|SdkError|McpError):\s*/, '').trim() || error
}

function McpRow({ server, t, onReconnect }: {
  server: CapabilityMcpServer
  t: TranslateNS<typeof NS>
  onReconnect: (serverName: string) => Promise<boolean>
}) {
  // A failed server opens on its error so the cause is visible without a click.
  const [open, setOpen] = useState(server.status === 'failed')
  const [allTools, setAllTools] = useState(false)
  const [reconnect, setReconnect] = useState<'idle' | 'pending' | 'failed'>('idle')
  const usageId = useId()
  const used = server.invocations > 0
  const expandable = server.tools.length > 0 || server.error !== undefined || used
  const tools = allTools ? server.tools : server.tools.slice(0, TOOL_PREVIEW)
  const hidden = server.tools.length - tools.length
  const title = [
    `${server.serverName} — ${t(STATUS_LABEL[server.status])}`,
    server.endpoint,
    server.invocations > 0 ? t('mcp.usedTimes', { count: server.invocations }) : undefined,
    server.origin === 'preset' ? t('mcp.origin.preset') : server.origin === 'tools-only' ? t('mcp.origin.toolsOnly') : undefined,
  ].filter(Boolean).join('\n')

  const requestReconnect = () => {
    setReconnect('pending')
    void onReconnect(server.serverName).then((ok) => { setReconnect(ok ? 'idle' : 'failed') })
  }

  return (
    <li className="dshsc-item">
      <button
        type="button"
        className="dshsc-row"
        aria-expanded={expandable ? open : undefined}
        aria-describedby={used ? usageId : undefined}
        aria-label={expandable ? t(open ? 'mcp.collapse' : 'mcp.expand', { name: server.serverName }) : undefined}
        disabled={!expandable}
        title={title}
        onClick={() => { setOpen(value => !value) }}
      >
        <span className="dshsc-chev" data-open={open} data-hidden={!expandable}>
          <IconChevronRightOutlineRegular size={12} />
        </span>
        <span className="dshsc-dot" data-status={server.status} aria-label={t(STATUS_LABEL[server.status])} role="img" />
        <span className="dshsc-label">{server.serverName}</span>
        {used ? <span className="dshsc-used">{t('mcp.used')}</span> : null}
        <span className="dshsc-value" data-status={server.status}>{statusValue(server, t)}</span>
      </button>
      {used && !open ? <span id={usageId} className="dshsc-srOnly">{t('mcp.usedTimes', { count: server.invocations })}</span> : null}
      {open && expandable
        ? (
          <div className="dshsc-sub">
            {used ? <div id={usageId} className="dshsc-usage">{t('mcp.usedTimes', { count: server.invocations })}</div> : null}
            {server.error === undefined ? null : <div className="dshsc-errorBox" title={server.error}>{errorHeadline(server.error)}</div>}
            {server.status === 'failed' && server.reconnectable
              ? (
                <div className="dshsc-actions">
                  <button type="button" className="dshsc-button" disabled={reconnect === 'pending'} onClick={requestReconnect}>
                    {reconnect === 'pending' ? t('mcp.reconnecting') : t('mcp.reconnect')}
                  </button>
                  {reconnect === 'failed' ? <span className="dshsc-inlineError">{t('mcp.reconnectFailed')}</span> : null}
                </div>
              )
              : null}
            {tools.length > 0
              ? (
                <ul className="dshsc-chips">
                  {tools.map(tool => <li key={tool} className="dshsc-chip">{tool}</li>)}
                  {hidden > 0
                    ? <li><button type="button" className="dshsc-chip dshsc-chipButton" onClick={() => { setAllTools(true) }}>{t('mcp.moreTools', { count: hidden })}</button></li>
                    : null}
                  {allTools && server.tools.length > TOOL_PREVIEW
                    ? <li><button type="button" className="dshsc-chip dshsc-chipButton" onClick={() => { setAllTools(false) }}>{t('mcp.lessTools')}</button></li>
                    : null}
                </ul>
              )
              : null}
          </div>
        )
        : null}
    </li>
  )
}

function McpSection({ snapshot, t, onRefresh, onReconnect, onOpenSettings, loading }: {
  snapshot: CapabilitiesSnapshot
  t: TranslateNS<typeof NS>
  onRefresh: () => void
  onReconnect: (serverName: string) => Promise<boolean>
  onOpenSettings: (() => void) | undefined
  loading: boolean
}) {
  return (
    <section className="dshsc-section" aria-label={t('mcp.title')}>
      <div className="dshsc-sectionHead">
        <span>{t('mcp.title')}</span>
        <span className="dshsc-headActions">
          <button type="button" className="dshsc-iconButton" aria-label={t('mcp.refresh')} title={t('mcp.refresh')} data-spinning={loading} onClick={onRefresh}>
            <IconRefreshOutlineRegular size={14} />
          </button>
          {onOpenSettings === undefined
            ? null
            : (
              <button type="button" className="dshsc-iconButton" aria-label={t('mcp.settings')} title={t('mcp.settings')} onClick={onOpenSettings}>
                <IconSettingsOutlineRegular size={14} />
              </button>
            )}
        </span>
      </div>
      {snapshot.mcpError === undefined ? null : <div className="dshsc-note dshsc-noteError">{t('mcp.unavailable', { error: snapshot.mcpError })}</div>}
      {snapshot.mcpServers.length === 0
        ? <div className="dshsc-note">{t('mcp.empty')}</div>
        : (
          <ul className="dshsc-list">
            {snapshot.mcpServers.map(server => (
              // Remount on status change so a newly failed server opens on its error.
              <McpRow key={`${server.serverName}:${server.status}`} server={server} t={t} onReconnect={onReconnect} />
            ))}
          </ul>
        )}
    </section>
  )
}

function compareSkills(a: CapabilitySkill, b: CapabilitySkill): number {
  return Number(b.invocations > 0) - Number(a.invocations > 0)
    || SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope]
    || a.name.localeCompare(b.name)
}

function SkillsSection({ snapshot, t }: { snapshot: CapabilitiesSnapshot; t: TranslateNS<typeof NS> }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SkillFilter>('all')
  const [expanded, setExpanded] = useState(false)
  const skills = snapshot.skills
  const usedCount = useMemo(() => skills.filter(skill => skill.invocations > 0).length, [skills])
  const scopes = useMemo(() => SCOPE_FILTERS.filter(scope => skills.some(skill => skill.scope === scope)), [skills])
  const needle = query.trim().toLowerCase()
  const matched = useMemo(() => skills
    .filter(skill => filter === 'all' || (filter === 'used' ? skill.invocations > 0 : skill.scope === filter))
    .filter(skill => needle === '' || skill.name.toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle))
    .sort(compareSkills), [skills, filter, needle])
  // Searching or filtering shows every hit; the preview only trims the default view.
  const narrowed = needle !== '' || filter !== 'all'
  const visible = expanded || narrowed ? matched : matched.slice(0, SKILL_PREVIEW)

  if (snapshot.skillsError !== undefined) {
    return (
      <section className="dshsc-section" aria-label={t('skills.title')}>
        <div className="dshsc-sectionHead"><span>{t('skills.title')}</span></div>
        <div className="dshsc-note dshsc-noteError">{t('skills.unavailable', { error: snapshot.skillsError })}</div>
      </section>
    )
  }
  const pills: { id: SkillFilter; label: string }[] = [
    { id: 'all', label: t('filter.all') },
    ...usedCount > 0 ? [{ id: 'used' as const, label: t('filter.used', { count: usedCount }) }] : [],
    ...scopes.length > 1 ? scopes.map(scope => ({ id: scope, label: t(`scope.${scope}`) })) : [],
  ]
  return (
    <section className="dshsc-section" aria-label={t('skills.title')}>
      <div className="dshsc-sectionHead">
        <span>{t('skills.title')}</span>
        <span className="dshsc-headCount">{skills.length}</span>
      </div>
      {skills.length >= SEARCH_THRESHOLD
        ? (
          <label className="dshsc-search">
            <IconSearchOutlineRegular size={13} />
            <input
              type="search"
              value={query}
              placeholder={t('skills.search')}
              aria-label={t('skills.search')}
              onChange={(event) => { setQuery(event.currentTarget.value) }}
            />
          </label>
        )
        : null}
      {pills.length > 1
        ? (
          <div className="dshsc-pills" role="group" aria-label={t('filter.aria')}>
            {pills.map(pill => (
              <button
                key={pill.id}
                type="button"
                className="dshsc-pill"
                aria-pressed={filter === pill.id}
                onClick={() => { setFilter(pill.id) }}
              >
                {pill.label}
              </button>
            ))}
          </div>
        )
        : null}
      {snapshot.skillsComplete ? null : <div className="dshsc-note">{t('skills.incomplete')}</div>}
      {skills.length === 0
        ? <div className="dshsc-note">{t('skills.empty')}</div>
        : matched.length === 0
          ? <div className="dshsc-note">{t('skills.noMatch')}</div>
          : (
            <ul className="dshsc-list">
              {visible.map(skill => (
                <li
                  key={skill.name}
                  className="dshsc-row dshsc-skill"
                  data-muted={!skill.enabled}
                  title={[
                    skill.description,
                    skill.whenToUse,
                    skill.invocations > 0 ? t('skills.usedTimes', { count: skill.invocations }) : undefined,
                    skill.enabled ? undefined : t('skills.userOnly'),
                  ].filter(Boolean).join('\n\n')}
                >
                  <StarIcon />
                  <span className="dshsc-label">{skill.name}</span>
                  {skill.invocations > 0 ? <span className="dshsc-used">{t('skills.used')}</span> : null}
                  <span className="dshsc-tag" data-scope={skill.scope}>{t(`scope.${skill.scope}`)}</span>
                </li>
              ))}
            </ul>
          )}
      {!narrowed && matched.length > SKILL_PREVIEW
        ? (
          <button type="button" className="dshsc-more" onClick={() => { setExpanded(value => !value) }}>
            {expanded ? t('skills.showLess') : t('skills.viewAll', { count: matched.length })}
          </button>
        )
        : null}
    </section>
  )
}

/**
 * Session details card body.
 * @param props - model entry, translator, and actions.
 * @returns the card.
 */
export function SessionDetailsCard({ entry, t, onRefresh, onReconnect, onOpenSettings }: SessionDetailsCardProps) {
  const snapshot = entry?.snapshot
  return (
    <div className="dshsc-card" aria-label={t('card.aria')}>
      {snapshot === undefined
        ? entry?.error === undefined
          ? <div className="dshsc-note">{t('card.loading')}</div>
          : <div className="dshsc-note dshsc-noteError">{t('card.loadFailed', { error: entry.error })}</div>
        : (
          <>
            {entry?.error === undefined ? null : <div className="dshsc-note dshsc-noteError">{t('card.stale', { error: entry.error })}</div>}
            <Summary snapshot={snapshot} t={t} />
            <McpSection
              snapshot={snapshot}
              t={t}
              onRefresh={onRefresh}
              onReconnect={onReconnect}
              onOpenSettings={onOpenSettings}
              loading={entry?.loading === true}
            />
            <div className="dshsc-divider" role="separator" />
            <SkillsSection snapshot={snapshot} t={t} />
          </>
        )}
    </div>
  )
}
