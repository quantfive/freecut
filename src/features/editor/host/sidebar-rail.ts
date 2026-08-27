import type { EditorSidebarTab } from '@/config/editor-workspaces'
import { createLogger } from '@/shared/logging/logger'
import { isHostCapabilityEnabled, type EditorHost } from './contract'

const logger = createLogger('HostSidebarRail')

/**
 * Built-in rail tabs host mode can show at all, in the order the default rail
 * lists them.  Everything outside this set belongs to the local editor: host
 * mode has no shapes/effects/transitions/lottie/ai surface to gate.
 */
const HOST_BUILTIN_RAIL_ORDER = ['media', 'text', 'transcript'] as const

/** Whether a built-in tab clears the host's own capability gate. */
function builtinTabAvailable(tab: (typeof HOST_BUILTIN_RAIL_ORDER)[number], host: EditorHost) {
  switch (tab) {
    case 'media':
      return true
    case 'text':
      return isHostCapabilityEnabled(host.capabilities, 'timeline.add')
    case 'transcript':
      return (
        isHostCapabilityEnabled(host.capabilities, 'media.transcription') &&
        host.transcript !== undefined
      )
  }
}

/**
 * The rail host mode shows, resolved once so the sidebar (which renders it)
 * and the runtime (which decides whether a persisted `activeTab` survives an
 * authoritative snapshot) cannot disagree about what is on screen.
 *
 * Capability gating runs first and is not negotiable — `sidebarRail` chooses
 * order and subtraction from what the capabilities already allow, never
 * addition.  A rail that selects nothing is treated as unset so a typo cannot
 * leave the editor with no navigation.
 */
export function hostRailTabIds(host: EditorHost): readonly EditorSidebarTab[] {
  const moduleTabs = (host.sidebarModules ?? []).map(
    (module) => `host:${module.id}` as EditorSidebarTab,
  )
  const defaultRail: readonly EditorSidebarTab[] = [
    ...HOST_BUILTIN_RAIL_ORDER.filter((tab) => builtinTabAvailable(tab, host)),
    ...moduleTabs,
  ]
  if (!host.sidebarRail) return defaultRail

  const remaining = new Set(defaultRail)
  const ordered: EditorSidebarTab[] = []
  for (const tab of host.sidebarRail) {
    // Deleting on the way through drops repeats after the first mention, and
    // silently skips ids the capabilities already denied.
    if (!remaining.delete(tab)) continue
    ordered.push(tab)
  }

  if (ordered.length === 0) {
    logger.warn('sidebarRail matched no available tab; falling back to the default rail', {
      requested: host.sidebarRail,
      available: defaultRail,
    })
    return defaultRail
  }
  return ordered
}

/** Whether host mode still shows `tab` — i.e. the rail can navigate back to it. */
export function isHostRailTab(tab: string, host: EditorHost): boolean {
  return hostRailTabIds(host).includes(tab as EditorSidebarTab)
}

/**
 * The tab to fall back to when the active one is no longer on the rail.  The
 * rail's first entry rather than a hardcoded `'media'`, since a host is free
 * to drop media from its rail entirely.
 */
export function hostRailFallbackTab(host: EditorHost): EditorSidebarTab {
  return hostRailTabIds(host)[0] ?? 'media'
}
