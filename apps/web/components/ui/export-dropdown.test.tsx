// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ExportDropdown is shared by the requests, traces, anomalies and security
// pages. It used to await the download inside try/finally with no catch, so a
// failed export only flipped "Exporting…" back to "Export" and the rejection
// went unhandled (XVERIFY-2026-09-28 C10.3). These tests pin that a failure
// is shown, can be retried, and that the menu says what it can and cannot do.

const apiDownload = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api', async () => {
  class ApiError extends Error {
    constructor(message: string, public status: number, public code: string | null = null) {
      super(message)
    }
  }
  class DownloadInterruptedError extends Error {}
  return { apiDownload, ApiError, DownloadInterruptedError }
})

import { ExportDropdown } from './export-dropdown'
import { ApiError, DownloadInterruptedError } from '@/lib/api'

const buildUrl = (fmt: 'csv' | 'json') => `/api/v1/exports/requests?format=${fmt}`

beforeEach(() => {
  apiDownload.mockReset()
})

async function exportAs(format: 'CSV' | 'JSON'): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: /export/i }))
  await userEvent.click(screen.getByRole('menuitem', { name: format }))
}

describe('ExportDropdown', () => {
  test('a failed export shows the reason instead of silently resetting', async () => {
    apiDownload.mockRejectedValue(new ApiError('from must be a valid ISO date', 400))
    render(<ExportDropdown buildUrl={buildUrl} filename="spanlens-requests" />)

    await exportAs('CSV')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('from must be a valid ISO date')
    expect(screen.getByRole('button', { name: /export/i })).toBeEnabled()
  })

  test('an interrupted download says nothing was saved', async () => {
    apiDownload.mockRejectedValue(new DownloadInterruptedError('The download was interrupted'))
    render(<ExportDropdown buildUrl={buildUrl} filename="spanlens-requests" />)

    await exportAs('CSV')

    expect(await screen.findByRole('alert')).toHaveTextContent(/interrupted/i)
  })

  test('a network failure gets a readable message, not the raw TypeError', async () => {
    apiDownload.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<ExportDropdown buildUrl={buildUrl} filename="spanlens-requests" />)

    await exportAs('JSON')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not reach the server/i)
    expect(alert).not.toHaveTextContent('Failed to fetch')
  })

  test('Retry repeats the same format and clears the error on success', async () => {
    apiDownload.mockRejectedValueOnce(new ApiError('Failed to export requests', 500))
    apiDownload.mockResolvedValueOnce({ bytes: 42 })
    render(<ExportDropdown buildUrl={buildUrl} filename="spanlens-requests" />)

    await exportAs('JSON')
    await screen.findByRole('alert')
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))

    expect(apiDownload).toHaveBeenCalledTimes(2)
    expect(apiDownload.mock.calls[1]?.[0]).toBe('/api/v1/exports/requests?format=json')
    expect(apiDownload.mock.calls[1]?.[1]).toMatch(/^spanlens-requests-\d{4}-\d{2}-\d{2}\.json$/)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('the error can be dismissed', async () => {
    apiDownload.mockRejectedValue(new ApiError('nope', 500))
    render(<ExportDropdown buildUrl={buildUrl} filename="spanlens-requests" />)

    await exportAs('CSV')
    await screen.findByRole('alert')
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('shows how much has arrived while a large export downloads', async () => {
    let finish: (value: { bytes: number }) => void = () => {}
    apiDownload.mockImplementation(
      (_url: string, _name: string, opts?: { onProgress?: (bytes: number) => void }) =>
        new Promise((resolve) => {
          opts?.onProgress?.(3 * 1024 * 1024)
          finish = resolve
        }),
    )
    render(<ExportDropdown buildUrl={buildUrl} filename="spanlens-requests" />)

    await exportAs('CSV')

    expect(await screen.findByRole('button', { name: /exporting.*3\.0 MB/i })).toBeDisabled()
    finish({ bytes: 3 * 1024 * 1024 })
    expect(await screen.findByRole('button', { name: /^export$/i })).toBeEnabled()
  })

  test('the menu explains the JSON cap and where large exports belong', async () => {
    render(<ExportDropdown buildUrl={buildUrl} filename="spanlens-requests" />)
    await userEvent.click(screen.getByRole('button', { name: /export/i }))

    expect(screen.getByText(/JSON stops at 10,000 rows/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /export api/i })).toHaveAttribute(
      'href',
      '/docs/features/export',
    )
  })
})
