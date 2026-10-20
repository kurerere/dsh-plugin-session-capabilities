/**
 * dsh-session-capabilities — browser face.
 *
 * - Occupies the Session header's top-right corner with a toggle (shown for
 *   blank Sessions too) that docks the session details card as a panel on the
 *   right of the Conversation, which yields the panel's width. The choice is
 *   remembered per browser profile.
 * - Owns the React-free model that keeps per-Session snapshots current.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import { CornerControls, type CornerInjected, type SidebarExpand } from './mounts.tsx'
import { CapabilitiesModel } from './model.ts'
import { en, NS, zh, type CapabilitiesKey } from './locales.ts'
import STYLES from './styles.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Session capabilities card copy. */
    'session-capabilities': CapabilitiesKey
  }
}

/** Below the right sidebar's expand button (default 0), so this entry renders in its place. */
const CORNER_PRIORITY = -1
/** Package id stamped on the injected style tag. */
const STYLE_ID = 'dsh-session-capabilities'
/** Per-profile "keep the card open" preference. */
const OPEN_PREF_KEY = 'dsh-session-capabilities.open.v1'
/** Main panel id of the shipped plugin manager page. */
const PLUGINS_PANEL = 'plugins'

function readOpenPref(): boolean {
  try {
    return globalThis.localStorage?.getItem(OPEN_PREF_KEY) === '1'
  } catch {
    return false
  }
}

function writeOpenPref(open: boolean): void {
  try {
    globalThis.localStorage?.setItem(OPEN_PREF_KEY, open ? '1' : '0')
  } catch {
    // Storage may be unavailable (private mode); the toggle still works for this page.
  }
}

/** Shared open/closed state of the panel, seeded from the stored preference. */
class PanelState {
  private open = readOpenPref()
  private readonly listeners = new Set<() => void>()

  getSnapshot = (): boolean => this.open

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  toggle(): void {
    this.open = !this.open
    writeOpenPref(this.open)
    for (const listener of this.listeners) listener()
  }
}

/** Required browser services: the slot registry and the locale dictionaries. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body.
 * @param ctx - browser root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-capabilities: dictionaries')

  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const tag = document.createElement('style')
    tag.dataset.plugin = STYLE_ID
    tag.textContent = STYLES
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'session-capabilities: stylesheet')

  const model = new CapabilitiesModel()
  ctx.effect(() => () => { model.dispose() }, 'session-capabilities: model')
  // A replaced Connection generation may reach a different Host: start over.
  ctx.on('connection/reset', () => { model.reset() })

  const openSettings = (): void => {
    try {
      ctx.get('layout')?.selectPanel(PLUGINS_PANEL as never)
    } catch {
      // No plugin manager page in this composition.
    }
  }

  // The expand button this entry replaces uses the sidebar's own copy.
  const sidebarT = ctx.locale.bind('sidebarRight')
  const sidebarExpand: SidebarExpand = {
    present: () => ctx.get('sidebarRight') !== undefined,
    isExpanded: () => {
      try {
        return ctx.get('sidebarRight')?.isExpanded() ?? false
      } catch {
        // No Session surface mounted yet: nothing is expanded.
        return false
      }
    },
    expand: () => {
      try {
        const sidebar = ctx.get('sidebarRight')
        if (sidebar !== undefined && !sidebar.isExpanded()) sidebar.toggleExpanded()
      } catch (error) {
        console.error('session-capabilities: expanding the right sidebar failed:', error)
      }
    },
    label: () => sidebarT('chrome.expand'),
    ariaLabel: () => sidebarT('chrome.expandAria'),
  }

  const panel = new PanelState()

  // The corner is declared by the Conversation header and occupied by the
  // right sidebar's expand button at the default priority: shadow it (lowest
  // priority renders) and carry an equivalent expand button when the sidebar
  // is part of the composition.
  ctx.slots.inject('conversation.session.header.corner', () => ctx.slots.register({
    name: 'conversation.session.header.corner',
    priority: CORNER_PRIORITY,
    locale: NS,
    inject: (): CornerInjected => ({
      hooks: { capabilities: model.state, panelOpen: panel },
      togglePanel: () => { panel.toggle() },
      watch: sessionId => model.watch(sessionId),
      refresh: (sessionId) => { model.refresh(sessionId) },
      reconnect: (sessionId, serverName) => model.reconnect(sessionId, serverName),
      openSettings: ctx.get('layout') === undefined ? undefined : openSettings,
      sidebar: sidebarExpand,
    }),
  }, CornerControls))
}
