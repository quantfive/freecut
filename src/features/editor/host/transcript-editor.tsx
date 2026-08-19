import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, CheckCircle2, ChevronDown, Loader2, RefreshCw, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { EditCommandBatch, EditCommand } from '@/features/editor/codepress/contract'
import { validateCommandBatch } from '@/features/editor/codepress/contract'
import {
  capabilityForCommand,
  isHostCapabilityEnabled,
  MAX_TRANSCRIPT_COMMAND_TEXT_BYTES,
  MAX_TRANSCRIPT_CURSOR_LENGTH,
  MAX_TRANSCRIPT_DURATION_US,
  MAX_TRANSCRIPT_QUERY_LENGTH,
  MAX_TRANSCRIPT_SECTION_PAGE_SIZE,
  MAX_TRANSCRIPT_SECTION_TEXT_BYTES,
  MAX_TRANSCRIPT_SELECTIONS,
  type EditorCapabilityMap,
  type HostTranscriptCommandPreview,
  type HostTranscriptError,
  type HostTranscriptRange,
  type HostTranscriptSection,
  type HostTranscriptSectionsPage,
  type HostTranscriptStatusReceipt,
  type HostTranscriptStatus,
} from './contract'
import { useEditorHostContext } from './context'
import { useHostTranscriptEditorRuntime } from './transcript-editor-context'

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const SAFE_HASH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const TRANSCRIPT_STATUSES: readonly HostTranscriptStatus[] = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'stale',
  'purged',
]

interface TranscriptUiError extends HostTranscriptError {
  source: 'host' | 'validation' | 'submission'
}

interface NormalizedPage extends HostTranscriptSectionsPage {
  nextCursor: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isOpaqueId(value: unknown): value is string {
  return typeof value === 'string' && OPAQUE_ID_PATTERN.test(value)
}

function isSafeHash(value: unknown): value is string {
  return typeof value === 'string' && SAFE_HASH_PATTERN.test(value)
}

function boundedText(value: unknown, maxBytes: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    new TextEncoder().encode(value).byteLength <= maxBytes
  )
}

// fallow-ignore-next-line complexity
function errorFromHost(
  value: unknown,
  fallback: string,
  source: TranscriptUiError['source'] = 'host',
): TranscriptUiError {
  if (isRecord(value)) {
    const nested = isRecord(value.error) ? value.error : value
    const code = typeof nested.code === 'string' && nested.code.length <= 128 ? nested.code : null
    const message =
      typeof nested.message === 'string' &&
      nested.message.length > 0 &&
      nested.message.length <= 512
        ? nested.message
        : null
    const retryable = typeof nested.retryable === 'boolean' ? nested.retryable : false
    if (code && message) {
      return {
        code,
        message,
        retryable,
        ...(isRecord(nested.details) ? { details: nested.details } : {}),
        source,
      }
    }
  }
  return { code: 'transcript_unavailable', message: fallback, retryable: false, source }
}

function unavailableError(status: HostTranscriptStatus): TranscriptUiError {
  if (status === 'pending' || status === 'running') {
    return {
      code: 'transcript_not_ready',
      message: 'The transcript is not ready yet. Retry when processing finishes.',
      retryable: true,
      source: 'host',
    }
  }
  return {
    code: 'transcript_content_unavailable',
    message: 'Transcript content is no longer available.',
    retryable: false,
    source: 'host',
  }
}

