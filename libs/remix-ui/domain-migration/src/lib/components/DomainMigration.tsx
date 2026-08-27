import React, { useCallback, useEffect, useRef, useState } from 'react'
import { estimateStorage, formatBytes, getFs, MigrationPreview, previewFileSystem, StorageEstimate } from '../archive'
import { ExportResult, exportArchive, pickSaveTarget } from '../exporter'
import { clearResumeState, importArchive, OpenedArchive, openArchive, readResumeState } from '../importer'
import { ImportResult, MigrationProgress } from '../types'

export interface DomainMigrationProps {
  plugin?: any
  /** Host users are being moved to, e.g. 'app.remix.live'. */
  targetOrigin?: string
  /** 'import' when arriving on the new domain via the handoff link. */
  initialMode?: 'export' | 'import'
}

type Stage = 'export' | 'handoff' | 'import'

const STEPS: { id: Stage; label: string }[] = [
  { id: 'export', label: 'Export here' },
  { id: 'handoff', label: 'Open new site' },
  { id: 'import', label: 'Import there' }
]

const phaseLabels: Record<string, string> = {
  scanning: 'Reading and checksumming your files',
  packing: 'Compressing the archive',
  writing: 'Saving to disk',
  reading: 'Opening the archive',
  importing: 'Restoring your files',
  done: 'Finished'
}

export const DomainMigration: React.FC<DomainMigrationProps> = ({ plugin, targetOrigin, initialMode }) => {
  const [stage, setStage] = useState<Stage>(initialMode === 'import' ? 'import' : 'export')
  const [storage, setStorage] = useState<StorageEstimate | null>(null)
  const [preview, setPreview] = useState<MigrationPreview | null>(null)
  const [progress, setProgress] = useState<MigrationProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportResult, setExportResult] = useState<ExportResult | null>(null)
  const [archive, setArchive] = useState<OpenedArchive | null>(null)
  const [canResume, setCanResume] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const handoffUrl = targetOrigin ? `https://${targetOrigin}/#migrate=import` : null

  useEffect(() => {
    estimateStorage().then(setStorage)
  }, [])

  useEffect(() => {
    if (stage !== 'export' || preview) return
    previewFileSystem(getFs()).then(setPreview).catch(() => setPreview(null))
  }, [stage, preview])

  const onExport = useCallback(async () => {
    setError(null)
    setExportResult(null)
    // Picker first: awaiting anything before it would spend the user gesture.
    const target = await pickSaveTarget()
    setBusy(true)
    try {
      const result = await exportArchive(target, setProgress)
      setExportResult(result)
      setProgress(null)
      setStage('handoff')
    } catch (e: any) {
      setError(e?.message || String(e))
      setProgress(null)
    } finally {
      setBusy(false)
    }
  }, [])

  const onPickArchive = useCallback(async (file: File) => {
    setError(null)
    setImportResult(null)
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
        setProgress(null)
      }
    },
    [archive]
  )

  const copyHandoff = () => {
    if (!handoffUrl) return
    navigator.clipboard?.writeText(handoffUrl).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2500)
      },
      () => setError('Could not copy the link. Select and copy it manually.')
    )
  }

  return (
    <div className="p-4 overflow-auto h-100" data-id="domainMigration">
      <h4 className="mb-1">Move your projects</h4>
      <p className="text-secondary small mb-4">
        Your files are stored by this browser under <strong>{window.location.host}</strong> and cannot follow you to a
        new address on their own. This takes three steps.
      </p>

      <Stepper current={stage} />

      {stage === 'export' && (
        <section data-id="domainMigrationExport">
          <StepHeading n={1} title="Export your projects to a file" />

          {preview && (
            <div className="border rounded p-3 mb-3" data-id="domainMigrationPreview">
              <div className="small mb-1">
                <strong>{preview.workspaces.length}</strong> workspaces · <strong>{preview.fileCount}</strong> files ·{' '}
                {formatBytes(preview.totalBytes)}
              </div>
              {preview.workspaces.length > 0 && (
                <div className="small text-secondary">{preview.workspaces.join(', ')}</div>
              )}
              {preview.cloudWorkspaces.length > 0 && (
                <div className="small text-secondary mt-2">
                  <i className="fas fa-cloud me-1" />
                  {preview.cloudWorkspaces.length} cloud workspace
                  {preview.cloudWorkspaces.length > 1 ? 's are' : ' is'} not included — sign in on the new site and they
                  sync back automatically.
                </div>
              )}
            </div>
          )}

          <button className="btn btn-primary" onClick={onExport} disabled={busy} data-id="domainMigrationExportBtn">
            {busy ? 'Exporting…' : 'Export my projects'}
          </button>
          <p className="small text-secondary mt-2 mb-0">
            Your browser will ask where to save the file. Every file is checksummed so the import can verify it.
          </p>
        </section>
      )}

      {stage === 'handoff' && (
        <section data-id="domainMigrationHandoff">
          <StepHeading n={2} title="Open the new site and continue there" />

          {exportResult && (
            <div className="alert alert-success py-2" data-id="domainMigrationExportDone">
              Saved <code>{exportResult.fileName}</code> — {exportResult.manifest.totalFiles} files (
              {formatBytes(exportResult.manifest.totalBytes)}).
            </div>
          )}

          <p className="small mb-3">
            The link below opens {targetOrigin ? <strong>{targetOrigin}</strong> : 'the new site'} and takes you straight
            to the import step, where you will be asked for the file you just saved.
          </p>

          {handoffUrl ? (
            <>
              <div className="d-flex flex-wrap gap-2 mb-2">
                <a
                  className="btn btn-primary"
                  href={handoffUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-id="domainMigrationHandoffLink"
                >
                  <i className="fas fa-arrow-up-right-from-square me-2" />
                  Open {targetOrigin} and import
                </a>
                <button className="btn btn-secondary" onClick={copyHandoff} data-id="domainMigrationCopyLink">
                  <i className={`fas ${copied ? 'fa-check' : 'fa-copy'} me-2`} />
                  {copied ? 'Copied' : 'Copy link'}
                </button>
              </div>
              <p className="small text-secondary">
                Keep this tab open until the import has finished, in case you need to export again.
              </p>
            </>
          ) : (
            <div className="alert alert-warning small">
              The new address has not been configured yet. Keep the exported file safe and import it once the new site is
              announced.
            </div>
          )}

          <button
            className="btn btn-link btn-sm ps-0"
            onClick={() => setStage('export')}
            data-id="domainMigrationBackToExport"
          >
            <i className="fas fa-arrow-left me-1" /> Export again
          </button>
        </section>
      )}

      {stage === 'import' && (
        <section data-id="domainMigrationImport">
          <StepHeading n={3} title="Import the file you exported" />

          {!archive && !importResult && (
            <div
              className={`border rounded p-4 text-center mb-3 ${dragging ? 'border-primary' : 'border-secondary'}`}
              style={{ borderStyle: 'dashed', cursor: 'pointer' }}
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                const file = e.dataTransfer.files?.[0]
                if (file) onPickArchive(file)
              }}
              data-id="domainMigrationDropzone"
            >
              <i className="fas fa-file-archive fa-2x text-secondary mb-2 d-block" />
              <div className="fw-bold">Drop your migration archive here</div>
              <div className="small text-secondary">or click to browse for the .zip you exported</div>
            </div>
          )}

          <input
            ref={fileInput}
            type="file"
            accept=".zip,application/zip"
            className="d-none"
            disabled={busy}
            data-id="domainMigrationFileInput"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onPickArchive(file)
            }}
          />

          {archive && !importResult && (
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

              <div className="mt-3 d-flex gap-2 align-items-center">
                {canResume && (
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={busy}
                    onClick={() => onImport(true)}
                    data-id="domainMigrationResumeBtn"
                  >
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
                <button className="btn btn-sm btn-link" disabled={busy} onClick={() => setArchive(null)}>
                  Choose a different file
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
                  Renamed to avoid overwriting existing workspaces:{' '}
                  {Object.entries(importResult.renamedWorkspaces)
                    .map(([from, to]) => `${from} → ${to}`)
                    .join(', ')}
                </div>
              )}
              <button
                className="btn btn-sm btn-primary mt-2"
                onClick={() => window.location.reload()}
                data-id="domainMigrationReload"
              >
                Reload Remix to see your projects
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

          {!importResult && (
            <button
              className="btn btn-link btn-sm ps-0"
              onClick={() => setStage('export')}
              data-id="domainMigrationBackFromImport"
            >
              <i className="fas fa-arrow-left me-1" /> I need to export first
            </button>
          )}
        </section>
      )}

      {progress && progress.phase !== 'done' && <Progress progress={progress} />}

      {error && (
        <div className="alert alert-danger mt-3" data-id="domainMigrationError">
          {error}
        </div>
      )}

      {storage?.known && (
        <p className="small text-secondary mt-4 mb-0" data-id="domainMigrationStorage">
          Browser storage: {formatBytes(storage.usage)} used of {formatBytes(storage.quota)} (
          {formatBytes(storage.available)} free)
        </p>
      )}
    </div>
  )
}

