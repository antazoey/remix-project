import React, { useCallback, useEffect, useRef, useState } from 'react'
import { estimateStorage, formatBytes, StorageEstimate } from '../archive'
import { ExportResult, exportArchive, pickSaveTarget } from '../exporter'
import { clearResumeState, importArchive, OpenedArchive, openArchive, readResumeState } from '../importer'
import { ImportResult, MigrationProgress } from '../types'

export interface DomainMigrationProps {
  plugin?: any
  /** Origin users are being moved to, shown in the export instructions. */
  targetOrigin?: string
}

type Mode = 'home' | 'export' | 'import'

const phaseLabels: Record<string, string> = {
  scanning: 'Reading and checksumming your files',
  packing: 'Compressing the archive',
  writing: 'Saving to disk',
  reading: 'Opening the archive',
  importing: 'Restoring your files',
  done: 'Finished'
}

export const DomainMigration: React.FC<DomainMigrationProps> = ({ plugin, targetOrigin }) => {
  const [mode, setMode] = useState<Mode>('home')
  const [storage, setStorage] = useState<StorageEstimate | null>(null)
  const [progress, setProgress] = useState<MigrationProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportResult, setExportResult] = useState<ExportResult | null>(null)
  const [archive, setArchive] = useState<OpenedArchive | null>(null)
  const [canResume, setCanResume] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    estimateStorage().then(setStorage)
  }, [])

  const reset = () => {
    setError(null)
    setProgress(null)
    setExportResult(null)
    setImportResult(null)
  }

  const onExport = useCallback(async () => {
    reset()
    // Picker first: awaiting anything before it would spend the user gesture.
    const target = await pickSaveTarget()
    setBusy(true)
    try {
      setExportResult(await exportArchive(target, setProgress))
    } catch (e: any) {
      setError(e?.message || String(e))
      setProgress(null)
    } finally {
      setBusy(false)
    }
  }, [])

  const onPickArchive = useCallback(async (file: File) => {
    reset()
    setArchive(null)
    setBusy(true)
    try {
      const opened = await openArchive(file)
      setArchive(opened)
      setCanResume(!!readResumeState(opened.archiveId))
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  const onImport = useCallback(
    async (resume: boolean) => {
      if (!archive) return
      setError(null)
      setImportResult(null)
      setBusy(true)
      try {
        setImportResult(await importArchive(archive, { resume }, setProgress))
        setCanResume(false)
      } catch (e: any) {
        setError(e?.message || String(e))
        setCanResume(!!readResumeState(archive.archiveId))
      } finally {
        setBusy(false)
      }
    },
    [archive]
  )

  return (
    <div className="p-4 overflow-auto h-100" data-id="domainMigration">
      <h4 className="mb-1">Move your projects</h4>
      <p className="text-secondary small mb-4">
        Your files live in this browser, tied to <strong>{window.location.origin}</strong>. Export them to an archive,
        then import that archive on {targetOrigin ? <strong>{targetOrigin}</strong> : 'the new domain'}. Nothing is
        deleted here — the archive is a copy.
      </p>

      {storage?.known && (
        <p className="small text-secondary mb-4" data-id="domainMigrationStorage">
          Browser storage: {formatBytes(storage.usage)} used of {formatBytes(storage.quota)} ({formatBytes(storage.available)} free)
        </p>
      )}

      {mode === 'home' && (
        <div className="d-flex flex-column flex-md-row gap-3">
          <ActionCard
            icon="fa-box-archive"
            title="Export my projects"
            body="Package every workspace and your settings into a single verified archive."
            label="Export"
            dataId="domainMigrationExportCard"
            onClick={() => {
              reset()
              setMode('export')
            }}
          />
          <ActionCard
            icon="fa-download"
            title="Import an archive"
            body="Restore an archive exported from the old domain. Existing workspaces are kept."
            label="Import"
            dataId="domainMigrationImportCard"
            onClick={() => {
              reset()
              setMode('import')
            }}
          />
        </div>
      )}

      {mode === 'export' && (
        <section data-id="domainMigrationExport">
          <BackLink onClick={() => setMode('home')} disabled={busy} />
          <button className="btn btn-primary" onClick={onExport} disabled={busy} data-id="domainMigrationExportBtn">
            {busy ? 'Exporting…' : 'Export my projects'}
          </button>
          <p className="small text-secondary mt-2 mb-0">
            Every file is checksummed as it is packed, and the checksums are verified on import.
          </p>

          {exportResult && (
            <div className="alert alert-success mt-3" data-id="domainMigrationExportDone">
              <div>
                Exported <strong>{exportResult.manifest.totalFiles}</strong> files (
                {formatBytes(exportResult.manifest.totalBytes)}) from{' '}
                <strong>{exportResult.manifest.workspaces.length}</strong> workspaces, plus{' '}
                {Object.keys(exportResult.manifest.config).length} settings.
              </div>
              <div className="small mt-2 mb-0">
                Saved as <code>{exportResult.fileName}</code>. Keep it until you have confirmed your projects opened on
                the new domain.
              </div>
            </div>
          )}
        </section>
      )}

      {mode === 'import' && (
        <section data-id="domainMigrationImport">
          <BackLink onClick={() => setMode('home')} disabled={busy} />
          <input
            ref={fileInput}
            type="file"
            accept=".zip,application/zip"
            className="form-control mb-3"
            disabled={busy}
            data-id="domainMigrationFileInput"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onPickArchive(file)
            }}
          />

          {archive && (
            <div className="border rounded p-3 mb-3" data-id="domainMigrationSummary">
              <div className="small">
                <strong>{archive.manifest.totalFiles}</strong> files ({formatBytes(archive.manifest.totalBytes)}) from{' '}
                <strong>{archive.manifest.sourceOrigin}</strong>
              </div>
              <div className="small text-secondary">
                Exported {new Date(archive.manifest.createdAt).toLocaleString()} ·{' '}
                {archive.manifest.workspaces.length} workspaces ·{' '}
                {Object.keys(archive.manifest.config || {}).length} settings
              </div>

              {canResume && (
                <div className="alert alert-info mt-3 mb-0 py-2 small" data-id="domainMigrationResume">
                  A previous import of this archive was interrupted. You can carry on where it stopped.
                </div>
              )}

              <div className="mt-3 d-flex gap-2">
                {canResume && (
                  <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onImport(true)} data-id="domainMigrationResumeBtn">
                    Resume import
                  </button>
                )}
                <button
                  className={`btn btn-sm ${canResume ? 'btn-secondary' : 'btn-primary'}`}
                  disabled={busy}
                  onClick={() => {
                    clearResumeState(archive.archiveId)
                    setCanResume(false)
                    onImport(false)
                  }}
                  data-id="domainMigrationImportBtn"
                >
                  {canResume ? 'Start over' : busy ? 'Importing…' : 'Import everything'}
                </button>
              </div>
            </div>
          )}

          {importResult && (
            <div className="alert alert-success" data-id="domainMigrationImportDone">
              <div>
                Restored <strong>{importResult.imported}</strong> files
                {importResult.skipped > 0 && <> ({importResult.skipped} already done)</>}, applied{' '}
                {importResult.configApplied} settings.
              </div>
              {Object.keys(importResult.renamedWorkspaces).length > 0 && (
                <div className="small mt-2">
                  Renamed to avoid overwriting your existing workspaces:{' '}
                  {Object.entries(importResult.renamedWorkspaces)
                    .map(([from, to]) => `${from} → ${to}`)
                    .join(', ')}
                </div>
              )}
              <button className="btn btn-sm btn-primary mt-2" onClick={() => window.location.reload()} data-id="domainMigrationReload">
                Reload Remix to see them
              </button>
            </div>
          )}

          {importResult && importResult.issues.length > 0 && (
            <div className="alert alert-warning" data-id="domainMigrationIssues">
              <strong>{importResult.issues.length} files could not be restored.</strong>
              <ul className="small mt-2 mb-0 ps-3">
                {importResult.issues.slice(0, 10).map((issue) => (
                  <li key={issue.path}>
                    <code>{issue.path}</code> — {issue.reason}
                  </li>
                ))}
              </ul>
              {importResult.issues.length > 10 && (
                <div className="small mt-1">…and {importResult.issues.length - 10} more.</div>
              )}
            </div>
          )}
        </section>
      )}

      {progress && progress.phase !== 'done' && <Progress progress={progress} />}

      {error && (
        <div className="alert alert-danger mt-3" data-id="domainMigrationError">
          {error}
        </div>
      )}
    </div>
  )
}

