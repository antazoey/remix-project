import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { estimateStorage, formatBytes, getFs, MigrationPreview, previewFileSystem, StorageEstimate } from '../archive'
import { ExportResult, exportArchive, pickSaveTarget } from '../exporter'
import { clearResumeState, importArchive, OpenedArchive, openArchive, readResumeState } from '../importer'
import { setPendingConfirmation } from '../domain-config'
import { ImportResult, MigrationProgress } from '../types'

export interface DomainMigrationProps {
  plugin?: any
  /** Host users are being moved to, e.g. 'app.remix.live'. */
  targetOrigin?: string
  /** Hosts the move is coming from, used to vet an archive's stated origin. */
  fromDomains?: string[]
  /** ISO date the old origin stops being updated. */
  deadline?: string | null
  /** 'import' when arriving on the new domain via the handoff link. */
  initialMode?: 'export' | 'import'
}

type Stage = 'export' | 'handoff' | 'import'

const STEPS: { id: Stage; label: string; hint: string }[] = [
  { id: 'export', label: 'Export', hint: 'Pack your projects' },
  { id: 'handoff', label: 'Move over', hint: 'Open the new site' },
  { id: 'import', label: 'Import', hint: 'Restore them there' }
]

const phaseLabels: Record<string, string> = {
  scanning: 'Reading and checksumming your files',
  packing: 'Compressing the archive',
  writing: 'Saving to disk',
  reading: 'Opening the archive',
  importing: 'Restoring your files',
  done: 'Finished'
}

// Mirrors the help modals so the flow from announcement to wizard feels continuous.
const c = {
  bg: '#1a1a2e',
  s1: '#222240',
  s2: '#2a2a4a',
  cy: '#2fbfb1',
  tx: '#e0e0ec',
  tm: '#8888aa',
  td: '#5c5c7a',
  pu: '#9b7dff',
  am: '#f0a030',
  gn: '#6bdb8a',
  rd: '#e8686b'
}

const KEYFRAMES = `
  @keyframes dmwIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes dmwDrift { 0%,100% { transform: translateX(0); } 50% { transform: translateX(4px); } }
  @keyframes dmwPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.55; } }
`

const mono = "'JetBrains Mono', monospace"
const sans = "'DM Sans', sans-serif"

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((t - Date.now()) / 86400000))
}

