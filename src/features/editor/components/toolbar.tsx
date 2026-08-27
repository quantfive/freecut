import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  BookOpen,
  Bug,
  ChevronDown,
  Download,
  FolderArchive,
  Github,
  Keyboard,
  ListVideo,
  MoreHorizontal,
  Save,
  Settings,
  Sparkles,
  Video,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DiscordIcon } from '@/components/brand/discord-icon'
import { DISCORD_INVITE_URL } from '@/config/community'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { LocalInferenceStatusPill } from './local-inference-status-pill'
import { SettingsDialog } from './settings-dialog'
import { ShortcutsDialog } from './shortcuts-dialog'
import { UnsavedChangesDialog } from './unsaved-changes-dialog'
import { WorkspaceSwitcher } from './workspace-switcher'
import { WhatsNewDialog } from './whats-new-dialog'
import { hasUnseenChangelog } from './whats-new-seen'
import { EDITOR_LAYOUT_CSS_VALUES } from '@/config/editor-layout'
import { cn } from '@/shared/ui/cn'
import { LanguageSwitcher } from '@/shared/ui/language-switcher'
import { useDebugStore } from '@/features/editor/stores/debug-store'
import { useItemsStore, useTimelineStore } from '@/features/editor/deps/timeline-store'
import { useMediaLibraryStore } from '@/features/editor/deps/media-library'
import { useEditorHostMode } from '../host/context'

const SAVE_ANIMATION_MIN_MS = 1800
const LazyProjectDebugPanel = lazy(() =>
  import('./project-debug-panel').then((module) => ({ default: module.ProjectDebugPanel })),
)

const SaveDirtyIndicator = memo(function SaveDirtyIndicator() {
  const isDirty = useTimelineStore((state) => state.isDirty)
  return isDirty ? (
    <span className="absolute -right-1 -top-1 h-2 w-2 animate-pulse rounded-full bg-orange-500" />
  ) : null
})

function formatProjectDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
}

function projectDurationSeconds(maxItemEndFrame: number, fps: number): number {
  return fps > 0 ? maxItemEndFrame / fps : 0
}

function LocalInferenceToolbarStatus({ hostMode }: { hostMode: boolean }) {
  return hostMode ? null : <LocalInferenceStatusPill />
}

interface ToolbarProps {
  projectId: string
  project: {
    id: string
    name: string
    width: number
    height: number
    fps: number
  }
  onSave?: () => Promise<void>
  onBack?: () => void
  onExport?: () => void
  onExportBundle?: () => void
  onOpenRenderQueue?: () => void
  /** Number of queued + rendering jobs, shown as a badge on the queue button. */
  renderQueueCount?: number
  compact?: boolean
}

interface MobileToolbarProps extends ToolbarProps {
  hostMode: boolean
  showUnsavedDialog: boolean
  showShortcutsDialog: boolean
  showSettingsDialog: boolean
  showWhatsNewDialog: boolean
  isSaveAnimating: boolean
  saveAnimationKey: number
  handleBackClick(): void
  handleSave(): Promise<void>
  openWhatsNew(): void
  setShowUnsavedDialog(open: boolean): void
  setShowShortcutsDialog(open: boolean): void
  setShowSettingsDialog(open: boolean): void
  setShowWhatsNewDialog(open: boolean): void
}

