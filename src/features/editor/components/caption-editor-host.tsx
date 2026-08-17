import { memo, useMemo } from 'react'

import {
  CaptionEditor,
  createCodePressCommandAdapter,
  framesToMicroseconds,
  type CodePressCommandAdapter,
} from '@/features/editor/codepress'
import { usePlaybackStore } from '@/shared/state/playback'
import { useTimelineSettingsStore } from '@/features/editor/deps/timeline-store'

const CAPTION_SESSION_DURATION_SECONDS = 30

interface CaptionEditorHostProps {
  projectId: string
  width: number
  height: number
  fps: number
}

function createCaptionAdapter({
  projectId,
  width,
  height,
  fps,
}: CaptionEditorHostProps): CodePressCommandAdapter {
  const durationInFrames = Math.max(1, Math.round(fps * CAPTION_SESSION_DURATION_SECONDS))

  return createCodePressCommandAdapter({
    document: {
      timeline: {
        contract_version: 1,
        schema_version: 1,
        timeline_id: `freecut-caption:${projectId}`,
        revision: 0,
        duration_us: framesToMicroseconds(durationInFrames, fps),
        media: [],
        tracks: [],
      },
      fps,
      width,
      height,
    },
  })
}

/**
 * Production editor host for the controlled PR9A caption surface.
 *
 * The adapter intentionally owns the mounted caption session in memory. Durable
 * project persistence and transcript-backed caption generation remain separate
 * host responsibilities for later PRs; all edits still cross the canonical
 * integer-microsecond command boundary through CodePressCommandAdapter.
 */
export const CaptionEditorHost = memo(function CaptionEditorHost({
  projectId,
  width,
  height,
  fps,
}: CaptionEditorHostProps) {
  const adapter = useMemo(
    () => createCaptionAdapter({ projectId, width, height, fps }),
    [projectId, width, height, fps],
  )
  const currentFrame = usePlaybackStore((state) => state.currentFrame)
  const setCurrentFrame = usePlaybackStore((state) => state.setCurrentFrame)
  const loading = useTimelineSettingsStore((state) => state.isTimelineLoading)

  return (
    <div className="mt-4 border-t border-border pt-4" data-testid="editor-caption-host">
      <CaptionEditor
        adapter={adapter}
        currentFrame={currentFrame}
        loading={loading}
        onSeek={setCurrentFrame}
      />
    </div>
  )
})