export const DomainMigration: React.FC<DomainMigrationProps> = ({ targetOrigin, fromDomains, deadline, initialMode }) => {
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

  const destination = targetOrigin || 'the new site'
  const handoffUrl = targetOrigin ? `https://${targetOrigin}/#migrate=import` : null
  const days = useMemo(() => daysUntil(deadline), [deadline])

  // Link back to the origin the archive came from, so it can record the move
  // and redirect on later visits. Carries no destination: that origin resolves
  // it from config, so a crafted link can't point Remix somewhere else.
  //
  // The manifest is a user-supplied file, so its stated origin is only trusted
  // when it is one of the configured migration origins — otherwise a crafted
  // archive could get Remix to present an attacker's domain as the next step.
  const sourceHost = useMemo(() => {
    if (!archive?.manifest?.sourceOrigin) return null
    try {
      const url = new URL(archive.manifest.sourceOrigin)
      const host = url.host.toLowerCase()
      if (!host || host === window.location.host.toLowerCase()) return null
      if (!url.protocol.startsWith('http')) return null
      return (fromDomains || []).includes(host) ? host : null
    } catch {
      return null
    }
  }, [archive, fromDomains])
  const confirmUrl = sourceHost ? `${archive!.manifest.sourceOrigin.replace(/\/$/, '')}/#migrated` : null

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
        // Survives the reload below, so the confirmation step stays reachable.
        if (sourceHost) setPendingConfirmation(archive.manifest.sourceOrigin)
      } catch (e: any) {
        setError(e?.message || String(e))
        setCanResume(!!readResumeState(archive.archiveId))
      } finally {
        setBusy(false)
        setProgress(null)
      }
    },
    [archive, sourceHost]
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
    <div
      data-id="domainMigration"
      style={{ background: c.bg, color: c.tx, fontFamily: sans, height: '100%', overflowY: 'auto' }}
    >
      <style>{KEYFRAMES}</style>

      <div style={{ maxWidth: 780, margin: '0 auto', padding: '32px 24px 48px' }}>
        <Hero destination={destination} targetOrigin={targetOrigin} days={days} />
        <WhyPanel destination={destination} />
        <Stepper current={stage} />

        <div style={{ animation: 'dmwIn 0.3s ease' }}>
          {stage === 'export' && (
            <Card accent={c.cy} data-id="domainMigrationExport">
              <CardTitle step={1} accent={c.cy}>Pack your projects into one file</CardTitle>

              {preview ? (
                <>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                    <Stat label="Workspaces" value={String(preview.workspaces.length)} accent={c.cy} />
                    <Stat label="Files" value={String(preview.fileCount)} accent={c.pu} />
                    <Stat label="Size" value={formatBytes(preview.totalBytes)} accent={c.gn} />
                  </div>
                  {preview.workspaces.length > 0 && (
                    <div style={{ fontSize: 11.5, color: c.tm, marginBottom: 12, lineHeight: 1.5 }}>
                      Including: {preview.workspaces.map((w) => <Tag key={w}>{w}</Tag>)}
                    </div>
                  )}
                  {preview.cloudWorkspaces.length > 0 && (
                    <Note color={c.pu} icon="fas fa-cloud">
                      {preview.cloudWorkspaces.length} cloud workspace{preview.cloudWorkspaces.length > 1 ? 's' : ''}{' '}
                      {preview.cloudWorkspaces.length > 1 ? 'are' : 'is'} <strong style={{ color: c.tx }}>not</strong> in
                      the archive — they already live in the cloud and come back when you sign in on {destination}.
                    </Note>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 12.5, color: c.tm, marginBottom: 14 }}>Looking at your projects…</div>
              )}

              <div style={{ marginTop: 16 }}>
                <PrimaryButton onClick={onExport} disabled={busy} dataId="domainMigrationExportBtn">
                  <i className="fas fa-box-archive" />
                  {busy ? 'Exporting…' : 'Export my projects'}
                </PrimaryButton>
              </div>
              <div style={{ fontSize: 11.5, color: c.td, marginTop: 10, lineHeight: 1.5 }}>
                Your browser will ask where to save the file. Your Remix preferences — theme, layout, networks, recent
                workspaces — travel with it. Sign-in details stay behind, so you&apos;ll log in again on {destination}.
              </div>
            </Card>
          )}

          {stage === 'handoff' && (
            <Card accent={c.pu} data-id="domainMigrationHandoff">
              <CardTitle step={2} accent={c.pu}>Take the file to {destination}</CardTitle>

              {exportResult && (
                <Note color={c.gn} icon="fas fa-circle-check" dataId="domainMigrationExportDone">
                  Saved <code style={{ color: c.tx, fontFamily: mono }}>{exportResult.fileName}</code> —{' '}
                  {exportResult.manifest.totalFiles} files ({formatBytes(exportResult.manifest.totalBytes)}) and{' '}
                  {exportResult.manifest.settingsCount ?? 0} settings. Check your downloads folder if you can&apos;t see
                  it.
                </Note>
              )}

              <div style={{ fontSize: 12.5, color: c.tm, lineHeight: 1.6, margin: '14px 0' }}>
                The button below opens <strong style={{ color: c.cy, fontFamily: mono }}>{destination}</strong> in a new
                tab and jumps straight to the import step. You&apos;ll be asked for the file you just saved.
              </div>

              {handoffUrl ? (
                <>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <PrimaryButton href={handoffUrl} dataId="domainMigrationHandoffLink">
                      <i className="fas fa-arrow-up-right-from-square" />
                      Open {targetOrigin} and import
                    </PrimaryButton>
                    <GhostButton onClick={copyHandoff} dataId="domainMigrationCopyLink">
                      <i className={`fas ${copied ? 'fa-check' : 'fa-copy'}`} /> {copied ? 'Copied' : 'Copy link'}
                    </GhostButton>
                  </div>
                  <Note color={c.am} icon="fas fa-lightbulb">
                    Keep this tab open until the import has finished, in case you need to export again.
                  </Note>
                </>
              ) : (
                <Note color={c.am} icon="fas fa-triangle-exclamation">
                  The new address hasn&apos;t been configured yet. Keep the exported file safe and import it once the new
                  site is announced.
                </Note>
              )}

              <BackLink onClick={() => setStage('export')} dataId="domainMigrationBackToExport">
                Export again
              </BackLink>
            </Card>
          )}

          {stage === 'import' && (
            <Card accent={c.gn} data-id="domainMigrationImport">
              <CardTitle step={3} accent={c.gn}>Restore your projects here</CardTitle>

              {!archive && !importResult && (
                <div
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
                  style={{
                    borderRadius: 12,
                    border: `1.5px dashed ${dragging ? c.cy : 'rgba(255,255,255,0.14)'}`,
                    background: dragging ? 'rgba(47,191,177,0.08)' : 'rgba(255,255,255,0.02)',
                    padding: '32px 20px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  <div style={{
                    width: 48, height: 48, borderRadius: 12, margin: '0 auto 12px',
                    background: 'rgba(47,191,177,0.12)', border: '0.5px solid rgba(47,191,177,0.28)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    <i className="fas fa-file-arrow-down" style={{ color: c.cy, fontSize: 20 }} />
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: c.tx, marginBottom: 4 }}>
                    Drop your migration archive here
                  </div>
                  <div style={{ fontSize: 12, color: c.tm }}>
                    or click to browse for the <code style={{ fontFamily: mono }}>.zip</code> you exported
                  </div>
                </div>
              )}

              <input
                ref={fileInput}
                type="file"
                accept=".zip,application/zip"
                style={{ display: 'none' }}
                disabled={busy}
                data-id="domainMigrationFileInput"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) onPickArchive(file)
                }}
              />

              {archive && !importResult && (
                <div data-id="domainMigrationSummary">
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                    <Stat label="Files" value={String(archive.manifest.totalFiles)} accent={c.cy} />
                    <Stat label="Size" value={formatBytes(archive.manifest.totalBytes)} accent={c.pu} />
                    <Stat label="Workspaces" value={String(archive.manifest.workspaces.length)} accent={c.gn} />
                  </div>
                  <div style={{ fontSize: 11.5, color: c.tm, marginBottom: 12 }}>
                    From <strong style={{ color: c.tx, fontFamily: mono }}>{archive.manifest.sourceOrigin}</strong>,
                    exported {new Date(archive.manifest.createdAt).toLocaleString()} ·{' '}
                    {archive.manifest.settingsCount ?? Object.keys(archive.manifest.config || {}).length} settings
                  </div>

                  {canResume && (
                    <Note color={c.am} icon="fas fa-rotate-left" dataId="domainMigrationResume">
                      A previous import of this archive was interrupted. You can carry on where it stopped.
                    </Note>
                  )}

                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14, alignItems: 'center' }}>
                    {canResume && (
                      <PrimaryButton onClick={() => onImport(true)} disabled={busy} dataId="domainMigrationResumeBtn">
                        <i className="fas fa-rotate-left" /> Resume import
                      </PrimaryButton>
                    )}
                    {canResume ? (
                      <GhostButton
                        onClick={() => {
                          clearResumeState(archive.archiveId)
                          setCanResume(false)
                          onImport(false)
                        }}
                        disabled={busy}
                        dataId="domainMigrationImportBtn"
                      >
                        Start over
                      </GhostButton>
                    ) : (
                      <PrimaryButton onClick={() => onImport(false)} disabled={busy} dataId="domainMigrationImportBtn">
                        <i className="fas fa-download" /> {busy ? 'Importing…' : 'Import everything'}
                      </PrimaryButton>
                    )}
                    <GhostButton onClick={() => setArchive(null)} disabled={busy}>
                      Choose another file
                    </GhostButton>
                  </div>
                </div>
              )}

              {importResult && (
                <div data-id="domainMigrationImportDone">
                  <Note color={c.gn} icon="fas fa-circle-check">
                    Restored <strong style={{ color: c.tx }}>{importResult.imported}</strong> files
                    {importResult.skipped > 0 && <> ({importResult.skipped} already done)</>} and applied{' '}
                    {importResult.configApplied} settings
                    {importResult.configSkipped > 0 && (
                      <> ({importResult.configSkipped} kept as they already are here)</>
                    )}
                    .
                  </Note>
                  {Object.keys(importResult.renamedWorkspaces).length > 0 && (
                    <Note color={c.am} icon="fas fa-tag">
                      Renamed to avoid overwriting workspaces already here:{' '}
                      {Object.entries(importResult.renamedWorkspaces)
                        .map(([from, to]) => `${from} → ${to}`)
                        .join(', ')}
                    </Note>
                  )}
                  {importResult.issues.length > 0 && (
                    <Note color={c.rd} icon="fas fa-triangle-exclamation" dataId="domainMigrationIssues">
                      <strong style={{ color: c.tx }}>
                        {importResult.issues.length} files could not be restored.
                      </strong>
                      <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>
                        {importResult.issues.slice(0, 8).map((issue) => (
                          <li key={issue.path} style={{ fontFamily: mono, fontSize: 10.5 }}>
                            {issue.path} — {issue.reason}
                          </li>
                        ))}
                      </ul>
                      {importResult.issues.length > 8 && (
                        <div style={{ marginTop: 4 }}>…and {importResult.issues.length - 8} more.</div>
                      )}
                    </Note>
                  )}
                  {confirmUrl ? (
                    <>
                      <div style={{ fontSize: 12.5, color: c.tm, lineHeight: 1.6, margin: '14px 0 12px' }}>
                        <strong style={{ color: c.tx }}>One last step.</strong> Tell {sourceHost} you&apos;ve moved, and
                        it will bring you straight here from now on instead of loading the old Remix. Opens in a new
                        tab — nothing there is deleted.
                      </div>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                        <PrimaryButton href={confirmUrl} dataId="domainMigrationConfirmLink">
                          <i className="fas fa-circle-check" />
                          Finish up on {sourceHost}
                        </PrimaryButton>
                        <GhostButton onClick={() => window.location.reload()} dataId="domainMigrationReload">
                          <i className="fas fa-rotate-right" /> Reload to see my projects
                        </GhostButton>
                      </div>
                    </>
                  ) : (
                    <div style={{ marginTop: 14 }}>
                      <PrimaryButton onClick={() => window.location.reload()} dataId="domainMigrationReload">
                        <i className="fas fa-rotate-right" /> Reload Remix to see your projects
                      </PrimaryButton>
                    </div>
                  )}
                </div>
              )}

              {!importResult && (
                <BackLink onClick={() => setStage('export')} dataId="domainMigrationBackFromImport">
                  I need to export from the old site first
                </BackLink>
              )}
            </Card>
          )}
        </div>

        {progress && progress.phase !== 'done' && <Progress progress={progress} />}

        {error && (
          <Note color={c.rd} icon="fas fa-circle-exclamation" dataId="domainMigrationError">
            {error}
          </Note>
        )}

        {storage?.known && (
          <div
            data-id="domainMigrationStorage"
            style={{ fontSize: 11, color: c.td, marginTop: 24, fontFamily: mono, textAlign: 'center' }}
          >
            browser storage · {formatBytes(storage.usage)} used of {formatBytes(storage.quota)} ·{' '}
            {formatBytes(storage.available)} free
          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Hero ─── */

const Hero: React.FC<{ destination: string; targetOrigin?: string; days: number | null }> = ({
  destination,
  targetOrigin,
  days
}) => (
  <div style={{
    position: 'relative', overflow: 'hidden',
    borderRadius: 18, border: '0.5px solid rgba(47,191,177,0.18)',
    padding: '26px 24px', marginBottom: 18
  }}>
    <div style={{
      position: 'absolute', inset: 0,
      background: 'linear-gradient(135deg, rgba(47,191,177,0.10) 0%, rgba(155,125,255,0.06) 50%, rgba(240,160,48,0.07) 100%)'
    }} />
    <div style={{
      position: 'absolute', inset: 0, opacity: 0.04,
      backgroundImage: 'linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)',
      backgroundSize: '24px 24px'
    }} />

    <div style={{ position: 'relative', zIndex: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10,
          background: 'rgba(47,191,177,0.12)', border: '0.5px solid rgba(47,191,177,0.28)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'dmwDrift 3s ease-in-out infinite'
        }}>
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke={c.cy} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 8h9M8 5l3 3-3 3M13 2v12" />
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Remix is moving</div>
          <div style={{ fontSize: 11, color: c.cy, fontFamily: mono, letterSpacing: 0.5 }}>New home</div>
        </div>
      </div>

      <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.25, marginBottom: 10 }}>
        Move your data to{' '}
        <span style={{ color: c.cy, fontFamily: mono, fontSize: 21 }}>{destination}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontFamily: mono, fontSize: 11 }}>
        <span style={{
          color: c.tm, background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.06)',
          borderRadius: 6, padding: '4px 8px', textDecoration: 'line-through'
        }}>
          {window.location.host}
        </span>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke={c.td} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 8h10M9 4l4 4-4 4" />
        </svg>
        <span style={{
          color: c.cy, background: 'rgba(47,191,177,0.08)', border: '0.5px solid rgba(47,191,177,0.28)',
          borderRadius: 6, padding: '4px 8px', fontWeight: 600
        }}>
          {targetOrigin || 'coming soon'}
        </span>
        {days !== null && (
          <span style={{
            color: days <= 7 ? c.am : c.tm,
            background: days <= 7 ? 'rgba(240,160,48,0.08)' : 'rgba(255,255,255,0.03)',
            border: `0.5px solid ${days <= 7 ? 'rgba(240,160,48,0.28)' : 'rgba(255,255,255,0.06)'}`,
            borderRadius: 6, padding: '4px 8px',
            animation: days <= 7 ? 'dmwPulse 2s ease-in-out infinite' : undefined
          }}>
            {days === 0 ? 'updates ending' : `${days}d of updates left`}
          </span>
        )}
      </div>
    </div>
  </div>
)

