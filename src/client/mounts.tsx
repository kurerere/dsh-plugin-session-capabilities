/**
 * The two mounts that place {@link SessionDetailsCard}:
 *
 * - {@link DetailsTab}: the body of a right-sidebar page tab. The right
 *   sidebar's push presentation docks it inside the session pane and the
 *   conversation column reflows to the remaining width.
 * - {@link HeaderToggle}: an icon button in the Session header's utilities
 *   (top right) that shows or hides that tab.
 *
 * Only this file knows about slots; the card stays mount-agnostic.
 */

import { useEffect, useRef } from 'react'
import { Button, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { SessionDetailsCard } from './SessionDetailsCard.tsx'
import type { CapabilitiesState } from './model.ts'
import type { NS } from './locales.ts'

/** Registration-side business face shared by both mounts. */
export interface CapabilitiesInjected {
  hooks: {
    /** Bound by the renderer as `useCapabilities(selector)`. */
    capabilities: {
      getSnapshot(): CapabilitiesState
      subscribe(listener: () => void): () => void
    }
  }
  /** Keep a Session current while a view shows it; returns the release. */
  watch: (sessionId: string) => () => void
  refresh: (sessionId: string) => void
  reconnect: (sessionId: string, serverName: string) => Promise<boolean>
  /** Present when the shell has a plugin settings page to open. */
  openSettings: (() => void) | undefined
}

export interface HeaderToggleInjected {
  /** Show the details tab, or hide the column when it already shows it. */
  toggle: () => void
  /** Re-open the details tab for a Session the user last left it open in. */
  restore: (sessionId: string) => void
}

export type DetailsTabProps =
  PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<typeof NS>
  & InjectFace<CapabilitiesInjected>

/**
 * Right-sidebar tab body: a padded column holding the card.
 * @param props - session-scoped tab props plus the injected model face.
 * @returns the docked card.
 */
export function DetailsTab({ sessionId, useSession, useCapabilities, watch, refresh, reconnect, openSettings, t }: DetailsTabProps) {
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

  return (
    <div className="dshsc-dock">
      <SessionDetailsCard
        entry={entry}
        t={t}
        onRefresh={() => { refresh(sessionId) }}
        onReconnect={serverName => reconnect(sessionId, serverName)}
        onOpenSettings={openSettings}
      />
    </div>
  )
}

export type HeaderToggleProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<typeof NS>
  & InjectFace<HeaderToggleInjected>

/**
 * Header utilities button toggling the docked card.
 * @param props - session-scoped header props plus the toggle face.
 * @returns the icon button.
 */
export function HeaderToggle({ sessionId, toggle, restore, t }: HeaderToggleProps) {
  useEffect(() => { restore(sessionId) }, [restore, sessionId])
  return (
    <Tooltip label={t('header.toggleHint')} side="bottom" delayMs={500}>
      <Button size="sm" className="dshsc-headerButton" aria-label={t('header.toggle')} onClick={toggle}>
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
          <rect x="2" y="2.5" width="12" height="11" rx="2" />
          <path d="M10 2.5v11M11.6 5.5h.8M11.6 8h.8M11.6 10.5h.8" strokeLinecap="round" />
        </svg>
      </Button>
    </Tooltip>
  )
}