// The compact toolbar keeps the four essential actions visible while gathering
// host/local utility branches into one tested overflow surface. Its standalone
// and host variants are covered by tests/browser/responsive-editor.spec.ts.
// fallow-ignore-next-line complexity
function MobileToolbar({
  project,
  onBack,
  onSave,
  onExport,
  onExportBundle,
  onOpenRenderQueue,
  renderQueueCount = 0,
  hostMode,
  showUnsavedDialog,
  showShortcutsDialog,
  showSettingsDialog,
  showWhatsNewDialog,
  isSaveAnimating,
  saveAnimationKey,
  handleBackClick,
  handleSave,
  openWhatsNew,
  setShowUnsavedDialog,
  setShowShortcutsDialog,
  setShowSettingsDialog,
  setShowWhatsNewDialog,
}: MobileToolbarProps) {
  const { t } = useTranslation()

  return (
    <div
      className="panel-header flex min-w-0 flex-shrink-0 items-center gap-1 overflow-hidden border-b border-border px-1.5"
      style={{ height: EDITOR_LAYOUT_CSS_VALUES.toolbarHeight }}
      role="toolbar"
      aria-label={t('toolbar.ariaLabel')}
      data-mobile-toolbar
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={handleBackClick}
        disabled={!onBack}
        aria-label={t('toolbar.backToProjectsAria')}
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>

      {onSave && onBack && (
        <UnsavedChangesDialog
          open={showUnsavedDialog}
          onOpenChange={setShowUnsavedDialog}
          onSave={handleSave}
          onNavigateBack={onBack}
          projectName={project.name}
        />
      )}

      <div className="flex min-w-0 flex-1 items-center justify-center overflow-hidden">
        <WorkspaceSwitcher compact />
      </div>

      {onSave && (
        <Button
          variant="outline"
          size="icon"
          className="relative h-8 w-8 shrink-0"
          onClick={handleSave}
          aria-label={t('toolbar.saveAria')}
        >
          {isSaveAnimating ? (
            <SaveAnimationIcon key={saveAnimationKey} className="h-5 w-5" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          <SaveDirtyIndicator />
        </Button>
      )}

      {(onExport || onExportBundle) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" className="h-8 w-8 shrink-0" aria-label={t('toolbar.export')}>
              <Download className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onExport} disabled={!onExport} className="gap-2">
              <Video className="h-4 w-4" />
              {t('toolbar.exportVideo')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onExportBundle} disabled={!onExportBundle} className="gap-2">
              <FolderArchive className="h-4 w-4" />
              {t('toolbar.downloadProjectZip')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <ShortcutsDialog open={showShortcutsDialog} onOpenChange={setShowShortcutsDialog} />
      {!hostMode && (
        <SettingsDialog open={showSettingsDialog} onOpenChange={setShowSettingsDialog} />
      )}
      <WhatsNewDialog open={showWhatsNewDialog} onOpenChange={setShowWhatsNewDialog} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label="More actions"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="truncate">{project.name}</DropdownMenuLabel>
          {onOpenRenderQueue && (
            <DropdownMenuItem onSelect={onOpenRenderQueue}>
              <ListVideo className="h-4 w-4" />
              {t('toolbar.renderQueue')}
              {renderQueueCount > 0 && <span className="ml-auto">{renderQueueCount}</span>}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={openWhatsNew}>
            <Sparkles className="h-4 w-4" />
            {t('toolbar.whatsNew')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setShowSettingsDialog(true)} disabled={hostMode}>
            <Settings className="h-4 w-4" />
            {t('toolbar.settings')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setShowShortcutsDialog(true)}>
            <Keyboard className="h-4 w-4" />
            {t('toolbar.keyboardShortcuts')}
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href="/docs" target="_blank" rel="noopener noreferrer">
              <BookOpen className="h-4 w-4" />
              User Guide
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a
              href="https://github.com/walterlow/freecut"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github className="h-4 w-4" />
              GitHub
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer">
              <DiscordIcon className="h-4 w-4" />
              Discord
            </a>
          </DropdownMenuItem>
          <div className="border-t border-border p-1">
            <LanguageSwitcher size="sm" align="end" side="left" />
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function requestToolbarBack({
  onSave,
  onBack,
  showUnsavedDialog,
}: {
  onSave?: () => Promise<void>
  onBack?: () => void
  showUnsavedDialog: () => void
}) {
  if (!useTimelineStore.getState().isDirty) {
    onBack?.()
    return
  }
  if (onSave && onBack) showUnsavedDialog()
}

export const Toolbar = memo(function Toolbar({
  projectId,
  project,
  onBack,
  onSave,
  onExport,
  onExportBundle,
  onOpenRenderQueue,
  renderQueueCount = 0,
  compact = false,
}: ToolbarProps) {
  const { t } = useTranslation()
  const hostMode = useEditorHostMode()
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)
  const [showShortcutsDialog, setShowShortcutsDialog] = useState(false)
  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [showWhatsNewDialog, setShowWhatsNewDialog] = useState(false)
  const [hasUnseenWhatsNew, setHasUnseenWhatsNew] = useState(false)
  const [isSaveAnimating, setIsSaveAnimating] = useState(false)
  const [saveAnimationKey, setSaveAnimationKey] = useState(0)
  const saveAnimationTimeoutRef = useRef<number | undefined>(undefined)
  const itemCount = useItemsStore((state) => state.items.length)
  const maxItemEndFrame = useItemsStore((state) => state.maxItemEndFrame)
  const mediaDependencyIds = useItemsStore((state) => state.mediaDependencyIds)
  const brokenMediaIds = useMediaLibraryStore((state) => state.brokenMediaIds)
  const projectSummary = useMemo(() => {
    const projectMediaIds = new Set(mediaDependencyIds)
    return {
      durationSeconds: projectDurationSeconds(maxItemEndFrame, project.fps),
      clipCount: itemCount,
      mediaCount: mediaDependencyIds.length,
      brokenMediaCount: brokenMediaIds.filter((mediaId) => projectMediaIds.has(mediaId)).length,
    }
  }, [brokenMediaIds, itemCount, maxItemEndFrame, mediaDependencyIds, project.fps])

  useEffect(() => {
    setHasUnseenWhatsNew(hasUnseenChangelog())
  }, [])

  useEffect(() => {
    return () => {
      if (saveAnimationTimeoutRef.current !== undefined) {
        window.clearTimeout(saveAnimationTimeoutRef.current)
      }
    }
  }, [])

  const openWhatsNew = () => {
    setHasUnseenWhatsNew(false)
    setShowWhatsNewDialog(true)
  }

  const handleBackClick = () => {
    requestToolbarBack({
      onSave,
      onBack,
      showUnsavedDialog: () => setShowUnsavedDialog(true),
    })
  }

  const handleSave = async () => {
    const startedAt = performance.now()
    const finishSaveAnimation = () => {
      const remainingMs = Math.max(0, SAVE_ANIMATION_MIN_MS - (performance.now() - startedAt))

      saveAnimationTimeoutRef.current = window.setTimeout(() => {
        setIsSaveAnimating(false)
        saveAnimationTimeoutRef.current = undefined
      }, remainingMs)
    }

    if (saveAnimationTimeoutRef.current !== undefined) {
      window.clearTimeout(saveAnimationTimeoutRef.current)
    }

    setSaveAnimationKey((key) => key + 1)
    setIsSaveAnimating(true)

    if (onSave) {
      try {
        await onSave()
      } finally {
        finishSaveAnimation()
      }
    } else {
      finishSaveAnimation()
    }
  }

  if (compact) {
    return (
      <MobileToolbar
        projectId={projectId}
        project={project}
        onBack={onBack}
        onSave={onSave}
        onExport={onExport}
        onExportBundle={onExportBundle}
        onOpenRenderQueue={onOpenRenderQueue}
        renderQueueCount={renderQueueCount}
        hostMode={hostMode}
        showUnsavedDialog={showUnsavedDialog}
        showShortcutsDialog={showShortcutsDialog}
        showSettingsDialog={showSettingsDialog}
        showWhatsNewDialog={showWhatsNewDialog}
        isSaveAnimating={isSaveAnimating}
        saveAnimationKey={saveAnimationKey}
        handleBackClick={handleBackClick}
        handleSave={handleSave}
        openWhatsNew={openWhatsNew}
        setShowUnsavedDialog={setShowUnsavedDialog}
        setShowShortcutsDialog={setShowShortcutsDialog}
        setShowSettingsDialog={setShowSettingsDialog}
        setShowWhatsNewDialog={setShowWhatsNewDialog}
      />
    )
  }

  return (
    <div
      className="panel-header flex flex-shrink-0 items-center gap-2.5 border-b border-border px-3"
      style={{ height: EDITOR_LAYOUT_CSS_VALUES.toolbarHeight }}
      role="toolbar"
      aria-label={t('toolbar.ariaLabel')}
    >
      <div className="flex items-center gap-2.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleBackClick}
          disabled={!onBack}
          data-tooltip={t('toolbar.backToProjects')}
          data-tooltip-side="right"
          aria-label={t('toolbar.backToProjectsAria')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>

        {onSave && onBack && (
          <UnsavedChangesDialog
            open={showUnsavedDialog}
            onOpenChange={setShowUnsavedDialog}
            onSave={handleSave}
            onNavigateBack={onBack}
            projectName={project?.name}
          />
        )}

        <Separator orientation="vertical" className="h-5" />

        <div className="flex flex-col -space-y-0.5">
          <h1 className="text-sm font-medium leading-none">
            {project?.name || t('common.untitledProject')}
          </h1>
          <span className="font-mono text-[11px] text-muted-foreground">
            {t('toolbar.specsDetailed', {
              width: project?.width,
              height: project?.height,
              fps: project?.fps,
              duration: formatProjectDuration(projectSummary.durationSeconds),
              clips: projectSummary.clipCount,
              media: projectSummary.mediaCount,
              missing: projectSummary.brokenMediaCount,
            })}
          </span>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center">
        <WorkspaceSwitcher />
      </div>

      <LocalInferenceToolbarStatus hostMode={hostMode} />

      <ShortcutsDialog open={showShortcutsDialog} onOpenChange={setShowShortcutsDialog} />

      {!hostMode && (
        <SettingsDialog open={showSettingsDialog} onOpenChange={setShowSettingsDialog} />
      )}

      <WhatsNewDialog open={showWhatsNewDialog} onOpenChange={setShowWhatsNewDialog} />

      <div className="flex items-center gap-1.5">
        {!hostMode && import.meta.env.DEV && import.meta.env.VITE_SHOW_DEBUG_PANEL !== 'false' && (
          <DebugPopover projectId={projectId} />
        )}

        {/* Socials */}
        <Button variant="outline" size="icon" className="h-7 w-7" asChild>
          <a
            href="https://github.com/walterlow/freecut"
            target="_blank"
            rel="noopener noreferrer"
            data-tooltip={t('toolbar.viewOnGitHub')}
            data-tooltip-side="bottom"
            aria-label={t('toolbar.viewOnGitHub')}
          >
            <Github className="h-4 w-4" />
          </a>
        </Button>
        <Button variant="outline" size="icon" className="h-7 w-7" asChild>
          <a
            href={DISCORD_INVITE_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-tooltip={t('toolbar.joinDiscord')}
            data-tooltip-side="bottom"
            aria-label={t('toolbar.joinDiscord')}
          >
            <DiscordIcon className="h-4 w-4" />
          </a>
        </Button>

        <Separator orientation="vertical" className="h-5" />

        {/* Utility */}
        <Button variant="outline" size="icon" className="h-7 w-7" asChild>
          <a
            href="/docs"
            target="_blank"
            rel="noopener noreferrer"
            data-tooltip="User Guide"
            data-tooltip-side="bottom"
            aria-label="User Guide"
          >
            <BookOpen className="h-4 w-4" />
          </a>
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7 relative"
          onClick={openWhatsNew}
          data-tooltip={t('toolbar.whatsNew')}
          data-tooltip-side="bottom"
          aria-label={t('toolbar.whatsNewAria')}
        >
          <Sparkles className="h-4 w-4" />
          {hasUnseenWhatsNew && (
            <span
              className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-primary"
              aria-hidden="true"
            />
          )}
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          onClick={() => setShowSettingsDialog(true)}
          disabled={hostMode}
          data-tooltip={t('toolbar.settings')}
          data-tooltip-side="bottom"
          aria-label={t('toolbar.settings')}
        >
          <Settings className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7"
          onClick={() => setShowShortcutsDialog(true)}
          data-tooltip={t('toolbar.keyboardShortcuts')}
          data-tooltip-side="bottom"
          aria-label={t('toolbar.keyboardShortcutsAria')}
        >
          <Keyboard className="h-4 w-4" />
        </Button>
        <LanguageSwitcher size="sm" align="end" side="bottom" />

        <Separator orientation="vertical" className="h-5" />

        {/* Actions */}
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={handleSave}
          disabled={!onSave}
          aria-label={t('toolbar.saveAria')}
        >
          <div className="relative">
            {isSaveAnimating ? (
              <SaveAnimationIcon key={saveAnimationKey} className="h-5 w-5" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            <SaveDirtyIndicator />
          </div>
          {t('toolbar.save')}
        </Button>

        {onOpenRenderQueue && (
          <Button
            variant="outline"
            size="icon"
            className="h-7 w-7 relative"
            onClick={onOpenRenderQueue}
            data-tooltip={t('toolbar.renderQueue')}
            data-tooltip-side="bottom"
            aria-label={t('toolbar.renderQueueAria')}
          >
            <ListVideo className="h-4 w-4" />
            {renderQueueCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium leading-none text-primary-foreground">
                {renderQueueCount}
              </span>
            )}
          </Button>
        )}

        {(onExport || onExportBundle) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="gap-1.5 glow-primary-sm">
                <Download className="h-4 w-4" />
                {t('toolbar.export')}
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onExport} disabled={!onExport} className="gap-2">
                <Video className="h-4 w-4" />
                {t('toolbar.exportVideo')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onExportBundle}
                disabled={!onExportBundle}
                className="gap-2"
              >
                <FolderArchive className="h-4 w-4" />
                {t('toolbar.downloadProjectZip')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
})

function SaveAnimationIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      version="1.1"
      id="L6"
      xmlns="http://www.w3.org/2000/svg"
      x="0px"
      y="0px"
      viewBox="12 12 76 76"
      enableBackground="new 12 12 76 76"
      xmlSpace="preserve"
      aria-hidden="true"
    >
      <rect fill="none" stroke="currentColor" strokeWidth="4" x="25" y="25" width="50" height="50">
        <animateTransform
          attributeName="transform"
          dur="0.5s"
          from="0 50 50"
          to="180 50 50"
          type="rotate"
          id="strokeBox"
          attributeType="XML"
          begin="rectBox.end"
        />
      </rect>
      <rect x="27" y="27" fill="currentColor" width="46" height="50">
        <animate
          attributeName="height"
          dur="1.3s"
          attributeType="XML"
          from="50"
          to="0"
          id="rectBox"
          fill="freeze"
          begin="0s;strokeBox.end"
        />
      </rect>
    </svg>
  )
}

function DebugPopover({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const debugPanelOpen = useDebugStore((s) => s.debugPanelOpen)
  const setDebugPanelOpen = useDebugStore((s) => s.setDebugPanelOpen)

  return (
    <Popover open={debugPanelOpen} onOpenChange={setDebugPanelOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className={cn(
            'h-7 w-7',
            debugPanelOpen && 'bg-amber-500/20 border-amber-500/50 text-amber-400',
          )}
          data-tooltip={debugPanelOpen ? undefined : t('toolbar.debugPanel')}
          data-tooltip-side="bottom"
          aria-label={t('toolbar.debugPanelAria')}
        >
          <Bug className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-64 p-0 bg-zinc-900 border-zinc-700 text-zinc-100"
      >
        <Suspense fallback={null}>
          <LazyProjectDebugPanel projectId={projectId} />
        </Suspense>
      </PopoverContent>
    </Popover>
  )
}