const WhyPanel: React.FC<{ destination: string }> = ({ destination }) => (
  <div style={{
    borderRadius: 12, padding: '14px 16px', marginBottom: 22,
    background: 'rgba(255,255,255,0.02)', border: '0.5px solid rgba(255,255,255,0.06)',
    fontSize: 12.5, color: c.tm, lineHeight: 1.6
  }}>
    Your workspaces are saved by <strong style={{ color: c.tx }}>your browser</strong>, not by Remix&apos;s servers — and
    browsers keep that storage locked to one address. Nothing on{' '}
    <strong style={{ color: c.tx, fontFamily: mono }}>{window.location.host}</strong> can reach {destination} on its own,
    so you need to carry it across once. It takes a couple of minutes, and{' '}
    <strong style={{ color: c.gn }}>nothing is deleted here</strong> — what you export is a copy.
  </div>
)

/* ─── Stepper ─── */

const Stepper: React.FC<{ current: Stage }> = ({ current }) => {
  const currentIndex = STEPS.findIndex((s) => s.id === current)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 22 }} data-id="domainMigrationStepper">
      {STEPS.map((step, i) => {
        const done = i < currentIndex
        const active = i === currentIndex
        const accent = done ? c.gn : active ? c.cy : c.td
        return (
          <React.Fragment key={step.id}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 84 }}>
              <div style={{
                width: 30, height: 30, borderRadius: 9,
                background: active || done ? `${accent}1f` : 'rgba(255,255,255,0.03)',
                border: `0.5px solid ${active || done ? `${accent}59` : 'rgba(255,255,255,0.06)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: accent, fontSize: 12, fontWeight: 700, fontFamily: mono
              }}>
                {done ? <i className="fas fa-check" style={{ fontSize: 11 }} /> : i + 1}
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, fontWeight: active ? 600 : 500, color: active || done ? c.tx : c.td }}>
                  {step.label}
                </div>
                <div style={{ fontSize: 10, color: c.td }}>{step.hint}</div>
              </div>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{
                flex: 1, height: 1, marginTop: 15,
                background: i < currentIndex ? `${c.gn}59` : 'rgba(255,255,255,0.08)'
              }} />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

/* ─── Building blocks ─── */

const Card: React.FC<{ accent: string; children: React.ReactNode; 'data-id'?: string }> = ({
  accent,
  children,
  ...rest
}) => (
  <div
    {...rest}
    style={{
      borderRadius: 14, padding: 20,
      background: 'rgba(255,255,255,0.02)',
      border: `0.5px solid ${accent}33`
    }}
  >
    {children}
  </div>
)

const CardTitle: React.FC<{ step: number; accent: string; children: React.ReactNode }> = ({ step, accent, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
    <span style={{
      fontFamily: mono, fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase',
      color: accent, background: `${accent}1a`, border: `0.5px solid ${accent}40`,
      borderRadius: 5, padding: '3px 7px'
    }}>
      Step {step}
    </span>
    <span style={{ fontSize: 15, fontWeight: 600, color: c.tx }}>{children}</span>
  </div>
)

const Stat: React.FC<{ label: string; value: string; accent: string }> = ({ label, value, accent }) => (
  <div style={{
    flex: '1 1 120px', borderRadius: 10, padding: '10px 12px',
    background: `${accent}0f`, border: `0.5px solid ${accent}2e`
  }}>
    <div style={{ fontSize: 18, fontWeight: 600, color: c.tx, fontFamily: mono }}>{value}</div>
    <div style={{ fontSize: 10, color: c.tm, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
  </div>
)

const Tag: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{
    display: 'inline-block', fontFamily: mono, fontSize: 10.5, color: c.tm,
    background: 'rgba(255,255,255,0.03)', border: '0.5px solid rgba(255,255,255,0.06)',
    borderRadius: 5, padding: '2px 6px', margin: '2px 4px 2px 0'
  }}>
    {children}
  </span>
)

const Note: React.FC<{ color: string; icon: string; children: React.ReactNode; dataId?: string }> = ({
  color,
  icon,
  children,
  dataId
}) => (
  <div
    data-id={dataId}
    style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '10px 12px', borderRadius: 9, marginTop: 12,
      background: `${color}0f`, border: `0.5px solid ${color}2e`,
      fontSize: 11.5, color: c.tm, lineHeight: 1.5
    }}
  >
    <i className={icon} style={{ color, fontSize: 12, marginTop: 2, flexShrink: 0 }} />
    <div style={{ minWidth: 0 }}>{children}</div>
  </div>
)

const buttonBase: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600,
  fontFamily: sans, cursor: 'pointer', transition: 'all 0.2s', textDecoration: 'none'
}

const PrimaryButton: React.FC<{
  onClick?: () => void
  href?: string
  disabled?: boolean
  dataId?: string
  children: React.ReactNode
}> = ({ onClick, href, disabled, dataId, children }) => {
  const [h, setH] = useState(false)
  const style: React.CSSProperties = {
    ...buttonBase,
    background: h && !disabled
      ? 'linear-gradient(135deg, rgba(47,191,177,0.30) 0%, rgba(155,125,255,0.30) 100%)'
      : 'linear-gradient(135deg, rgba(47,191,177,0.18) 0%, rgba(155,125,255,0.18) 100%)',
    border: `0.5px solid ${h && !disabled ? 'rgba(47,191,177,0.55)' : 'rgba(47,191,177,0.35)'}`,
    color: c.tx,
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer'
  }
  const handlers = {
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false)
  }
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" data-id={dataId} style={style} {...handlers}>
        {children}
      </a>
    )
  }
  return (
    <button onClick={onClick} disabled={disabled} data-id={dataId} style={style} {...handlers}>
      {children}
    </button>
  )
}

const GhostButton: React.FC<{
  onClick: () => void
  disabled?: boolean
  dataId?: string
  children: React.ReactNode
}> = ({ onClick, disabled, dataId, children }) => {
  const [h, setH] = useState(false)
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      data-id={dataId}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        ...buttonBase,
        padding: '9px 14px', fontSize: 12, fontWeight: 500,
        background: h && !disabled ? c.s2 : 'transparent',
        border: `0.5px solid ${h && !disabled ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)'}`,
        color: h && !disabled ? c.tx : c.tm,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer'
      }}
    >
      {children}
    </button>
  )
}

