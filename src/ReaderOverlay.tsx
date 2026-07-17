import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react'
import type { ProjectDetail } from './shared/types'
import { renderPageToDataUrl } from './canvasExport'
import { useI18n } from './i18n/context'

interface ReaderOverlayProps {
  detail: ProjectDetail
  initialPageIndex: number
  onClose: () => void
}

/**
 * Fullscreen reading preview of the rendered pages (bubbles included), turning
 * pages in the project's reading direction: in RTL manga the "next" page sits
 * to the LEFT, so ArrowLeft / clicking the left half advances.
 */
export function ReaderOverlay(props: ReaderOverlayProps) {
  const { detail, onClose } = props
  const { t } = useI18n()
  const pageCount = detail.pages.length
  const [pageIndex, setPageIndex] = useState(() => Math.min(Math.max(props.initialPageIndex, 0), Math.max(pageCount - 1, 0)))
  const [rendered, setRendered] = useState<Map<string, string>>(new Map())
  const renderQueue = useRef(new Set<string>())
  const isRtl = detail.project.readingDirection === 'rtl'

  const currentPage = detail.pages[pageIndex]
  const currentImage = currentPage ? rendered.get(currentPage.id) : undefined

  const renderIntoCache = useCallback(
    (pageId: string | undefined) => {
      if (!pageId || renderQueue.current.has(pageId)) return
      renderQueue.current.add(pageId)
      void renderPageToDataUrl(detail, pageId).then((dataUrl) => {
        if (!dataUrl) return
        setRendered((current) => {
          const next = new Map(current)
          next.set(pageId, dataUrl)
          return next
        })
      })
    },
    [detail],
  )

  // Render the visible page, then prefetch its neighbors for instant turns.
  useEffect(() => {
    renderIntoCache(detail.pages[pageIndex]?.id)
    renderIntoCache(detail.pages[pageIndex + 1]?.id)
    renderIntoCache(detail.pages[pageIndex - 1]?.id)
  }, [detail, pageIndex, renderIntoCache])

  const goToNext = useCallback(() => {
    setPageIndex((current) => Math.min(current + 1, pageCount - 1))
  }, [pageCount])

  const goToPrevious = useCallback(() => {
    setPageIndex((current) => Math.max(current - 1, 0))
  }, [])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      } else if (event.key === 'ArrowLeft') {
        if (isRtl) goToNext()
        else goToPrevious()
      } else if (event.key === 'ArrowRight') {
        if (isRtl) goToPrevious()
        else goToNext()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isRtl, goToNext, goToPrevious, onClose])

  const leftLabel = isRtl ? t('reader.nextPage') : t('reader.previousPage')
  const rightLabel = isRtl ? t('reader.previousPage') : t('reader.nextPage')

  return (
    <div className="reader-overlay" role="dialog" aria-modal="true" aria-label={t('reader.title')} data-testid="reader-overlay">
      <header className="reader-chrome">
        <span className="reader-direction">{isRtl ? t('layout.readingRtl') : t('layout.readingLtr')}</span>
        <span className="reader-indicator" data-testid="reader-indicator">
          {t('reader.pageIndicator', { current: pageIndex + 1, total: pageCount })}
        </span>
        <button type="button" className="icon-button" aria-label={t('reader.close')} data-testid="reader-close" onClick={onClose}>
          <X size={17} />
        </button>
      </header>
      <div className="reader-stage">
        <button
          type="button"
          className="reader-turn-zone left"
          aria-label={leftLabel}
          data-testid="reader-turn-left"
          onClick={() => (isRtl ? goToNext() : goToPrevious())}
        >
          <ChevronLeft size={26} />
        </button>
        {currentImage ? (
          <img className="reader-page" src={currentImage} alt={t('reader.pageAlt', { n: pageIndex + 1 })} data-testid="reader-image" />
        ) : (
          <div className="reader-loading">
            <Loader2 size={26} />
          </div>
        )}
        <button
          type="button"
          className="reader-turn-zone right"
          aria-label={rightLabel}
          data-testid="reader-turn-right"
          onClick={() => (isRtl ? goToPrevious() : goToNext())}
        >
          <ChevronRight size={26} />
        </button>
      </div>
    </div>
  )
}