const Progress: React.FC<{ progress: MigrationProgress }> = ({ progress }) => {
  const percent = progress.fraction === null ? null : Math.round(progress.fraction * 100)
  return (
    <div className="mt-3" data-id="domainMigrationProgress">
      <div className="d-flex justify-content-between small mb-1">
        <span>{phaseLabels[progress.phase] || progress.phase}</span>
        <span className="text-secondary">
          {progress.filesTotal > 0
            ? `${progress.filesDone} / ${progress.filesTotal} files`
            : `${progress.filesDone} files`}
          {percent !== null && ` · ${percent}%`}
        </span>
      </div>
      <div className="progress" style={{ height: '6px' }}>
        <div
          className={`progress-bar${percent === null ? ' progress-bar-striped progress-bar-animated' : ''}`}
          role="progressbar"
          aria-valuenow={percent ?? undefined}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{ width: percent === null ? '100%' : `${percent}%` }}
        />
      </div>
      {progress.currentPath && (
        <div className="small text-secondary text-truncate mt-1">{progress.currentPath}</div>
      )}
    </div>
  )
}

const BackLink: React.FC<{ onClick: () => void; disabled: boolean }> = ({ onClick, disabled }) => (
  <button className="btn btn-link btn-sm ps-0 mb-2" onClick={onClick} disabled={disabled}>
    <i className="fas fa-arrow-left me-1" /> Back
  </button>
)

const ActionCard: React.FC<{
  icon: string
  title: string
  body: string
  label: string
  dataId: string
  onClick: () => void
}> = ({ icon, title, body, label, dataId, onClick }) => (
  <div className="border rounded p-3 flex-fill" data-id={dataId}>
    <h6 className="mb-2">
      <i className={`fas ${icon} me-2`} />
      {title}
    </h6>
    <p className="small text-secondary">{body}</p>
    <button className="btn btn-sm btn-primary" onClick={onClick}>
      {label}
    </button>
  </div>
)