const Stepper: React.FC<{ current: Stage }> = ({ current }) => {
  const currentIndex = STEPS.findIndex((s) => s.id === current)
  return (
    <div className="d-flex align-items-center mb-4" data-id="domainMigrationStepper">
      {STEPS.map((step, i) => {
        const done = i < currentIndex
        const active = i === currentIndex
        return (
          <React.Fragment key={step.id}>
            <div className="d-flex align-items-center gap-2">
              <span
                className={`d-inline-flex align-items-center justify-content-center rounded-circle ${
                  active ? 'bg-primary text-white' : done ? 'bg-success text-white' : 'bg-secondary text-white'
                }`}
                style={{ width: 26, height: 26, fontSize: 12, fontWeight: 600, opacity: active || done ? 1 : 0.45 }}
              >
                {done ? <i className="fas fa-check" /> : i + 1}
              </span>
              <span className={`small ${active ? 'fw-bold' : 'text-secondary'}`}>{step.label}</span>
            </div>
            {i < STEPS.length - 1 && <div className="flex-fill border-top mx-2" style={{ minWidth: 16 }} />}
          </React.Fragment>
        )
      })}
    </div>
  )
}

const StepHeading: React.FC<{ n: number; title: string }> = ({ n, title }) => (
  <h6 className="mb-3">
    <span className="text-secondary me-2">Step {n}</span>
    {title}
  </h6>
)

const Progress: React.FC<{ progress: MigrationProgress }> = ({ progress }) => {
  const percent = progress.fraction === null ? null : Math.round(progress.fraction * 100)
  return (
    <div className="mt-3" data-id="domainMigrationProgress">
      <div className="d-flex justify-content-between small mb-1">
        <span>{phaseLabels[progress.phase] || progress.phase}</span>
        <span className="text-secondary">
          {progress.filesTotal > 0 ? `${progress.filesDone} / ${progress.filesTotal} files` : `${progress.filesDone} files`}
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
      {progress.currentPath && <div className="small text-secondary text-truncate mt-1">{progress.currentPath}</div>}
    </div>
  )
}
