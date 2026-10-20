/**
 * dsh-session-capabilities — browser face.
 *
 * - Registers a right-sidebar page tab type (`session-capabilities`) whose
 *   body is the session details card. The right sidebar's push presentation
 *   docks it inside the session pane, and the conversation reflows.
 * - Adds an icon button to the Session header utilities (top right) that
 *   shows / hides that tab, and remembers the choice per browser profile.
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
import { DetailsTab, HeaderToggle, type CapabilitiesInjected, type HeaderToggleInjected } from './mounts.tsx'
import { CapabilitiesModel } from './model.ts'
import { en, NS, zh, type CapabilitiesKey } from './locales.ts'
import STYLES from './styles.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Session capabilities card copy. */
    'session-capabilities': CapabilitiesKey
  }
}

/** Implementation identity in the right-sidebar tab system (also the body's slot key). */
const TAB_ID = 'dsh-session-capabilities/details'
/** Page kind `openTab` names. */
const TAB_KIND = 'session-capabilities'
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

  const t = ctx.locale.bind(NS)

  const openSettings = (): void => {
    try {
      ctx.get('layout')?.selectPanel(PLUGINS_PANEL as never)
    } catch {
      // No plugin manager page in this composition.
    }
  }

  // The dock surface is optional: in a composition without the right sidebar
  // this plugin contributes nothing visible rather than failing to mount.
  ctx.inject(['sidebarRight', 'sidebarRightTabs'], (dock: ClientContext) => {
    dock.effect(() => dock.sidebarRightTabs.register({
      id: TAB_ID,
      kind: TAB_KIND,
      title: () => t('tab.title'),
      guide: [{ id: 'details', order: 60, title: () => t('tab.title'), description: () => t('tab.guideDescription') }],
    }), 'session-capabilities: tab type')

    dock.effect(() => dock.slots.inject('sidebar.right.pane.tab', () => dock.slots.register({
      name: 'sidebar.right.pane.tab',
      key: TAB_ID,
      locale: NS,
      inject: (): CapabilitiesInjected => ({
        hooks: { capabilities: model.state },
        watch: sessionId => model.watch(sessionId),
        refresh: (sessionId) => { model.refresh(sessionId) },
        reconnect: (sessionId, serverName) => model.reconnect(sessionId, serverName),
        openSettings: ctx.get('layout') === undefined ? undefined : openSettings,
      }),
    }, DetailsTab)), 'session-capabilities: tab body')

    const showing = (): boolean => {
      try {
        return dock.sidebarRight.isExpanded() && dock.sidebarRight.active()?.kind === TAB_KIND
      } catch {
        return false
      }
    }
    const restored = new Set<string>()

    dock.slots.inject('conversation.session.header.utilities', () => dock.slots.register({
      name: 'conversation.session.header.utilities',
      id: 'session-capabilities',
      // Before the shipped Session-log menu, after open-in-app.
      order: 50,
      locale: NS,
      inject: (): HeaderToggleInjected => ({
        toggle: () => {
          if (showing()) {
            dock.sidebarRight.toggleExpanded()
            writeOpenPref(false)
          } else {
            dock.sidebarRight.openTab(TAB_KIND)
            writeOpenPref(true)
          }
        },
        restore: (sessionId) => {
          if (restored.has(sessionId) || !readOpenPref()) return
          // The column's store for the arriving Session is minted in the same
          // commit; defer one task so commands target it.
          setTimeout(() => {
            if (restored.has(sessionId)) return
            try {
              if (dock.sidebarRight.mounted.getSnapshot() !== sessionId) return
              restored.add(sessionId)
              // Respect whatever the user has open in an expanded column.
              if (!dock.sidebarRight.isExpanded()) dock.sidebarRight.openTab(TAB_KIND)
            } catch {
              // Column not ready for this Session; the next mount retries.
            }
          }, 0)
        },
      }),
    }, HeaderToggle))
  })
}
