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

export default function SortiaResultCard({ data, onFollowUp }) {
  const [activeTab, setActiveTab] = useState('candidates')

  if (!data || typeof data !== 'object') {
    return <div className="plainChatBubble">Ready to classify your content.</div>
  }

  if (data.type !== 'classification' && !data.primary_category) {
    return (
      <div className="plainChatBubble">
        {toText(data.message || data.summary || 'Classification assistant ready.')}
      </div>
    )
  }

  const confidence = toPct(data.confidence, 82)
  const humanReview = Boolean(data.human_review_recommended || data.status === 'AMBIGUOUS_REVIEW' || confidence < 80)
  const primaryCategory = toText(data.primary_category, 'Unclassified Content')
  const subtype = toText(data.subtype, '')
  const domain = toText(data.domain, '')
  const title = toText(data.classification_title || primaryCategory)
  const summary = toText(data.summary)
  const metrics = (data.metrics && typeof data.metrics === 'object') ? data.metrics : {}
  const candidates = toList(data.candidates)
  const signals = toList(data.classification_signals)
  const routing = (data.routing_recommendation && typeof data.routing_recommendation === 'object') ? data.routing_recommendation : {}
  const followups = toList(data.suggested_followups)

  return (
    <div className="sortiaCard">
      <div className="sortiaHeader">
        <div className="sortiaHeaderLeft">
          <span className={`statusPill ${humanReview ? 'caution' : 'optimal'}`}>
            <span className="dot" />
            {humanReview ? `HUMAN REVIEW · ${confidence}%` : `CONFIDENT · ${confidence}%`}
          </span>
          <span className="primaryCatBadge">{primaryCategory}</span>
          {subtype && <span className="subtypeBadge">{subtype}</span>}
          {domain && <span className="domainBadge">{domain}</span>}
        </div>
      </div>

      {title && <div className="classificationTitle">{title}</div>}

      {humanReview && (
        <div className="ambiguityBanner">
          <strong>Ambiguous Evidence Detected · Human Review Recommended</strong>
          <p>Multiple predefined categories showed competing signals or confidence fell below 80%. Review candidate weights below before routing.</p>
        </div>
      )}

      {summary && (
        <div className="whatTypeBox">
          <span className="typeLabel">WHAT TYPE OF CONTENT IS THIS?</span>
          <p>{summary}</p>
        </div>
      )}

      <div className="metricsStrip">
        <div className="mItem">
          <span className="mDot" />
          <span className="mVal">{confidence}%</span>
          <span className="mKey">Confidence</span>
        </div>
        <span className="mSep" />
        <div className="mItem">
          <span className="mVal">{toText(metrics.candidates_evaluated || 10)}</span>
          <span className="mKey">Classes Checked</span>
        </div>
        <span className="mSep" />
        <div className="mItem">
          <span className="mVal">{toText(metrics.signals_detected || signals.length)}</span>
          <span className="mKey">Signals</span>
        </div>
        <span className="mSep" />
        <div className="mItem">
          <span className="mVal">{toText(metrics.review_flag || (humanReview ? 'Human Review' : 'Auto-Classify'))}</span>
          <span className="mKey">Decision</span>
        </div>
      </div>

      <div className="tabStrip">
        <button
          type="button"
          className={`tabPill${activeTab === 'candidates' ? ' active' : ''}`}
          onClick={() => setActiveTab('candidates')}
        >
          Candidates ({candidates.length || 1})
        </button>
        <button
          type="button"
          className={`tabPill${activeTab === 'signals' ? ' active' : ''}`}
          onClick={() => setActiveTab('signals')}
        >
          Evidence Signals ({signals.length})
        </button>
        <button
          type="button"
          className={`tabPill${activeTab === 'routing' ? ' active' : ''}`}
          onClick={() => setActiveTab('routing')}
        >
          Routing Path
        </button>
      </div>

      {activeTab === 'candidates' && (
        <div className="barsPanel">
          {(candidates.length > 0 ? candidates : [{ category: primaryCategory, subtype, confidence, reasoning: summary }]).map((item, i) => {
            const pct = toPct(item?.confidence, 0)
            const isTop = i === 0
            return (
              <div key={i} className={`candidateCard${isTop ? ' top' : ''}`}>
                <div className="barTop">
                  <div className="candTitleWrap">
                    <span className="candCat">{toText(item?.category, 'Candidate')}</span>
                    {item?.subtype && <span className="candSub">{toText(item.subtype)}</span>}
                  </div>
                  <span className="barPct">{pct}%</span>
                </div>
                <div className="barTrack">
                  <div className="barFill" style={{ width: `${Math.max(4, pct)}%` }} />
                </div>
                {item?.reasoning && <div className="barDetail">{toText(item.reasoning)}</div>}
              </div>
            )
          })}
        </div>
      )}

      {activeTab === 'signals' && (
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
                  </div>
                  {sig?.evidence && <div className="signalEvidence">"{toText(sig.evidence)}"</div>}
                </div>
              )
            })
          )}
        </div>
      )}

      {activeTab === 'routing' && (
        <div className="routingPanel">
          <div className="routingRow">
            <span className="routingKey">TARGET REPOSITORY PATH</span>
            <div className="routingVal">{toText(routing.repository_path, `Enterprise Content Hub / ${primaryCategory}`)}</div>
          </div>
          {routing.retention_tier && (
            <div className="routingRow">
              <span className="routingKey">GOVERNANCE &amp; RETENTION</span>
              <div className="routingVal">{toText(routing.retention_tier)}</div>
            </div>
          )}
          <div className="routingRow">
            <span className="routingKey">RECOMMENDED NEXT STEP</span>
            <div className="routingVal">{toText(routing.next_step, humanReview ? 'Assign to taxonomy steward for manual verification.' : `Auto-route to ${primaryCategory} workspace.`)}</div>
          </div>
        </div>
      )}

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

