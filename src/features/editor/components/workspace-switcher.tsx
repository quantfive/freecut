import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Layers, Palette, Scissors } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEditorStore } from '@/shared/state/editor'
import { cn } from '@/shared/ui/cn'
import type { EditorWorkspaceId } from '@/config/editor-workspaces'
import { useEditorCapability } from '../host/context'

const WORKSPACE_ITEMS: readonly {
  id: EditorWorkspaceId
  icon: LucideIcon
  labelKey: string
}[] = [
  { id: 'edit', icon: Scissors, labelKey: 'toolbar.workspaces.edit' },
  { id: 'color', icon: Palette, labelKey: 'toolbar.workspaces.color' },
  { id: 'motion', icon: Layers, labelKey: 'toolbar.workspaces.motion' },
]

/**
 * DaVinci-style workspace tabs. Switching applies a panel layout preset
 * (scopes, inspector tab, sidebar tab, timeline split) without touching
 * selection, playhead, or project state.
 */
export const WorkspaceSwitcher = memo(function WorkspaceSwitcher({
  compact = false,
}: {
  compact?: boolean
}) {
  const { t } = useTranslation()
  const workspace = useEditorStore((s) => s.workspace)
  const setWorkspace = useEditorStore((s) => s.setWorkspace)
  const canUseColor = useEditorCapability('workspace.color')
  const canUseMotion = useEditorCapability('workspace.motion')
  const visibleWorkspaceItems = WORKSPACE_ITEMS.filter(
    ({ id }) =>
      id === 'edit' || (id === 'color' && canUseColor) || (id === 'motion' && canUseMotion),
  )

  return (
    <div
      role="tablist"
      aria-label={t('toolbar.workspaces.label')}
      className="flex items-center gap-0.5 rounded-md bg-muted p-0.5"
    >
      {visibleWorkspaceItems.map(({ id, icon: Icon, labelKey }) => {
        const isActive = workspace === id
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => setWorkspace(id)}
            className={cn(
              'flex h-7 min-w-0 items-center gap-1 rounded-[5px] text-xs font-medium transition-colors',
              compact ? 'px-1.5' : 'gap-1.5 px-3',
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {t(labelKey)}
          </button>
        )
      })}
    </div>
  )
})
