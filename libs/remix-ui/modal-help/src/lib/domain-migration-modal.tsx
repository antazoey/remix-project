import React, { useMemo, useState } from 'react'

// ─── Types ───────────────────────────────────────────────────────

export type MigrationDismissKind = 'remind' | 'never'

interface DomainMigrationModalProps {
  open: boolean
  /** Host users are moving to, e.g. 'app.remix.live'. */
  toDomain: string
  /** Host being retired. Defaults to the current origin. */
  fromDomain?: string
  /** ISO date the old origin stops being updated. Drives the countdown chip. */
  deadline?: string | null
  /** Opens the export/import panel. */
  onStartMigration: () => void
  onDismiss: (kind: MigrationDismissKind) => void
  onClose: () => void
}

// ─── Keyframes (locally scoped, prefixed dm-) ────────────────────

const KEYFRAMES = `
  @keyframes dmModalIn {
    from { opacity: 0; transform: scale(0.92) translateY(20px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }
  @keyframes dmOverlayIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes dmDrift {
    0%, 100% { transform: translateX(0); }
    50%      { transform: translateX(4px); }
  }
`

// ─── Palette (mirrors beta-farewell-modal for visual cohesion) ───

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
  gn: '#6bdb8a'
}

// ─── Helpers ─────────────────────────────────────────────────────

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((t - Date.now()) / (1000 * 60 * 60 * 24)))
}

// ─── Sub-components ──────────────────────────────────────────────

const CloseButton: React.FC<{ onClick: () => void }> = ({ onClick }) => {
  const [h, setH] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        width: 28, height: 28, borderRadius: 6,
        background: h ? c.s2 : 'rgba(255,255,255,0.04)',
        border: '0.5px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', color: h ? c.tx : c.tm,
        fontSize: 16, transition: 'all 0.2s'
      }}
      aria-label="Close"
    >
      &times;
    </div>
  )
}

const PrimaryButton: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => {
  const [h, setH] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        flex: 1,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        padding: '11px 18px', borderRadius: 10,
        background: h
          ? 'linear-gradient(135deg, rgba(47,191,177,0.28) 0%, rgba(155,125,255,0.28) 100%)'
          : 'linear-gradient(135deg, rgba(47,191,177,0.18) 0%, rgba(155,125,255,0.18) 100%)',
        border: `0.5px solid ${h ? 'rgba(47,191,177,0.55)' : 'rgba(47,191,177,0.35)'}`,
        color: c.tx, fontSize: 13, fontWeight: 600,
        cursor: 'pointer', transition: 'all 0.2s',
        fontFamily: "'DM Sans', sans-serif"
      }}
    >
      {children}
    </button>
  )
}

const GhostButton: React.FC<{ onClick: () => void; children: React.ReactNode }> = ({ onClick, children }) => {
  const [h, setH] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        flex: 1,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        padding: '10px 14px', borderRadius: 10,
        background: h ? c.s2 : 'transparent',
        border: `0.5px solid ${h ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)'}`,
        color: h ? c.tx : c.tm, fontSize: 12, fontWeight: 500,
        cursor: 'pointer', transition: 'all 0.2s',
        fontFamily: "'DM Sans', sans-serif"
      }}
    >
      {children}
    </button>
  )
}