// fallow-ignore-next-line complexity
function normalizeStatus(value: unknown): HostTranscriptStatusReceipt | null {
  if (value === null) return null
  if (!isRecord(value)) throw new Error('The host returned an invalid transcript status.')

  const status = value.status
  const transcriptId = value.transcriptId
  const assetId = value.assetId
  const sourceAssetHash = value.sourceAssetHash
  const durationUs = value.durationUs
  const sectionCount = value.sectionCount
  const validDuration =
    durationUs === null ||
    (typeof durationUs === 'number' &&
      Number.isSafeInteger(durationUs) &&
      durationUs >= 0 &&
      durationUs <= MAX_TRANSCRIPT_DURATION_US)
  const validSectionCount =
    typeof sectionCount === 'number' && Number.isSafeInteger(sectionCount) && sectionCount >= 0
  if (
    typeof status !== 'string' ||
    !TRANSCRIPT_STATUSES.includes(status as HostTranscriptStatus) ||
    !isOpaqueId(transcriptId) ||
    (assetId !== null && !isOpaqueId(assetId)) ||
    !isSafeHash(sourceAssetHash) ||
    !validDuration ||
    !validSectionCount
  ) {
    throw new Error('The host returned an invalid transcript status.')
  }
  if (status === 'succeeded' && !isOpaqueId(assetId)) {
    throw new Error('The host returned a succeeded transcript without an asset binding.')
  }

  const rawLanguage = value.language
  const language =
    rawLanguage === null || rawLanguage === undefined
      ? null
      : typeof rawLanguage === 'string' && rawLanguage.length <= 32
        ? rawLanguage
        : null
  const normalizedError =
    value.error === null || value.error === undefined
      ? status === 'succeeded'
        ? null
        : unavailableError(status as HostTranscriptStatus)
      : errorFromHost(value.error, 'Transcript content is unavailable.')
  const error =
    normalizedError && status !== 'succeeded' && status !== 'pending' && status !== 'running'
      ? { ...normalizedError, retryable: false }
      : normalizedError

  return {
    transcriptId,
    assetId,
    sourceAssetHash,
    status: status as HostTranscriptStatus,
    language,
    durationUs: durationUs as number | null,
    sectionCount: sectionCount as number,
    error,
  }
}

// fallow-ignore-next-line complexity
function normalizeSection(value: unknown, expectedTranscriptId: string): HostTranscriptSection {
  if (!isRecord(value)) throw new Error('The host returned an invalid transcript section.')
  const { id, transcriptId, ordinal, startUs, endUs, text, speaker } = value
  const validOrdinal = typeof ordinal === 'number' && Number.isSafeInteger(ordinal) && ordinal >= 0
  const validStartUs = typeof startUs === 'number' && Number.isSafeInteger(startUs) && startUs >= 0
  const validEndUs = typeof endUs === 'number' && Number.isSafeInteger(endUs)
  if (
    !isOpaqueId(id) ||
    transcriptId !== expectedTranscriptId ||
    !validOrdinal ||
    !validStartUs ||
    !validEndUs ||
    (validStartUs && validEndUs && endUs <= startUs) ||
    (validEndUs && endUs > MAX_TRANSCRIPT_DURATION_US) ||
    !boundedText(text, MAX_TRANSCRIPT_SECTION_TEXT_BYTES)
  ) {
    throw new Error('The host returned an invalid transcript section.')
  }
  if (
    speaker !== undefined &&
    speaker !== null &&
    (typeof speaker !== 'string' || speaker.length > MAX_TRANSCRIPT_SECTION_TEXT_BYTES)
  ) {
    throw new Error('The host returned an invalid transcript speaker.')
  }
  return {
    id,
    transcriptId,
    ordinal: ordinal as number,
    startUs: startUs as number,
    endUs: endUs as number,
    text,
    speaker: speaker ?? null,
  }
}

// fallow-ignore-next-line complexity
function normalizePage(value: unknown, expectedTranscriptId: string): NormalizedPage {
  if (!isRecord(value) || value.transcriptId !== expectedTranscriptId) {
    throw new Error('The host returned an invalid transcript section page.')
  }
  if (!Array.isArray(value.sections) || value.sections.length > MAX_TRANSCRIPT_SECTION_PAGE_SIZE) {
    throw new Error('The host returned an oversized transcript section page.')
  }
  if (typeof value.hasMore !== 'boolean') {
    throw new Error('The host returned an invalid transcript cursor state.')
  }
  const rawCursor = value.nextCursor
  const nextCursor = rawCursor === null || rawCursor === undefined ? null : rawCursor
  if (
    nextCursor !== null &&
    (typeof nextCursor !== 'string' ||
      nextCursor.length === 0 ||
      nextCursor.length > MAX_TRANSCRIPT_CURSOR_LENGTH)
  ) {
    throw new Error('The host returned an invalid transcript cursor.')
  }
  if (value.hasMore && nextCursor === null) {
    throw new Error('The host returned an uncontinuable transcript cursor.')
  }
  const sections = value.sections.map((section) => normalizeSection(section, expectedTranscriptId))
  const ids = new Set<string>()
  for (const section of sections) {
    if (ids.has(section.id)) throw new Error('The host returned duplicate transcript sections.')
    ids.add(section.id)
  }
  return {
    transcriptId: expectedTranscriptId,
    sections,
    hasMore: value.hasMore,
    nextCursor,
  }
}

