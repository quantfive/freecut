import { AudioLines, FolderOpen, MonitorPlay, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { MediaSidebar } from './media-sidebar'
import { PropertiesSidebar } from './properties-sidebar'
import { AudioMeterPanel } from './audio-meter-panel'
import { MobileSourceMonitor } from './preview-area'

export type MobileEditorPanel = 'media' | 'properties' | 'source' | 'meters'

interface MobileEditorPanelBarProps {
  sourceAvailable: boolean
  onOpen(panel: MobileEditorPanel): void
}

export function MobileEditorPanelBar({ sourceAvailable, onOpen }: MobileEditorPanelBarProps) {
  const { t } = useTranslation()
  const items = [
    {
      id: 'media' as const,
      label: t('editor.mediaSidebar.media'),
      icon: FolderOpen,
    },
    {
      id: 'properties' as const,
      label: t('editor.propertiesSidebar.title'),
      icon: SlidersHorizontal,
    },
    ...(sourceAvailable
      ? [
          {
            id: 'source' as const,
            label: t('media.info.source'),
            icon: MonitorPlay,
          },
        ]
      : []),
    {
      id: 'meters' as const,
      label: t('editor.audioMeters.meters'),
      icon: AudioLines,
    },
  ]

  return (
    <div
      className="panel-header flex h-10 shrink-0 items-center justify-center gap-1 overflow-hidden border-b border-border px-1.5"
      role="toolbar"
      aria-label="Editor panels"
      data-mobile-editor-panel-bar
    >
      {items.map(({ id, label, icon: Icon }) => (
        <Button
          key={id}
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 min-w-0 flex-none gap-1 px-2 text-xs"
          aria-label={label}
          aria-haspopup="dialog"
          onClick={() => onOpen(id)}
        >
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span>{label}</span>
        </Button>
      ))}
    </div>
  )
}

interface MobileEditorDrawerProps {
  panel: MobileEditorPanel | null
  container: HTMLElement | null
  sourceMediaId: string | null
  restoreFocusTo: HTMLElement | null
  onClose(): void
  onCloseSource(): void
}

export function MobileEditorDrawer({
  panel,
  container,
  sourceMediaId,
  restoreFocusTo,
  onClose,
  onCloseSource,
}: MobileEditorDrawerProps) {
  const { t } = useTranslation()
  const titles: Record<MobileEditorPanel, string> = {
    media: t('editor.mediaSidebar.media'),
    properties: t('editor.propertiesSidebar.title'),
    source: t('media.info.source'),
    meters: t('editor.audioMeters.meters'),
  }
  const title = panel ? titles[panel] : ''

  return (
    <Dialog open={panel !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        container={container}
        overlayClassName="absolute"
        className="absolute inset-x-0 bottom-0 left-0 top-auto h-[72%] max-h-[42rem] w-full max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-t-xl border-x-0 border-b-0 p-0"
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          restoreFocusTo?.focus()
        }}
        data-mobile-editor-drawer={panel ?? undefined}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <div className="h-full min-h-0 overflow-hidden pt-8">
          {panel === 'media' && <MediaSidebar mobileDrawer onRequestClose={onClose} />}
          {panel === 'properties' && <PropertiesSidebar mobileDrawer onRequestClose={onClose} />}
          {panel === 'source' && sourceMediaId && (
            <MobileSourceMonitor mediaId={sourceMediaId} onClose={onCloseSource} />
          )}
          {panel === 'meters' && <AudioMeterPanel mobileDrawer />}
        </div>
      </DialogContent>
    </Dialog>
  )
}