/** The destination as a link, for users who have already moved or have nothing to bring. */
const DomainLink: React.FC<{ toDomain: string; children?: React.ReactNode; style?: React.CSSProperties }> = ({
  toDomain,
  children,
  style
}) => {
  const [h, setH] = useState(false)
  return (
    <a
      href={`https://${toDomain}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      data-id="domainMigrationModalToDomainLink"
      title={`Open ${toDomain}`}
      style={{
        color: c.cy,
        textDecoration: h ? 'underline' : 'none',
        cursor: 'pointer',
        ...style
      }}
    >
      {children ?? toDomain}
    </a>
  )
}

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase',
    color: c.td, marginBottom: 10,
    display: 'flex', alignItems: 'center', gap: 6
  }}>
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke={c.td} strokeWidth="1.5">
      <path d="M6 1v10M1 6h10" />
    </svg>
    {children}
  </div>
)

const Step: React.FC<{ n: number; title: string; body: string; color: string; titleExtra?: React.ReactNode }> = ({
  n,
  title,
  body,
  color,
  titleExtra
}) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
    <div style={{
      width: 24, height: 24, borderRadius: 7, flexShrink: 0,
      background: `${color}1f`, border: `0.5px solid ${color}4d`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color, fontSize: 11, fontWeight: 700,
      fontFamily: "'JetBrains Mono', monospace"
    }}>
      {n}
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: c.tx, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {title}
        {titleExtra}
      </div>
      <div style={{ fontSize: 11.5, color: c.tm, lineHeight: 1.45 }}>{body}</div>
    </div>
  </div>
)

// ─── Main component ──────────────────────────────────────────────

/**
 * Announces that the current origin is being retired and walks the user
 * through moving their projects.
 *
 * Deliberately reassuring rather than alarmist: files are never deleted by
 * this flow, and the copy says so, because the failure mode we care about is
 * a user who panics and does something destructive.
 */
const DomainMigrationModal: React.FC<DomainMigrationModalProps> = ({
  open,
  toDomain,
  fromDomain,
  deadline,
  onStartMigration,
  onDismiss,
  onClose
}) => {
  const days = useMemo(() => daysUntil(deadline), [deadline])
  const from = fromDomain || window.location.host

  if (!open) return null

  return (
    <>
      <style>{KEYFRAMES}</style>

      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.55)',
          zIndex: 9998,
          animation: 'dmOverlayIn 0.3s ease'
        }}
      />

      {/* Modal */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, pointerEvents: 'none'
      }}>
        <div
          onClick={(e) => e.stopPropagation()}
          data-id="domainMigrationModal"
          style={{
            fontFamily: "'DM Sans', sans-serif",
            color: c.tx, background: c.bg,
            borderRadius: 20,
            border: '0.5px solid rgba(47,191,177,0.18)',
            width: '100%', maxWidth: 540, maxHeight: '90vh', overflowY: 'auto',
            animation: 'dmModalIn 0.5s cubic-bezier(0.34,1.56,0.64,1)',
            pointerEvents: 'auto'
          }}
        >
          {/* ── Hero ── */}
          <div style={{ position: 'relative', padding: '28px 24px 20px', overflow: 'hidden' }}>
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(135deg, rgba(47,191,177,0.08) 0%, rgba(155,125,255,0.05) 50%, rgba(240,160,48,0.06) 100%)'
            }} />
            <div style={{
              position: 'absolute', inset: 0, opacity: 0.04,
              backgroundImage: 'linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)',
              backgroundSize: '24px 24px'
            }} />

            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              position: 'relative', zIndex: 2, marginBottom: 18
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 10,
                  background: 'rgba(47,191,177,0.12)',
                  border: '0.5px solid rgba(47,191,177,0.28)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  animation: 'dmDrift 3s ease-in-out infinite'
                }}>
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke={c.cy} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 8h9M8 5l3 3-3 3M13 2v12" />
                  </svg>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontSize: 16, fontWeight: 600, color: c.tx }}>Remix is moving</div>
                  <div style={{
                    fontSize: 11, color: c.cy,
                    fontFamily: "'JetBrains Mono', monospace", letterSpacing: 0.5
                  }}>
                    New home
                  </div>
                </div>
              </div>
              <CloseButton onClick={onClose} />
            </div>

            <div style={{
              position: 'relative', zIndex: 2,
              fontSize: 18, fontWeight: 600, color: c.tx,
              marginBottom: 10, lineHeight: 1.3
            }}>
              Bring your projects to {toDomain}
            </div>

            {/* Domain hop */}
            <div style={{
              position: 'relative', zIndex: 2,
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              fontFamily: "'JetBrains Mono', monospace", fontSize: 11
            }}>
              <span style={{
                color: c.tm, background: 'rgba(255,255,255,0.03)',
                border: '0.5px solid rgba(255,255,255,0.06)',
                borderRadius: 6, padding: '4px 8px', textDecoration: 'line-through'
              }}>
                {from}
              </span>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke={c.td} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8h10M9 4l4 4-4 4" />
              </svg>
              <DomainLink
                toDomain={toDomain}
                style={{
                  background: 'rgba(47,191,177,0.08)',
                  border: '0.5px solid rgba(47,191,177,0.28)',
                  borderRadius: 6, padding: '4px 8px', fontWeight: 600,
                  display: 'inline-flex', alignItems: 'center', gap: 6
                }}
              >
                {toDomain}
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 3H3v10h10v-3M9.5 2.5H13.5V6.5M13.5 2.5L7 9" />
                </svg>
              </DomainLink>
              {days !== null && (
                <span style={{
                  color: days <= 7 ? c.am : c.tm,
                  background: days <= 7 ? 'rgba(240,160,48,0.08)' : 'rgba(255,255,255,0.03)',
                  border: `0.5px solid ${days <= 7 ? 'rgba(240,160,48,0.28)' : 'rgba(255,255,255,0.06)'}`,
                  borderRadius: 6, padding: '4px 8px'
                }}>
                  {days === 0 ? 'updates ending' : `${days}d of updates left`}
                </span>
              )}
            </div>
          </div>

          {/* ── Why ── */}
          <div style={{ padding: '4px 24px 16px' }}>
            <div style={{ fontSize: 13, color: c.tm, lineHeight: 1.55 }}>
              Your workspaces are stored by your browser and tied to{' '}
              <strong style={{ color: c.tx, fontWeight: 600 }}>{from}</strong>. Browsers keep that storage separate per
              domain, so your projects will not appear on the new address by themselves — you need to move them once.
            </div>
          </div>

          {/* ── Steps ── */}
          <div style={{ padding: '0 24px 16px' }}>
            <SectionLabel>Three steps, a few minutes</SectionLabel>
            <div style={{
              borderRadius: 12, padding: 16,
              background: 'linear-gradient(135deg, rgba(155,125,255,0.07) 0%, rgba(47,191,177,0.05) 100%)',
              border: '0.5px solid rgba(155,125,255,0.20)'
            }}>
              <Step n={1} color={c.cy} title="Export an archive here"
                body="Every workspace and your settings are packed into one file, with a checksum for each file." />
              <Step n={2} color={c.pu} title={`Open ${toDomain}`}
                body="Same Remix, new address. Sign in as usual if you have an account."
                titleExtra={<DomainLink toDomain={toDomain} style={{ fontSize: 11, fontWeight: 500 }}>open now</DomainLink>} />
              <Step n={3} color={c.gn} title="Import the archive there"
                body="Checksums are verified as files are restored, so nothing arrives silently damaged." />
            </div>
          </div>

          {/* ── Reassurance ── */}
          <div style={{ padding: '0 24px 18px' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px', borderRadius: 8,
              background: 'rgba(107,219,138,0.06)',
              border: '0.5px solid rgba(107,219,138,0.18)'
            }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke={c.gn} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 1.5l5.5 2.2v4c0 3.2-2.3 5.6-5.5 6.8-3.2-1.2-5.5-3.6-5.5-6.8v-4L8 1.5z" />
                <path d="M5.6 8l1.7 1.7L10.6 6.4" />
              </svg>
              <div style={{ fontSize: 11.5, color: c.tm, lineHeight: 1.4 }}>
                Nothing is deleted here. The archive is a <strong style={{ color: c.tx, fontWeight: 600 }}>copy</strong>,
                and your projects stay on this domain until you remove them yourself.
              </div>
            </div>
          </div>

          {/* ── Actions ── */}
          <div style={{ padding: '0 24px 14px' }}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
              <PrimaryButton onClick={onStartMigration}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 2v8M5 7l3 3 3-3M2.5 12.5h11" />
                </svg>
                Move my projects
              </PrimaryButton>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <GhostButton onClick={() => onDismiss('remind')}>
                <i className="far fa-clock" /> Remind me later
              </GhostButton>
              <GhostButton onClick={() => onDismiss('never')}>
                <i className="far fa-eye-slash" /> Don&apos;t show again
              </GhostButton>
            </div>
            <div style={{ fontSize: 11.5, color: c.td, textAlign: 'center', marginTop: 10 }}>
              Already moved, or nothing to bring? <DomainLink toDomain={toDomain}>Go to {toDomain}</DomainLink>
            </div>
          </div>

          {/* ── Footer ── */}
          <div style={{
            padding: '14px 24px',
            borderTop: '0.5px solid rgba(255,255,255,0.04)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <div style={{ fontSize: 12, color: c.td, textAlign: 'center' }}>
              You can start this any time from the workspace menu → <strong style={{ color: c.tm }}>Move your projects</strong>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default DomainMigrationModal
export type { DomainMigrationModalProps }