// fallow-ignore-next-line complexity
function normalizeCommandBatch(value: unknown, expectedRevision: number): EditCommandBatch {
  if (!isRecord(value)) throw new Error('The host returned an invalid transcript command batch.')
  if (
    value.base_revision !== expectedRevision ||
    !isOpaqueId(value.timeline_id) ||
    !isOpaqueId(value.operation_id) ||
    !isOpaqueId(value.idempotency_key)
  ) {
    throw new Error('The host returned an invalid transcript command batch.')
  }
  const validation = validateCommandBatch(value)
  if (!validation.ok) throw new Error('The host returned an invalid transcript command batch.')
  return validation.value
}

// fallow-ignore-next-line complexity
function normalizePreview(
  value: unknown,
  expected: {
    transcriptId: string
    assetId: string
    sourceAssetHash: string
    timelineId: string
    baseRevision: number
  },
): HostTranscriptCommandPreview {
  if (!isRecord(value)) throw new Error('The host returned an invalid transcript preview.')
  const previewValue = isRecord(value.preview) ? value.preview : null
  const willMutateTimeline = previewValue
    ? (previewValue.willMutateTimeline ?? previewValue.will_mutate_timeline)
    : undefined
  if (
    (value.status !== 'preview' && value.status !== 'replayed') ||
    !isOpaqueId(value.receiptId) ||
    value.transcriptId !== expected.transcriptId ||
    value.assetId !== expected.assetId ||
    value.sourceAssetHash !== expected.sourceAssetHash ||
    value.timestampCapability !== 'section' ||
    value.timelineId !== expected.timelineId ||
    !isOpaqueId(value.operationId) ||
    !isOpaqueId(value.idempotencyKey) ||
    value.baseRevision !== expected.baseRevision ||
    previewValue === null ||
    willMutateTimeline !== false
  ) {
    throw new Error('The host returned an invalid transcript preview.')
  }
  const commandBatch = normalizeCommandBatch(value.commandBatch, expected.baseRevision)
  if (
    commandBatch.timeline_id !== expected.timelineId ||
    commandBatch.operation_id !== value.operationId ||
    commandBatch.idempotency_key !== value.idempotencyKey
  ) {
    throw new Error('The host returned a transcript preview for a different operation.')
  }
  return {
    status: value.status,
    receiptId: value.receiptId,
    transcriptId: value.transcriptId,
    assetId: value.assetId,
    sourceAssetHash: value.sourceAssetHash,
    timestampCapability: 'section',
    timelineId: value.timelineId,
    operationId: value.operationId,
    idempotencyKey: value.idempotencyKey,
    baseRevision: value.baseRevision,
    commandBatch,
    preview: {
      ...(previewValue as HostTranscriptCommandPreview['preview']),
      willMutateTimeline: false,
    },
  }
}

function newOperationId(prefix: string): string {
  const suffix =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return `${prefix}-${suffix}`
}

