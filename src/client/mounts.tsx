/**
 * The mount that places {@link SessionDetailsCard}: {@link CornerControls},
 * the occupant of the Session header's far-right corner.
 *
 * The corner is the one header seat rendered for a blank Session too (the
 * utilities row is hidden until the conversation starts), so the toggle is
 * reachable from the first screen. The seat is single and the right sidebar
 * already fills it with its expand button; this entry shadows it at a lower
 * priority and renders an equivalent expand button beside its own toggle.
 *
 * The card opens as a panel docked to the right of the Conversation under the
 * header. The Conversation body yields the panel's width (it is pushed, not
 * covered); the header keeps its full width so the toggle stays put.
 *
 * Only this file knows about slots and the host DOM; the card stays
 * mount-agnostic.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Button, IconCordisPluginOutlineRegular, IconPanelLeftOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { SessionDetailsCard } from './SessionDetailsCard.tsx'
import type { CapabilitiesState } from './model.ts'
import type { NS } from './locales.ts'

/** Attribute marking the Conversation root while the panel is docked in it. */
const HOST_ATTR = 'data-dshsc-panel'

/** The right sidebar's expand control, re-rendered here because this entry shadows its seat. */
export interface SidebarExpand {
  /** Whether a right sidebar is loaded now (it may come and go after this seat renders). */
  present: () => boolean
  /** Whether the right sidebar currently shows its panel. */
  isExpanded: () => boolean
  /** Show the right sidebar. */
  expand: () => void
  /** Tooltip copy, from the sidebar's own dictionary. */
  label: () => string
  /** Accessible name, from the sidebar's own dictionary. */
  ariaLabel: () => string
}

/** Registration-side business face of the corner. */
export interface CornerInjected {
  hooks: {
    /** Bound by the renderer as `useCapabilities(selector)`. */
    capabilities: {
      getSnapshot(): CapabilitiesState
      subscribe(listener: () => void): () => void
    }
    /** Bound as `usePanelOpen(selector)`: whether the panel is shown. */
    panelOpen: {
      getSnapshot(): boolean
      subscribe(listener: () => void): () => void
    }
  }
  /** Show or hide the panel (remembered per browser profile). */
  togglePanel: () => void
  /** Keep a Session current while a view shows it; returns the release. */
  watch: (sessionId: string) => () => void
  refresh: (sessionId: string) => void
  reconnect: (sessionId: string, serverName: string) => Promise<boolean>
  /** Present when the shell has a plugin settings page to open. */
  openSettings: (() => void) | undefined
  /** The right sidebar's expand button this seat replaces. */
  sidebar: SidebarExpand
}

export type CornerControlsProps =
  PropsRuntime<'conversation.session.header.corner'>
  & PropsLocale<typeof NS>
  & InjectFace<CornerInjected>

/**
 * Header corner: the panel toggle, the right sidebar's expand button while it
 * is collapsed, and the docked panel itself (portaled into the Conversation root).
 * @param props - session-scoped corner props plus the injected face.
 * @returns the corner buttons.
 */
export function CornerControls(props: CornerControlsProps) {
  const { usePanelOpen, togglePanel, sidebar, t } = props
  const open = usePanelOpen(value => value)
  const anchor = useRef<HTMLSpanElement>(null)
  const [host, setHost] = useState<HTMLElement | null>(null)
  const sidebarExpanded = useSidebarExpanded(sidebar, anchor)

  // The Conversation root (marked by data-phase) holds the header's slot
  // anchor and the content body; it is position: relative, so the panel can
  // dock against its right edge. The header's direct parent is a
  // display:contents slot anchor, not the root.
  useLayoutEffect(() => {
    const root = anchor.current?.closest('header')?.closest('[data-phase]')
    setHost(root instanceof HTMLElement ? root : null)
  }, [])

  return (
    <span ref={anchor} className="dshsc-corner">
      <Tooltip label={t('header.toggleHint')} side="bottom" delayMs={500}>
        <Button
          size="sm"
          className="dshsc-headerButton"
          data-active={open ? '' : undefined}
          aria-label={t('header.toggle')}
          aria-pressed={open}
          onClick={togglePanel}
        >
          <IconCordisPluginOutlineRegular size={16} />
        </Button>
      </Tooltip>
      {sidebar.present() && !sidebarExpanded && (
        <Tooltip label={sidebar.label()} side="bottom" delayMs={500}>
          <Button size="sm" className="dshsc-headerButton" aria-label={sidebar.ariaLabel()} data-sidebar-right-expand onClick={sidebar.expand}>
            <IconPanelLeftOutlineRegular className="dshsc-headerIcon" />
          </Button>
        </Tooltip>
      )}
      {open && host !== null && createPortal(<DetailsPanel {...props} host={host} />, host)}
    </span>
  )
}

/**
 * The docked panel: claims room in the Conversation root while mounted and
 * keeps the Session's snapshot current.
 * @param props - corner props plus the Conversation root it docks in.
 * @returns the panel holding the card.
 */
function DetailsPanel({ host, sessionId, useSession, useCapabilities, watch, refresh, reconnect, openSettings, t }: CornerControlsProps & { host: HTMLElement }) {
  const entry = useCapabilities(state => state[sessionId])
  const running = useSession(snapshot => snapshot.running)
  const wasRunning = useRef(running)

  useEffect(() => watch(sessionId), [sessionId, watch])

  // Skill usage comes from the Session log, which grows per turn rather than
  // per catalog change: refetch once each turn settles.
  useEffect(() => {
    if (wasRunning.current && !running) refresh(sessionId)
    wasRunning.current = running
  }, [running, refresh, sessionId])

  // The marker makes the root's body yield the panel's width (styles.css);
  // the panel starts below the header, whose height varies with its content.
  useLayoutEffect(() => {
    const header = host.querySelector('header')
    const place = () => {
      host.style.setProperty('--dshsc-panel-top', `${header instanceof HTMLElement ? header.offsetHeight : 0}px`)
    }
    place()
    host.setAttribute(HOST_ATTR, '')
    const observer = header === null ? undefined : new ResizeObserver(place)
    if (header !== null) observer?.observe(header)
    return () => {
      observer?.disconnect()
      host.removeAttribute(HOST_ATTR)
      host.style.removeProperty('--dshsc-panel-top')
    }
  }, [host])

  return (
    <aside className="dshsc-panel" aria-label={t('card.aria')}>
      <SessionDetailsCard
        entry={entry}
        t={t}
        onRefresh={() => { refresh(sessionId) }}
        onReconnect={serverName => reconnect(sessionId, serverName)}
        onOpenSettings={openSettings}
      />
    </aside>
  )
}

/**
 * Follow the right sidebar's expanded state. The sidebar publishes no
 * subscription for it, so re-read it whenever its track resizes the header,
 * and after any click or key press (its own controls and shortcut).
 * @param sidebar - the expand face.
 * @param anchor - an element inside the header.
 * @returns whether the sidebar is expanded.
 */
function useSidebarExpanded(sidebar: SidebarExpand, anchor: RefObject<HTMLElement>): boolean {
  const subscribe = useCallback((listener: () => void) => {
    let frame = 0
    const later = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(listener)
    }
    const header = anchor.current?.closest('header')
    const observer = header == null ? undefined : new ResizeObserver(later)
    if (header != null) observer?.observe(header)
    document.addEventListener('pointerup', later, true)
    document.addEventListener('keyup', later, true)
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      document.removeEventListener('pointerup', later, true)
      document.removeEventListener('keyup', later, true)
    }
  }, [anchor])
  return useSyncExternalStore(subscribe, sidebar.isExpanded)
}
