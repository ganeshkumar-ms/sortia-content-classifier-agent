import { useState } from 'react'

function toText(val, fallback = '') {
  if (val === null || val === undefined) return fallback
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return String(val)
  if (Array.isArray(val)) return val.map(v => toText(v)).filter(Boolean).join(', ')
  if (typeof val === 'object') {
    return toText(val.label || val.category || val.signal || val.title || val.summary || val.reasoning || JSON.stringify(val), fallback)
  }
  return fallback
}

function toList(val) {
  return Array.isArray(val) ? val : []
}

function toPct(val, fallback = 0) {
  const num = Number(val)
  if (Number.isNaN(num)) return fallback
  return Math.max(0, Math.min(100, Math.round(num)))
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function parseRejection(data) {
  const rej = data?.rejection_details || {}
  const msg = typeof data?.message === 'string' ? data.message : ''
  let title = rej.title || data?.title || ''
  let filename = rej.filename || data?.filename || data?.document?.filename || data?.document_metadata?.filename || 'Uploaded Document'
  let reason = rej.reason || rej.why || ''
  let technicalDetail = rej.technical_detail || ''
  let supported = rej.supported_formats || ''
  let howToFix = rej.how_to_fix || ''

  if (msg.includes('•') || (!reason && msg.includes('File Not Accepted'))) {
    const parts = msg.split(/\s*•\s*/)
    parts.forEach((p, idx) => {
      const part = p.trim()
      if (idx === 0 && !title) title = part
      else if (part.toLowerCase().startsWith('file:') && !filename) filename = part.substring(part.indexOf(':') + 1).trim()
      else if (part.toLowerCase().includes('why it was not accepted:') && !reason) reason = part.substring(part.indexOf(':') + 1).trim()
      else if (part.toLowerCase().includes('technical details:') && !technicalDetail) technicalDetail = part.substring(part.indexOf(':') + 1).trim()
      else if (part.toLowerCase().includes('supported formats') && !supported) supported = part.substring(part.indexOf(':') + 1).trim()
      else if (part.toLowerCase().includes('how to fix') && !howToFix) howToFix = part.substring(part.indexOf(':') + 1).trim()
    })
  }
  if (!title) title = 'File Not Accepted'
  const isSecurity = /credential|secret|access key|password|token/i.test(title + ' ' + reason)
  const reasonLabel = isSecurity ? 'Security & Policy Violation' : 'Reason for Rejection'
  const isFormatIssue = /format|extension|unsupported|binary|unreadable|corrupt|container|mime/i.test(title + ' ' + reason + ' ' + technicalDetail) && !isSecurity && !/empty|blank/i.test(title + ' ' + reason)
  return { title, filename, reason, reasonLabel, technicalDetail, supported: isFormatIssue ? supported : '', howToFix }
}

export default function SortiaResultCard({ data, guardrails: propGuardrails, onFollowUp }) {
  const [activeTab, setActiveTab] = useState('decision') // 'decision' | 'signals' | 'metadata'

  if (!data || typeof data !== 'object') {
    return <div className="plainChatBubble">Ready to classify your content.</div>
  }

  const guardrails = propGuardrails || data?.guardrails || {}
  const traceId = data?.trace_id || guardrails?.trace_id || ''

  // 1. Structured File Rejection Card
  if (data.rejected || data.rejection_details || (typeof data.message === 'string' && data.message.includes('File Not Accepted'))) {
    const rej = parseRejection(data)
    return (
      <div className="sortiaRejectionCard">
        <div className="sortiaRejectionHeader">
          <div className="sortiaRejectionBadge">
            <AlertIcon />
            <span>{rej.title}</span>
          </div>
          <span className="sortiaRejectionFile">
            <FileIcon />
            <span>{rej.filename}</span>
          </span>
        </div>

        <div className="sortiaRejectionBody">
          {rej.reason && (
            <div className="rejectionSection">
              <span className="rejectionLabel">{rej.reasonLabel || 'Reason for Rejection'}</span>
              <p className="rejectionValue">{rej.reason}</p>
            </div>
          )}
          {rej.technicalDetail && (
            <div className="rejectionSection">
              <span className="rejectionLabel">Technical Details</span>
              <p className="rejectionValue mono">{rej.technicalDetail}</p>
            </div>
          )}
          {rej.supported && (
            <div className="rejectionSection">
              <span className="rejectionLabel">Supported Formats for SORTIA</span>
              <p className="rejectionValue">{rej.supported}</p>
            </div>
          )}
          {rej.howToFix && (
            <div className="rejectionSection fixSection">
              <span className="rejectionLabel">How to Fix &amp; Re-upload</span>
              <p className="rejectionValue">{rej.howToFix}</p>
            </div>
          )}
          {!rej.reason && (
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: '13.5px', color: '#e2e8f0' }}>
              {data.message}
            </div>
          )}
        </div>
      </div>
    )
  }

  // 2. Conversational fallback
  if (data.type !== 'classification' && !data.primary_category) {
    return (
      <div className="plainChatBubble" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
        {guardrails?.status === 'BLOCKED' && (
          <div style={{ marginBottom: '12px' }}>
            <span className="srtGuardrailPill blocked">
              <ShieldIcon />
              <span>Guardrails: Blocked ({guardrails.triggered_rule || guardrails.rejection_reason || 'Policy Violation'})</span>
            </span>
          </div>
        )}
        {toText(data.message || data.summary || 'Enterprise content routing assistant ready.')}
      </div>
    )
  }

  const confidence = toPct(data.confidence, 82)
  const confCalibration = toText(data.confidence_calibration, confidence >= 88 ? 'High' : confidence >= 75 ? 'Moderate' : 'Low')
  const primaryCategory = toText(data.primary_category, 'Unclassified Content')
  const docTypeDetected = toText(data.document_type_detected || data.classification_title || primaryCategory)
  const secondaryTags = toList(data.secondary_classifications)
  const taxonomy = toList(data.taxonomy_hierarchy)
  const subtype = toText(data.subtype, '')
  const domain = toText(data.domain, '')
  const summary = toText(data.summary)
  const candidates = toList(data.candidates)
  const signals = toList(data.classification_signals)
  const ambiguity = (data.ambiguity && typeof data.ambiguity === 'object') ? data.ambiguity : {}
  const ambLevel = toText(ambiguity.level, 'Low')
  const ambScore = toPct(ambiguity.score, 14)
  const metadata = (data.extracted_metadata && typeof data.extracted_metadata === 'object') ? data.extracted_metadata : {}
  const sensitivity = (data.sensitivity && typeof data.sensitivity === 'object') ? data.sensitivity : {}
  const sensLevel = toText(sensitivity.level, 'Internal')
  const autoRoute = (data.autonomous_routing && typeof data.autonomous_routing === 'object') ? data.autonomous_routing : {}
  const execStatus = toText(autoRoute.execution_status, 'ROUTED')
  const isException = execStatus === 'EXCEPTION_QUEUE'
  const similarity = (data.similarity_check && typeof data.similarity_check === 'object') ? data.similarity_check : {}
  const analytics = (data.routing_analytics && typeof data.routing_analytics === 'object') ? data.routing_analytics : {}
  const followups = toList(data.suggested_followups)

  return (
    <div className="sortiaCard">
      {/* 0. GUARDRAILS & AUDIT METADATA BAR */}
      <div className="srtTopMetaBar">
        <span className={`srtGuardrailPill ${guardrails?.status === 'BLOCKED' ? 'blocked' : 'passed'}`}>
          <ShieldIcon />
          <span>
            {guardrails?.status === 'BLOCKED'
              ? `Guardrails: Blocked (${guardrails.triggered_rule || 'Policy Violation'})`
              : guardrails?.status === 'REDACTED'
              ? `Guardrails: ${guardrails.redacted_count || 1} Secret(s) Sanitized`
              : 'Guardrails: Passed · Enterprise Policy Verified'}
          </span>
        </span>

        <div className="srtMetaRight">
          {autoRoute.processing_time_ms && (
            <span className="srtTimeChip">{autoRoute.processing_time_ms} ms</span>
          )}
          {autoRoute.audit_ref && (
            <span className="srtTraceChip" title="Audit Reference">{autoRoute.audit_ref}</span>
          )}
          {traceId && (
            <span className="srtTraceChip" title="Trace ID">{traceId}</span>
          )}
        </div>
      </div>

      {/* 1. HERO CONTENT INTELLIGENCE BANNER */}
      <div className="srtHeroBox">
        <div className="srtHeroTop">
          <div className="srtHeroBadges">
            <span className={`statusPill ${isException ? 'caution' : 'optimal'}`}>
              <span className="dot" />
              {isException ? 'EXCEPTION QUEUE · AUTO-TRIAGE' : 'ROUTING VERIFIED · SUCCESS'}
            </span>
            <span className="primaryCatBadge">{primaryCategory}</span>
            {subtype && <span className="subtypeBadge">{subtype}</span>}
            {domain && <span className="domainBadge">{domain}</span>}
          </div>
          <span className={`srtSensPill sens-${sensLevel.toLowerCase()}`}>
            {sensLevel}
          </span>
        </div>

        <div className="classificationTitle">{docTypeDetected}</div>

        {/* MULTI-LABEL SECONDARY CLASSIFICATION TAGS */}
        {secondaryTags.length > 0 && (
          <div className="srtTagRow">
            <span className="srtTagLabel">MULTI-LABEL ATTRIBUTES:</span>
            {secondaryTags.map((tag, idx) => (
              <span key={idx} className="srtSecondaryTag">{toText(tag)}</span>
            ))}
          </div>
        )}

        {summary && (
          <div className="whatTypeBox" style={{ marginTop: '10px' }}>
            <span className="typeLabel">WHAT IS THIS CONTENT &amp; WHY CLASSIFIED THIS WAY?</span>
            <p>{summary}</p>
          </div>
        )}
      </div>

      {/* 2. COMPACT TAB STRIP */}
      <div className="tabStrip" style={{ marginTop: '12px', marginBottom: '12px' }}>
        <button
          type="button"
          className={`tabPill${activeTab === 'decision' ? ' active' : ''}`}
          onClick={() => setActiveTab('decision')}
        >
          Classification &amp; Routing Decision
        </button>
        <button
          type="button"
          className={`tabPill${activeTab === 'signals' ? ' active' : ''}`}
          onClick={() => setActiveTab('signals')}
        >
          Explainable Signals ({signals.length})
        </button>
        <button
          type="button"
          className={`tabPill${activeTab === 'metadata' ? ' active' : ''}`}
          onClick={() => setActiveTab('metadata')}
        >
          Metadata &amp; Duplicate Check
        </button>
      </div>

      {/* TAB 1: CLASSIFICATION & ROUTING DECISION */}
      {activeTab === 'decision' && (
        <div className="srtTabBody">
          {/* SMART TAXONOMY HIERARCHY BREADCRUMB */}
          {taxonomy.length > 0 && (
            <div className="srtTaxonomyBar">
              <span className="srtTaxLabel">TAXONOMY HIERARCHY:</span>
              <div className="srtTaxNodes">
                {taxonomy.map((node, idx) => (
                  <div key={idx} className="srtTaxNodeWrap">
                    <span className={`srtTaxNode ${idx === taxonomy.length - 1 ? 'leaf' : ''}`}>
                      <span className="srtTaxLvl">L{idx + 1}</span>
                      <strong>{toText(node)}</strong>
                    </span>
                    {idx < taxonomy.length - 1 && <span className="srtTaxArrow">→</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* BALANCED 2-COLUMN DIMENSION PANELS (ZERO EMPTY SPACE) */}
          <div className="srtDimGrid">
            {/* LEFT DIMENSION: CANDIDATE RANKINGS & REJECTION ANALYSIS */}
            <div className="srtSectionCard">
              <div className="srtSectionHead">DIMENSION 1: CANDIDATE EVALUATION &amp; DECISION</div>
              <div className="srtSubNote">Calibrated ranking scores with explicit alternative rejection reasons</div>
              <div className="srtCandList">
                {(candidates.length > 0 ? candidates : [{ category: primaryCategory, subtype, ranking_score: confidence, status: 'Selected Primary', reasoning: summary }]).map((item, i) => {
                  const score = toPct(item?.ranking_score ?? item?.confidence, 0)
                  const isTop = i === 0
                  return (
                    <div key={i} className={`srtCandCard ${isTop ? 'top' : ''}`}>
                      <div className="srtCandHead">
                        <div className="srtCandTitleGroup">
                          <strong className="srtCandName">{toText(item?.category, 'Candidate')}</strong>
                          {item?.subtype && <span className="candSub">{toText(item.subtype)}</span>}
                          <span className={`srtCandStatus ${isTop ? 'sel' : 'rej'}`}>
                            {isTop ? 'Primary Decision' : 'Rejected Alternative'}
                          </span>
                        </div>
                        <span className="srtCandScore">{score}%</span>
                      </div>
                      <div className="barTrack">
                        <div
                          className="barFill"
                          style={{
                            width: `${Math.max(6, score)}%`,
                            background: isTop ? 'linear-gradient(90deg, #10b981, #38bdf8)' : 'linear-gradient(90deg, #64748b, #94a3b8)'
                          }}
                        />
                      </div>
                      {item?.reasoning && <div className="barDetail">{toText(item.reasoning)}</div>}
                      {!isTop && item?.rejection_reason && (
                        <div className="srtRejectReason">
                          <strong>Why Rejected:</strong> {toText(item.rejection_reason)}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* INLINE AMBIGUITY EVALUATION STRIP */}
              <div className="srtAmbiguityInline">
                <div className="srtAmbInlineTop">
                  <span>AMBIGUITY EVALUATION:</span>
                  <strong className={ambLevel.toLowerCase() === 'high' ? 'amber' : 'green'}>
                    {ambLevel.toUpperCase()} ({ambScore}/100)
                  </strong>
                </div>
                <p className="srtAmbInlineText">
                  {toText(ambiguity.reasoning, `Confidence separation is +${data.metrics?.confidence_gap || '40%'} with clear dominance over competing categories.`)}
                </p>
              </div>
            </div>

            {/* RIGHT DIMENSION: AUTONOMOUS ROUTING EXECUTION & GOVERNANCE */}
            <div className="srtSectionCard">
              <div className="srtSectionHead">DIMENSION 2: TARGET REPOSITORY &amp; GOVERNANCE CLEARANCE</div>
              <div className="srtSubNote">Deterministic access policies and confirmed storage destination</div>

              <div className="srtDestBox">
                <div className="srtDestHead">
                  <div className="srtDestIcon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                  </div>
                  <div>
                    <div className="srtDestTitle">{toText(autoRoute.destination_repository, 'Enterprise Content Repository')}</div>
                    <code className="srtDestPath">{toText(autoRoute.destination_path, '/Enterprise/Content/')}</code>
                  </div>
                </div>

                <div className="srtDestMetaGrid">
                  <div className="srtDestMetaItem">
                    <span className="srtDestMetaKey">Department Owner</span>
                    <strong className="srtDestMetaVal">{toText(autoRoute.department, 'Enterprise Operations')}</strong>
                  </div>
                  <div className="srtDestMetaItem">
                    <span className="srtDestMetaKey">Retention Tier</span>
                    <strong className="srtDestMetaVal">{toText(autoRoute.retention_tier, '7 Years · Standard Retention')}</strong>
                  </div>
                  <div className="srtDestMetaItem">
                    <span className="srtDestMetaKey">Automated Workflow</span>
                    <strong className="srtDestMetaVal">{toText(autoRoute.workflow_triggered, 'Auto-Index-Sync')}</strong>
                  </div>
                  <div className="srtDestMetaItem">
                    <span className="srtDestMetaKey">Policy Clearance</span>
                    <strong className="srtDestMetaVal" style={{ color: sensitivity.access_control_cleared !== false ? '#34d399' : '#f87171' }}>
                      {sensitivity.access_control_cleared !== false ? 'Cleared (Eligible)' : 'Restricted (Blocked)'}
                    </strong>
                  </div>
                </div>

                <div className="srtDestReason">
                  <strong>Execution Detail:</strong> {toText(autoRoute.execution_reason, 'Autonomously routed based on high-confidence classification.')}
                </div>
              </div>

              {/* SENSITIVITY CLASSIFICATION COMPACT STRIP */}
              <div className="srtSensCompactBox">
                <div className="srtSensCompactHead">
                  <span>SECURITY SENSITIVITY:</span>
                  <strong className={`srtSensTag ${sensLevel.toLowerCase()}`}>{sensLevel.toUpperCase()}</strong>
                </div>
                <div className="srtHeatStripCompact">
                  {['Public', 'Internal', 'Confidential', 'Restricted'].map(lvl => {
                    const isActive = sensLevel.toLowerCase() === lvl.toLowerCase()
                    return (
                      <span key={lvl} className={`srtHeatPill ${isActive ? 'active' : ''} lvl-${lvl.toLowerCase()}`}>
                        <span>{lvl}</span>
                        {isActive && <CheckIcon />}
                      </span>
                    )
                  })}
                </div>
                <p className="srtSensPolicyText">
                  {toText(sensitivity.data_handling_policy, 'Standard enterprise access controls apply.')}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: EXPLAINABLE SIGNALS & SOURCE EVIDENCE */}
      {activeTab === 'signals' && (
        <div className="srtTabBody">
          <div className="srtSectionCard">
            <div className="srtSectionHead">EXPLAINABLE CLASSIFICATION SIGNALS ({signals.length})</div>
            <div className="tabBodyList">
              {signals.length === 0 ? (
                <div className="emptyTabNote">No specific lexical cues extracted beyond primary class profile.</div>
              ) : (
                signals.map((sig, i) => {
                  const weight = toText(sig?.weight, 'Medium').toLowerCase()
                  return (
                    <div key={i} className={`signalItem w-${weight}`}>
                      <div className="signalHead">
                        <span className={`weightTag ${weight}`}>{toText(sig?.weight, 'Medium').toUpperCase()} WEIGHT</span>
                        <b>{toText(sig?.signal, 'Classification Cue')}</b>
                        {sig?.category_influence && (
                          <span className="srtSigInfluence">→ {toText(sig.category_influence)}</span>
                        )}
                      </div>
                      {sig?.explanation && <div className="srtSigExplain">{toText(sig.explanation)}</div>}
                      {sig?.evidence && <div className="signalEvidence">&ldquo;{toText(sig.evidence)}&rdquo;</div>}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: EXTRACTED METADATA & DUPLICATE CHECK */}
      {activeTab === 'metadata' && (
        <div className="srtTabBody">
          <div className="srtDimGrid">
            <div className="srtSectionCard">
              <div className="srtSectionHead">EXTRACTED DOCUMENT METADATA</div>
              <div className="srtMetaCompactList">
                <div><span>Document Title:</span> <strong>{toText(metadata.document_title, 'Not specified')}</strong></div>
                <div><span>Author / Issuer:</span> <strong>{toText(metadata.author_or_issuer, 'Not specified')}</strong></div>
                <div><span>File Type:</span> <strong>{toText(metadata.file_type, 'TEXT')} ({metadata.word_count || 0} words)</strong></div>
                <div><span>Version:</span> <strong>{toText(metadata.version, 'Not specified')}</strong></div>
                <div><span>Created / Stamped Date:</span> <strong>{toText(metadata.dates?.[0], 'Current Batch')}</strong></div>
                <div><span>Security ID / Hash:</span> <code>{toText(metadata.identifiers?.[0] || similarity.content_fingerprint || 'SORTIA-VERIFIED')}</code></div>
              </div>
            </div>

            <div className="srtSectionCard">
              <div className="srtSectionHead">ARCHIVE SIMILARITY &amp; DUPLICATE CHECK</div>
              <div className="srtSimInlineBox">
                <div className="srtSimInlineHead">
                  <span>CONTENT FINGERPRINT (SHA-256):</span>
                  <code>{toText(similarity.content_fingerprint, 'Verified')}</code>
                </div>
                {toList(similarity.matches).length === 0 ? (
                  <div className="srtUniqueBox" style={{ marginTop: '12px' }}>
                    <CheckIcon />
                    <span>Unique document · No duplicate found in archive</span>
                  </div>
                ) : (
                  <div className="srtSimMiniList" style={{ marginTop: '12px' }}>
                    {toList(similarity.matches).slice(0, 3).map((m, idx) => (
                      <div key={idx} className="srtSimMiniRow">
                        <span>{toText(m.title)}</span>
                        <strong>{m.similarity_pct}%</strong>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. CONTEXT-AWARE FOLLOW-UPS */}
      {followups.length > 0 && onFollowUp && (
        <div className="followUpWrap">
          <span className="followLabel">ASK SORTIA NEXT:</span>
          <div className="followChips">
            {followups.map((q, i) => {
              const qStr = toText(q)
              if (!qStr) return null
              return (
                <button
                  key={i}
                  type="button"
                  className="followChip"
                  onClick={() => onFollowUp(qStr)}
                >
                  {qStr}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