function formatTimecode(microseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(microseconds / 1_000_000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function rangesForSelection(sections: readonly HostTranscriptSection[]): HostTranscriptRange[] {
  const ordered = [...sections].sort((left, right) => left.ordinal - right.ordinal)
  const ranges: HostTranscriptRange[] = []
  let totalTextBytes = 0
  let previous: HostTranscriptSection | undefined
  for (const section of ordered) {
    if (section.endUs <= section.startUs || section.endUs > MAX_TRANSCRIPT_DURATION_US) {
      throw new Error('The selected transcript range is invalid.')
    }
    if (previous && section.startUs < previous.endUs) {
      throw new Error('The selected transcript ranges overlap.')
    }
    totalTextBytes += new TextEncoder().encode(section.text).byteLength
    if (totalTextBytes > MAX_TRANSCRIPT_COMMAND_TEXT_BYTES) {
      throw new Error('The selected transcript text exceeds the bounded command limit.')
    }
    ranges.push({ startUs: section.startUs, endUs: section.endUs, text: section.text })
    previous = section
  }
  if (ranges.length === 0) throw new Error('Select at least one transcript section.')
  if (ranges.length > MAX_TRANSCRIPT_SELECTIONS) {
    throw new Error(`Select no more than ${MAX_TRANSCRIPT_SELECTIONS} transcript sections.`)
  }
  return ranges
}

function commandIsSupported(command: EditCommand, capabilities: EditorCapabilityMap): boolean {
  const capability = capabilityForCommand(command.type)
  return capability !== null && isHostCapabilityEnabled(capabilities, capability)
}

function UnavailableTranscript({
  error,
  onRetry,
}: {
  error: TranscriptUiError
  onRetry?: () => void
}) {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center"
      data-testid="host-transcript-unavailable"
      role="status"
    >
      <AlertCircle className="h-8 w-8 text-muted-foreground/60" />
      <div className="max-w-[34ch] space-y-1">
        <p className="text-sm text-muted-foreground">{error.message}</p>
        <p className="text-[11px] text-muted-foreground/75">{error.code}</p>
      </div>
      {error.retryable && onRetry ? (
        <Button type="button" size="sm" onClick={onRetry} data-testid="host-transcript-retry">
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Retry
        </Button>
      ) : null}
    </div>
  )
}

/**
 * Host-mode transcript consumer for the real Media/Transcript sidebar path.
 * This component intentionally has no dependency on FreeCut transcript stores,
 * transcription services, IndexedDB, OPFS, workspace handles, or project save
 * paths.  Preview is held locally; only Apply crosses the host edit port.
 */
// fallow-ignore-next-line complexity
export function HostTranscriptEditor({ active = true }: { active?: boolean }) {
  const { t } = useTranslation()
  const { capabilities, host } = useEditorHostContext()
  const runtime = useHostTranscriptEditorRuntime()
  const port = host?.transcript
  const canTranscribe = isHostCapabilityEnabled(capabilities, 'media.transcription')

  const [status, setStatus] = useState<HostTranscriptStatusReceipt | null>(null)
  const [sections, setSections] = useState<HostTranscriptSection[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<TranscriptUiError | null>(null)
  const [query, setQuery] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null)
  const [preview, setPreview] = useState<HostTranscriptCommandPreview | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const requestGeneration = useRef(0)
  const loadedSectionCount = useRef(0)

  const loadSectionsPage = useCallback(
    async (
      receipt: HostTranscriptStatusReceipt,
      cursor: string | null,
      replace: boolean,
    ): Promise<void> => {
      if (!port) return
      const page = normalizePage(
        await port.getSections({
          transcriptId: receipt.transcriptId,
          cursor,
          limit: MAX_TRANSCRIPT_SECTION_PAGE_SIZE,
        }),
        receipt.transcriptId,
      )
      const durationUs = receipt.durationUs
      if (
        (durationUs !== null && page.sections.some((section) => section.endUs > durationUs)) ||
        (!replace &&
          page.sections.length + loadedSectionCount.current >
            MAX_TRANSCRIPT_SELECTIONS * MAX_TRANSCRIPT_SECTION_PAGE_SIZE)
      ) {
        throw new Error('The host returned transcript sections outside the bounded transcript.')
      }
      setSections((current) => {
        const next = replace ? [] : [...current]
        const ids = new Set(next.map((section) => section.id))
        for (const section of page.sections) {
          if (!ids.has(section.id)) next.push(section)
        }
        const sorted = next.toSorted((left, right) => left.ordinal - right.ordinal)
        loadedSectionCount.current = sorted.length
        return sorted
      })
      setNextCursor(page.nextCursor)
      setHasMore(page.hasMore)
    },
    [port],
  )

  // fallow-ignore-next-line complexity
  const refresh = useCallback(async () => {
    if (!port || !canTranscribe) return
    const generation = requestGeneration.current + 1
    requestGeneration.current = generation
    setLoading(true)
    setError(null)
    setPreview(null)
    setSelectedIds(new Set())
    setSelectionAnchor(null)
    loadedSectionCount.current = 0
    try {
      const receipt = normalizeStatus(await port.getStatus())
      if (requestGeneration.current !== generation) return
      setStatus(receipt)
      setSections([])
      setNextCursor(null)
      setHasMore(false)
      if (!receipt) {
        setError({
          code: 'transcript_unavailable',
          message: 'No application transcript is available for this project.',
          retryable: false,
          source: 'host',
        })
        return
      }
      if (receipt.status !== 'succeeded') {
        setError(
          errorFromHost(
            receipt.error ?? unavailableError(receipt.status),
            'Transcript content is unavailable.',
          ),
        )
        return
      }
      await loadSectionsPage(receipt, null, true)
    } catch (caught) {
      if (requestGeneration.current !== generation) return
      setStatus(null)
      setSections([])
      loadedSectionCount.current = 0
      setError(errorFromHost(caught, 'The transcript could not be loaded.'))
    } finally {
      if (requestGeneration.current === generation) setLoading(false)
    }
  }, [canTranscribe, loadSectionsPage, port])

  useEffect(() => {
    if (!active || !port || !canTranscribe) return
    void refresh()
  }, [active, canTranscribe, port, refresh])

  const loadMore = useCallback(async () => {
    if (!status || status.status !== 'succeeded' || !nextCursor || !port || loadingMore) return
    setLoadingMore(true)
    try {
      await loadSectionsPage(status, nextCursor, false)
    } catch (caught) {
      setError(errorFromHost(caught, 'More transcript sections could not be loaded.'))
    } finally {
      setLoadingMore(false)
    }
  }, [loadSectionsPage, loadingMore, nextCursor, port, status])

  const normalizedQuery = query.trim().toLowerCase()
  const visibleSections = useMemo(() => {
    if (!normalizedQuery) return sections
    return sections.filter((section) => {
      const haystack = `${section.text} ${section.speaker ?? ''}`.toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [normalizedQuery, sections])

  const selectedSections = useMemo(
    () => sections.filter((section) => selectedIds.has(section.id)),
    [sections, selectedIds],
  )

  const selectSection = useCallback(
    (index: number, shiftKey: boolean) => {
      const section = visibleSections[index]
      if (!section) return
      setSelectedIds((current) => {
        const next = new Set(current)
        if (shiftKey && selectionAnchor !== null) {
          const lo = Math.min(selectionAnchor, index)
          const hi = Math.min(visibleSections.length - 1, Math.max(selectionAnchor, index))
          for (const candidate of visibleSections.slice(lo, hi + 1)) {
            if (next.size >= MAX_TRANSCRIPT_SELECTIONS && !next.has(candidate.id)) break
            next.add(candidate.id)
          }
        } else if (next.has(section.id)) {
          next.delete(section.id)
        } else if (next.size < MAX_TRANSCRIPT_SELECTIONS) {
          next.add(section.id)
        }
        return next
      })
      setSelectionAnchor(index)
      setPreview(null)
      setError(null)
    },
    [selectionAnchor, visibleSections],
  )

  // fallow-ignore-next-line complexity
  const previewSelection = useCallback(async () => {
    if (!port || !runtime || !status || status.status !== 'succeeded' || previewing) return
    if (!isOpaqueId(status.assetId)) {
      setError({
        code: 'transcript_content_unavailable',
        message: 'The succeeded transcript no longer has an asset binding.',
        retryable: false,
        source: 'validation',
      })
      return
    }
    setPreviewing(true)
    setError(null)
    setAnnouncement('Preparing a non-mutating transcript preview…')
    try {
      const ranges = rangesForSelection(selectedSections)
      const currentSnapshot = runtime.controller.getSnapshot()
      const request = {
        transcriptId: status.transcriptId,
        assetId: status.assetId,
        sourceAssetHash: status.sourceAssetHash,
        operationId: newOperationId('transcript-preview'),
        idempotencyKey: newOperationId('transcript-preview-key'),
        baseRevision: currentSnapshot.timeline.revision,
        action: 'captions' as const,
        timestampCapability: 'section' as const,
        ranges,
        captionTrackId: 'host-transcript-captions',
        captionTrackName: 'Transcript captions',
        captionLanguage: status.language ?? null,
        preconditions: [],
      }
      const result = normalizePreview(await port.previewCommands(request), {
        transcriptId: status.transcriptId,
        assetId: status.assetId,
        sourceAssetHash: status.sourceAssetHash,
        timelineId: currentSnapshot.timeline.timelineId,
        baseRevision: currentSnapshot.timeline.revision,
      })
      if (
        result.commandBatch.commands.some((command) => !commandIsSupported(command, capabilities))
      ) {
        throw new Error('The transcript preview contains an unsupported timeline command.')
      }
      setPreview(result)
      setAnnouncement(
        result.status === 'replayed'
          ? 'Transcript preview replayed safely.'
          : 'Transcript preview ready. The timeline was not changed.',
      )
    } catch (caught) {
      setPreview(null)
      const nextError =
        caught instanceof Error && caught.message.startsWith('Select')
          ? errorFromHost(
              { code: 'invalid_selection', message: caught.message, retryable: false },
              caught.message,
              'validation',
            )
          : errorFromHost(
              caught,
              'The transcript preview could not be prepared.',
              caught instanceof Error ? 'validation' : 'host',
            )
      setError(nextError)
      setAnnouncement(nextError.message)
    } finally {
      setPreviewing(false)
    }
  }, [capabilities, port, previewing, runtime, selectedSections, status])

  // fallow-ignore-next-line complexity
  const applyPreview = useCallback(async () => {
    if (!runtime || !preview || applying) return
    setApplying(true)
    setError(null)
    setAnnouncement('Applying transcript captions…')
    try {
      const result = await runtime.controller.submitEdit(preview.commandBatch)
      if (result.status === 'applied' || result.status === 'replayed') {
        setAnnouncement(
          result.status === 'replayed'
            ? 'Transcript captions replayed safely.'
            : 'Transcript captions applied.',
        )
        return
      }
      const message =
        result.status === 'unsupported'
          ? result.reason
          : result.status === 'conflict' || result.status === 'rejected'
            ? result.result.error.message || 'The transcript caption edit was rejected.'
            : 'The transcript caption edit was rejected.'
      setPreview(null)
      const nextError = errorFromHost(
        {
          code: result.status === 'conflict' ? 'revision_conflict' : 'transcript_apply_rejected',
          message,
          retryable: result.status === 'conflict',
        },
        message,
        'submission',
      )
      setError(nextError)
      setAnnouncement(message)
    } catch (caught) {
      setPreview(null)
      const nextError = errorFromHost(
        caught,
        'The transcript caption edit could not be applied.',
        'submission',
      )
      setError(nextError)
      setAnnouncement(nextError.message)
    } finally {
      setApplying(false)
    }
  }, [applying, preview, runtime])

  if (!port || !runtime || !canTranscribe) {
    return (
      <UnavailableTranscript
        error={{
          code: 'transcript_unavailable',
          message: 'Transcript access is unavailable for this host.',
          retryable: false,
          source: 'host',
        }}
      />
    )
  }

  if (loading) {
    return (
      <div
        className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"
        data-testid="host-transcript-loading"
        role="status"
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('transcript.loading', { defaultValue: 'Loading transcript…' })}
      </div>
    )
  }

  if (error && (!status || status.status !== 'succeeded')) {
    return <UnavailableTranscript error={error} onRetry={error.retryable ? refresh : undefined} />
  }

  return (
    <div
      className="flex h-full flex-col outline-none"
      data-testid="host-transcript-editor"
      role="region"
      aria-label={t('transcript.title', { defaultValue: 'Transcript' })}
    >
      <div className="flex items-center gap-2 border-b border-border p-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => {
              const next = event.target.value
              if (next.length <= MAX_TRANSCRIPT_QUERY_LENGTH) setQuery(next)
            }}
            placeholder={t('transcript.searchPlaceholder', { defaultValue: 'Search transcript' })}
            aria-label={t('transcript.searchPlaceholder', { defaultValue: 'Search transcript' })}
            className="h-8 pl-7 text-xs"
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => void refresh()}
          aria-label="Refresh transcript"
          data-testid="host-transcript-refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
        <span data-testid="host-transcript-status">{status?.status}</span>
        <span>
          {selectedIds.size}/{MAX_TRANSCRIPT_SELECTIONS} selected
        </span>
      </div>

      {error ? (
        <div
          className="flex items-start gap-2 border-b border-border bg-destructive/5 px-3 py-2 text-xs text-destructive"
          data-testid="host-transcript-error"
          role="alert"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error.message}</span>
          {error.retryable ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto h-6 shrink-0 px-2 text-xs"
              onClick={() => void refresh()}
            >
              Retry
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-2">
        {visibleSections.length === 0 ? (
          <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
            {normalizedQuery
              ? 'No transcript sections match this search.'
              : 'No transcript sections are available.'}
          </div>
        ) : (
          <div className="mx-auto max-w-[62ch] space-y-1">
            {visibleSections.map((section, index) => {
              const selected = selectedIds.has(section.id)
              return (
                <button
                  key={section.id}
                  type="button"
                  data-testid={`host-transcript-section-${section.id}`}
                  aria-pressed={selected}
                  onClick={(event) => selectSection(index, event.shiftKey)}
                  className={`grid w-full grid-cols-[3rem_minmax(0,1fr)] gap-x-3 rounded-md px-1 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary ${
                    selected
                      ? 'bg-primary text-primary-foreground'
                      : 'text-foreground/85 hover:bg-secondary/60'
                  }`}
                >
                  <span className="mt-px select-none text-right font-mono text-[11px] tabular-nums leading-7 opacity-70">
                    {formatTimecode(section.startUs)}
                  </span>
                  <span className="min-w-0 break-words text-[13px] leading-7">
                    {section.text}
                    {section.speaker ? (
                      <span className="ml-1 text-[11px] opacity-70">({section.speaker})</span>
                    ) : null}
                  </span>
                </button>
              )
            })}
          </div>
        )}
        {hasMore ? (
          <div className="flex justify-center py-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              data-testid="host-transcript-load-more"
            >
              {loadingMore && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Load more
              <ChevronDown className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </div>
        ) : null}
      </div>

      {preview ? (
        <div
          className="border-t border-border bg-secondary/30 px-3 py-2"
          data-testid="host-transcript-preview"
        >
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
            <div className="min-w-0 flex-1 text-xs">
              <p className="font-medium text-foreground">
                {preview.status === 'replayed' ? 'Preview replayed safely.' : 'Preview ready.'}
              </p>
              <p className="text-[11px] leading-4 text-muted-foreground">
                {preview.preview.captionCount ?? selectedIds.size} caption(s) · timeline unchanged
              </p>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            className="mt-2 w-full"
            onClick={() => void applyPreview()}
            disabled={applying}
            data-testid="host-transcript-apply"
          >
            {applying && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Apply captions
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-2">
        <span className="min-w-0 text-xs text-muted-foreground">
          {selectedIds.size > 0
            ? `${selectedIds.size} section${selectedIds.size === 1 ? '' : 's'} selected`
            : 'Select sections to preview captions'}
        </span>
        <Button
          type="button"
          size="sm"
          onClick={() => void previewSelection()}
          disabled={selectedIds.size === 0 || previewing || applying}
          data-testid="host-transcript-preview-button"
        >
          {previewing && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Preview captions
        </Button>
      </div>

      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  )
}
