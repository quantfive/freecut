import type { TimelineItem } from '@/types/timeline'
import { Scissors, Trash2, Magnet, ZoomIn } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useSelectionStore } from '@/shared/state/selection'
import { usePlaybackStore } from '@/shared/state/playback'
import { useEditorStore } from '@/shared/state/editor'
import { useTimelineStore } from '../stores/timeline-store'
import { useEditorCapability, useEditorHostContext } from '../deps/editor'
import {
  expandSelectionWithLinkedItems,
  getSynchronizedLinkedItems,
  getUniqueLinkedItemAnchorIds,
} from '../utils/linked-items'

function isSplitDisabled(
  item: TimelineItem | undefined,
  frame: number,
  allowed: boolean,
  locked: boolean,
  malformed: boolean,
): boolean {
  if (!allowed || locked || malformed || !item) return true
  return frame <= item.from || frame >= item.from + item.durationInFrames
}

/** Common actions use the same commands as clip menus and shortcuts. */
export function TimelinePrimaryActions({ onZoomToSelection }: { onZoomToSelection?: () => void }) {
  const { t } = useTranslation()
  const { mode, timeline } = useEditorHostContext()
  const canSplit = useEditorCapability('timeline.split')
  // The host contract explicitly maps ripple_delete to timeline.remove.
  const canRemove = useEditorCapability('timeline.remove')
  const selectedIds = useSelectionStore((state) => state.selectedItemIds)
  const linked = useEditorStore((state) => state.linkedSelectionEnabled)
  const items = useTimelineStore((state) => state.items)
  const tracks = useTimelineStore((state) => state.tracks)
  const frame = usePlaybackStore((state) => state.currentFrame)
  const snap = useTimelineStore((state) => state.snapEnabled)
  const selected = items.filter((item) => selectedIds.includes(item.id))
  const cohortIds =
    linked || mode === 'host' ? expandSelectionWithLinkedItems(items, selectedIds) : selectedIds
  const locked = items.some(
    (item) =>
      cohortIds.includes(item.id) && tracks.find((track) => track.id === item.trackId)?.locked,
  )
  const splitAnchorIds = linked ? getUniqueLinkedItemAnchorIds(items, selectedIds) : selectedIds
  const splitItem =
    splitAnchorIds.length === 1 && selected.length === selectedIds.length
      ? selected.find((item) => item.id === splitAnchorIds[0])
      : undefined
  const malformed =
    splitItem &&
    linked &&
    getSynchronizedLinkedItems(items, splitItem.id).length !== cohortIds.length
  const splitDisabled = isSplitDisabled(splitItem, frame, canSplit, locked, !!malformed)
  const deleteDisabled =
    !canRemove ||
    locked ||
    selected.length === 0 ||
    selected.length !== selectedIds.length ||
    (mode === 'host' && !timeline)
  const splitReason = !canSplit
    ? t('timeline.header.actionUnavailable', {
        defaultValue: 'This host does not support this action',
      })
    : t('timeline.header.splitSelectionHint', {
        defaultValue: 'Select one unlocked clip and place the playhead inside it',
      })
  const deleteReason = !canRemove
    ? t('timeline.header.actionUnavailable', {
        defaultValue: 'This host does not support this action',
      })
    : t('timeline.header.deleteSelectionHint', {
        defaultValue: 'Select unlocked clips to delete; linked tracks must also be unlocked',
      })
  const deleteSelection = async () => {
    try {
      if (mode === 'host') await timeline?.requestRippleDelete(selectedIds)
      else {
        useTimelineStore.getState().rippleDeleteItems(selectedIds)
        useSelectionStore.getState().clearSelection()
      }
    } catch {
      toast.error(
        t('timeline.header.deleteFailed', {
          defaultValue: 'Could not delete these clips. Your edit is unchanged; try again.',
        }),
      )
    }
  }
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 px-2 text-xs"
        disabled={!!splitDisabled}
        title={
          splitDisabled
            ? splitReason
            : t('timeline.header.splitAtPlayhead', { defaultValue: 'Split at playhead' })
        }
        onClick={() => {
          if (splitItem) useTimelineStore.getState().splitItem(splitItem.id, frame)
        }}
      >
        <Scissors className="h-3.5 w-3.5" />
        {t('timeline.header.split', { defaultValue: 'Split' })}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 px-2 text-xs"
        disabled={deleteDisabled}
        title={
          deleteDisabled
            ? deleteReason
            : t('timeline.header.deleteCloseGap', { defaultValue: 'Delete & close gap' })
        }
        onClick={() => void deleteSelection()}
      >
        <Trash2 className="h-3.5 w-3.5" />
        {t('timeline.header.deleteCloseGap', { defaultValue: 'Delete & close gap' })}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 px-2 text-xs"
        disabled={!onZoomToSelection || selected.length === 0}
        onClick={onZoomToSelection}
        title={t('timeline.header.zoomSelection', { defaultValue: 'Zoom to selected clips' })}
        aria-label={t('timeline.header.zoomSelection', { defaultValue: 'Zoom to selected clips' })}
      >
        <ZoomIn className="h-3.5 w-3.5" />
        {t('timeline.header.selection', { defaultValue: 'Selection' })}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 px-2 text-xs"
        aria-pressed={snap}
        onClick={() => useTimelineStore.getState().toggleSnap()}
        title={t(snap ? 'timeline.header.snapEnabled' : 'timeline.header.snapDisabled')}
      >
        <Magnet className="h-3.5 w-3.5" />
        {t('timeline.header.snap', { defaultValue: 'Snap' })}
      </Button>
    </div>
  )
}
