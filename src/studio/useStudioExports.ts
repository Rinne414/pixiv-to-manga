import { useState } from 'react'
import type { Page, ProjectDetail } from '../shared/types'
import { renderPageToDataUrl, renderProjectPages } from '../canvasExport'
import * as api from '../api'

interface ExportDeps {
  detail: ProjectDetail | null
  activePage: Page | undefined
  runTask: (label: string, task: () => Promise<void>) => Promise<void>
  pushLog: (message: string, level?: 'info' | 'success' | 'error', options?: { toast?: boolean }) => void
  labels: {
    exportZip: string
    exportCbz: string
    exportPdf: string
    exportBackupTask: string
    noPagesToExport: string
    exported: (fileName: string) => string
    backupExported: (fileName: string) => string
    exportPageLabel: (pageNumber: number) => string
    pageExported: (pageNumber: number) => string
  }
}

/** Rendered-page and backup exports; every path marks the onboarding export step done. */
export function useStudioExports(deps: ExportDeps) {
  const [hasExported, setHasExported] = useState(false)
  const { detail, labels } = deps

  async function exportRenderedAs(
    taskLabel: string,
    send: (input: { projectId: string; pages: Array<{ pageId: string; dataUrl: string }> }) => Promise<{ fileName: string; url: string }>,
  ) {
    if (!detail) return
    await deps.runTask(taskLabel, async () => {
      const pages = await renderProjectPages(detail)
      if (!pages.length) {
        throw new Error(labels.noPagesToExport)
      }
      const result = await send({ projectId: detail.project.id, pages })
      setHasExported(true)
      deps.pushLog(labels.exported(result.fileName), 'success')
      window.open(result.url, '_blank', 'noopener,noreferrer')
    })
  }

  async function handleExportZip() {
    await exportRenderedAs(labels.exportZip, (input) => api.exportZip({ ...input, format: 'zip' }))
  }

  async function handleExportCbz() {
    await exportRenderedAs(labels.exportCbz, (input) => api.exportZip({ ...input, format: 'cbz' }))
  }

  async function handleExportPdf() {
    await exportRenderedAs(labels.exportPdf, (input) => api.exportPdf(input))
  }

  async function handleExportActivePage() {
    const activePage = deps.activePage
    if (!detail || !activePage) return
    const pageNumber = activePage.index + 1
    await deps.runTask(labels.exportPageLabel(pageNumber), async () => {
      const dataUrl = await renderPageToDataUrl(detail, activePage.id)
      if (!dataUrl) {
        throw new Error(labels.noPagesToExport)
      }
      const anchor = document.createElement('a')
      anchor.href = dataUrl
      anchor.download = `${sanitizeFileName(detail.project.title)}-page-${String(pageNumber).padStart(3, '0')}.png`
      anchor.click()
      setHasExported(true)
      deps.pushLog(labels.pageExported(pageNumber), 'success')
    })
  }

  async function handleExportBackup() {
    if (!detail) return
    await deps.runTask(labels.exportBackupTask, async () => {
      const result = await api.exportProjectBackup({ projectId: detail.project.id })
      deps.pushLog(labels.backupExported(result.fileName), 'success')
      window.open(result.url, '_blank', 'noopener,noreferrer')
    })
  }

  return {
    hasExported,
    handleExportZip,
    handleExportCbz,
    handleExportPdf,
    handleExportActivePage,
    handleExportBackup,
  }
}

function sanitizeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, '_').trim() || 'manga'
}