const BackLink: React.FC<{ onClick: () => void; dataId?: string; children: React.ReactNode }> = ({
  onClick,
  dataId,
  children
}) => (
  <button
    onClick={onClick}
    data-id={dataId}
    style={{
      background: 'none', border: 'none', padding: 0, marginTop: 16,
      color: c.td, fontSize: 11.5, cursor: 'pointer', fontFamily: sans,
      display: 'inline-flex', alignItems: 'center', gap: 6
    }}
  >
    <i className="fas fa-arrow-left" style={{ fontSize: 10 }} /> {children}
  </button>
)

const Progress: React.FC<{ progress: MigrationProgress }> = ({ progress }) => {
  const percent = progress.fraction === null ? null : Math.round(progress.fraction * 100)
  return (
    <div style={{ marginTop: 18 }} data-id="domainMigrationProgress">
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: c.tm, marginBottom: 6 }}>
        <span>{phaseLabels[progress.phase] || progress.phase}</span>
        <span style={{ fontFamily: mono, color: c.td }}>
          {progress.filesTotal > 0 ? `${progress.filesDone}/${progress.filesTotal}` : `${progress.filesDone}`} files
          {percent !== null && ` · ${percent}%`}
        </span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 3,
          width: percent === null ? '100%' : `${percent}%`,
          background: `linear-gradient(90deg, ${c.cy}, ${c.pu})`,
          transition: 'width 0.2s ease',
          animation: percent === null ? 'dmwPulse 1.2s ease-in-out infinite' : undefined
        }} />
      </div>
      {progress.currentPath && (
        <div style={{
          fontSize: 10.5, color: c.td, marginTop: 6, fontFamily: mono,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
        }}>
          {progress.currentPath}
        </div>
      )}
    </div>
  )
}
