import { useState, useEffect, useRef } from 'react'
import { createBatch, createBatchFromPath, getBatch, retryBatch, getBatchExportUrl } from '../services/api.js'
import SortiaResultCard from './SortiaResultCard.jsx'

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

export default function BulkClassificationWorkspace({ onSelectDocForViewer, onClose }) {
  const [filesToUpload, setFilesToUpload] = useState([])
  const [batchName, setBatchName] = useState('')
  const [inputLocationPath, setInputLocationPath] = useState('')
  const [isScanningPath, setIsScanningPath] = useState(false)
  const [ingestMode, setIngestMode] = useState('upload') // 'upload' | 'location'
  const [currentBatch, setCurrentBatch] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [selectedDocResult, setSelectedDocResult] = useState(null)
  const fileInputRef = useRef(null)
  const folderInputRef = useRef(null)
  const pollIntervalRef = useRef(null)

  // Drag & drop handlers
  const [isDragging, setIsDragging] = useState(false)

  const handleDragOver = (e) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(Array.from(e.dataTransfer.files))
    }
  }

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(Array.from(e.target.files))
    }
  }

  const addFiles = (newFiles) => {
    setFilesToUpload(prev => {
      const existingNames = new Set(prev.map(f => f.name + f.size))
      const unique = newFiles.filter(f => !existingNames.has(f.name + f.size))
      return [...prev, ...unique]
    })
    setError(null)
  }

  const removeFile = (idx) => {
    setFilesToUpload(prev => prev.filter((_, i) => i !== idx))
  }

  const clearAllFiles = () => {
    setFilesToUpload([])
  }

  // Start Batch from uploaded files
  const handleStartBatch = async () => {
    if (filesToUpload.length === 0) return
    setIsLoading(true)
    setError(null)
    try {
      const resp = await createBatch({
        files: filesToUpload,
        batchName: batchName || `Batch ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
      })
      setCurrentBatch(resp)
      setFilesToUpload([])
      setBatchName('')
    } catch (err) {
      setError(err.message || 'Failed to start batch classification.')
    } finally {
      setIsLoading(false)
    }
  }

  // Start Batch from direct file or folder location path
  const handleStartPathBatch = async () => {
    if (!inputLocationPath.trim()) {
      setError('Please enter a folder path or file location.')
      return
    }
    setIsScanningPath(true)
    setError(null)
    try {
      const resp = await createBatchFromPath({
        folderPath: inputLocationPath.trim(),
        batchName: batchName || `Batch (${inputLocationPath.trim().split(/[\\/]/).pop()})`
      })
      setCurrentBatch(resp)
      setInputLocationPath('')
      setBatchName('')
    } catch (err) {
      setError(err.message || 'Failed to scan and ingest folder location.')
    } finally {
      setIsScanningPath(false)
    }
  }

  // Poll active batch while PROCESSING
  useEffect(() => {
    if (!currentBatch || currentBatch.status !== 'PROCESSING') {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
      return
    }

    pollIntervalRef.current = setInterval(async () => {
      try {
        const updated = await getBatch(currentBatch.batch_id)
        setCurrentBatch(updated)
        if (updated.status !== 'PROCESSING') {
          clearInterval(pollIntervalRef.current)
        }
      } catch (e) {
        console.warn('Batch poll error:', e)
      }
    }, 1500)

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    }
  }, [currentBatch?.batch_id, currentBatch?.status])

  // Retry Failed
  const handleRetryFailed = async () => {
    if (!currentBatch?.batch_id) return
    try {
      const updated = await retryBatch(currentBatch.batch_id)
      setCurrentBatch(updated)
    } catch (e) {
      setError(e.message || 'Retry failed.')
    }
  }

  // Filtered files list in current batch
  const batchFiles = (currentBatch?.files || []).filter(f => {
    const q = searchQuery.toLowerCase().trim()
    const matchesQ = !q || (f.filename || '').toLowerCase().includes(q) || (f.primary_category || '').toLowerCase().includes(q)
    const matchesStatus = statusFilter === 'ALL' || f.status === statusFilter
    return matchesQ && matchesStatus
  })

  const catDist = currentBatch?.category_distribution || {}

  return (
    <div className="srtBulkWorkspace">
      {/* 0. WORKSPACE HEADER WITH SINGLE CLOSE BUTTON */}
      {onClose && (
        <div className="srtBulkTopBar">
          <div className="srtBulkTopTitle">
            <div className="srtBulkTopIcon">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#38bdf8" strokeWidth="2.2">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <div>
              <span className="srtBulkTopHeading">BULK FILE CLASSIFICATION WORKSPACE</span>
              <span className="srtBulkTopSub">Automated parallel batch routing, directory scanning, and enterprise taxonomy tagging</span>
            </div>
          </div>
          <button type="button" className="srtBulkCloseBtn" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>
      )}

      {/* 1. UPLOAD & INGEST STAGE */}
      {!currentBatch && (
        <div className="srtBulkUploadCard">
          <div className="srtBulkCardHead">
            <div>
              <h3>Enterprise Ingestion &amp; Batch Intake</h3>
              <p>Upload files or point to a local directory location to classify in parallel.</p>
            </div>
            <div className="srtBulkLimitsBadge">
              <span>PDF · DOCX · TXT · XLSX · PPTX · ZIP · IMAGES</span>
            </div>
          </div>

          {/* INGESTION MODE SELECTOR TABS */}
          <div className="srtBulkTabGroup">
            <button
              type="button"
              className={`srtBulkTabBtn ${ingestMode === 'upload' ? 'active' : ''}`}
              onClick={() => setIngestMode('upload')}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span>Upload Files &amp; Folders</span>
            </button>
            <button
              type="button"
              className={`srtBulkTabBtn ${ingestMode === 'location' ? 'active' : ''}`}
              onClick={() => setIngestMode('location')}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <span>Direct File / Folder Location</span>
            </button>
          </div>

          {/* MODE A: DRAG & DROP UPLOAD */}
          {ingestMode === 'upload' && (
            <div
              className={`srtDropZone ${isDragging ? 'dragging' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                type="file"
                multiple
                ref={fileInputRef}
                onChange={handleFileChange}
                style={{ display: 'none' }}
                accept=".pdf,.docx,.txt,.xlsx,.pptx,.csv,.json,.xml,.md,.png,.jpg,.jpeg,.zip"
              />
              <input
                type="file"
                webkitdirectory=""
                directory=""
                multiple
                ref={folderInputRef}
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />

              <div className="srtDropIcon">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div className="srtDropTitle">
                <strong>Drag and drop files or folders here</strong>
                <span>or click to browse your computer</span>
              </div>
              <div className="srtDropActions" onClick={e => e.stopPropagation()}>
                <button
                  type="button"
                  className="srtBulkActionBtn primary"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span>Choose Multiple Files</span>
                </button>
                <button
                  type="button"
                  className="srtBulkActionBtn secondary"
                  onClick={() => folderInputRef.current?.click()}
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <span>Upload Entire Folder</span>
                </button>
              </div>
            </div>
          )}

          {/* MODE B: DIRECT LOCAL FILE / FOLDER LOCATION */}
          {ingestMode === 'location' && (
            <div className="srtPathInputCard">
              <div className="srtPathHeader">
                <strong>Enter Local Directory or Network File Location:</strong>
                <p>Specify a local folder path on your system. SORTIA will automatically crawl and classify all supported documents.</p>
              </div>
              <div className="srtPathInputRow">
                <div className="srtPathFieldWrap">
                  <svg className="srtPathIcon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#38bdf8" strokeWidth="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <input
                    type="text"
                    className="srtPathInput"
                    placeholder="e.g. C:\Users\Documents\Invoices or D:\Archive\Contracts"
                    value={inputLocationPath}
                    onChange={e => setInputLocationPath(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleStartPathBatch() }}
                  />
                </div>
                <button
                  type="button"
                  className="srtScanPathBtn"
                  onClick={handleStartPathBatch}
                  disabled={isScanningPath || !inputLocationPath.trim()}
                >
                  {isScanningPath ? 'Scanning Location...' : 'Scan & Classify Location ↗'}
                </button>
              </div>
              <div className="srtPathSuggestions">
                <span>Quick Location Shortcuts:</span>
                <button type="button" onClick={() => setInputLocationPath('c:\\Users\\ELCOT\\OneDrive\\Desktop\\Agent')}>Current Agent Workspace</button>
              </div>
            </div>
          )}

          {error && <div className="srtBulkError">{error}</div>}

          {/* Staged files queue */}
          {filesToUpload.length > 0 && ingestMode === 'upload' && (
            <div className="srtStagedFilesBox">
              <div className="srtStagedHead">
                <span>{filesToUpload.length} files selected ({formatBytes(filesToUpload.reduce((s, f) => s + f.size, 0))})</span>
                <button type="button" className="srtTextBtn" onClick={clearAllFiles}>Clear List</button>
              </div>

              <div className="srtStagedList">
                {filesToUpload.slice(0, 15).map((f, i) => (
                  <div key={i} className="srtStagedItem">
                    <span className="srtStagedName">{f.name}</span>
                    <span className="srtStagedSize">{formatBytes(f.size)}</span>
                    <button type="button" className="srtStagedDel" onClick={() => removeFile(i)}>✕</button>
                  </div>
                ))}
                {filesToUpload.length > 15 && (
                  <div className="srtStagedMore">+ {filesToUpload.length - 15} more files in batch queue</div>
                )}
              </div>

              <div className="srtStartRow">
                <input
                  type="text"
                  placeholder="Optional Batch Name (e.g. Q4 Policy Archive)"
                  className="srtBatchNameInput"
                  value={batchName}
                  onChange={e => setBatchName(e.target.value)}
                />
                <button
                  type="button"
                  className="srtPrimaryBtn"
                  onClick={handleStartBatch}
                  disabled={isLoading}
                >
                  {isLoading ? 'Creating Batch...' : `Start Batch Classification (${filesToUpload.length} Files)`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. ACTIVE BATCH RESULTS DASHBOARD */}
      {currentBatch && (
        <div className="srtBatchDashboard">
          {/* Top Banner */}
          <div className="srtBatchHeadBanner">
            <div className="srtBatchMeta">
              <span className={`srtBatchStatusPill ${currentBatch.status.toLowerCase()}`}>
                <span className="dot" />
                {currentBatch.status}
              </span>
              <strong className="srtBatchId">{currentBatch.batch_id}</strong>
              <span className="srtBatchName">{currentBatch.batch_name}</span>
            </div>
            <div className="srtBatchActions">
              <a
                href={getBatchExportUrl(currentBatch.batch_id)}
                download={`${currentBatch.batch_id}_export.csv`}
                className="srtToolBtn"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>Export CSV</span>
              </a>
              {currentBatch.failed_count > 0 && (
                <button type="button" className="srtToolBtn warning" onClick={handleRetryFailed}>
                  Retry Failed ({currentBatch.failed_count})
                </button>
              )}
              <button
                type="button"
                className="srtToolBtn primary"
                onClick={() => setCurrentBatch(null)}
              >
                + New Batch
              </button>
            </div>
          </div>

          {/* 4 KPI Cards */}
          <div className="srtBatchKpiGrid">
            <div className="srtBatchKpi">
              <span className="kpiLabel">TOTAL FILES</span>
              <strong className="kpiVal">{currentBatch.total_files}</strong>
              <span className="kpiSub">{currentBatch.progress_pct}% processed</span>
            </div>
            <div className="srtBatchKpi">
              <span className="kpiLabel">AUTONOMOUSLY ROUTED</span>
              <strong className="kpiVal green">{currentBatch.classified_count}</strong>
              <span className="kpiSub">Destination verified</span>
            </div>
            <div className="srtBatchKpi">
              <span className="kpiLabel">EXCEPTION QUEUE</span>
              <strong className="kpiVal amber">{currentBatch.exceptions_count}</strong>
              <span className="kpiSub">Ambiguous or restricted</span>
            </div>
            <div className="srtBatchKpi">
              <span className="kpiLabel">FAILED</span>
              <strong className="kpiVal red">{currentBatch.failed_count}</strong>
              <span className="kpiSub">Validation/read error</span>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="srtBatchProgressWrap">
            <div className="srtBatchProgressBar">
              <div className="srtBatchProgressFill" style={{ width: `${currentBatch.progress_pct}%` }} />
            </div>
          </div>

          {/* Category Distribution Chips */}
          {Object.keys(catDist).length > 0 && (
            <div className="srtBatchDistSection">
              <span className="distLabel">BATCH CLASSIFICATION DISTRIBUTION:</span>
              <div className="distChips">
                {Object.entries(catDist).map(([cat, count]) => (
                  <span key={cat} className="distChip">
                    <strong>{cat}</strong> <span>({count})</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Search & Filter Toolbar */}
          <div className="srtTableToolbar">
            <input
              type="text"
              placeholder="Search by file name or category..."
              className="srtTableSearchInput"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            <div className="srtTableFilters">
              {['ALL', 'ROUTED', 'EXCEPTION_QUEUE', 'FAILED'].map(st => (
                <button
                  key={st}
                  type="button"
                  className={`srtFilterTab ${statusFilter === st ? 'active' : ''}`}
                  onClick={() => setStatusFilter(st)}
                >
                  {st === 'ALL' ? 'All Files' : st.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          {/* File-Level Results Table */}
          <div className="srtTableWrap">
            <table className="srtBatchTable">
              <thead>
                <tr>
                  <th>DOCUMENT</th>
                  <th>CLASSIFICATION</th>
                  <th>CONFIDENCE</th>
                  <th>AMBIGUITY</th>
                  <th>SECURITY</th>
                  <th>DESTINATION</th>
                  <th>STATUS</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {batchFiles.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="srtTableEmpty">No files matching current criteria.</td>
                  </tr>
                ) : (
                  batchFiles.map((file) => (
                    <tr key={file.doc_id}>
                      <td className="fileCell">
                        <strong>{file.filename}</strong>
                        {file.is_duplicate && <span className="dupBadge">Duplicate</span>}
                      </td>
                      <td>
                        <span className="catCell">{file.primary_category || '—'}</span>
                        {file.subtype && <small className="subCell">{file.subtype}</small>}
                      </td>
                      <td>
                        {file.confidence ? (
                          <strong className="confCell">{file.confidence}%</strong>
                        ) : '—'}
                      </td>
                      <td>
                        <span className={`ambBadge ${(file.ambiguity_level || 'low').toLowerCase()}`}>
                          {file.ambiguity_level || 'Low'}
                        </span>
                      </td>
                      <td>
                        <span className={`sensCell ${(file.sensitivity || 'internal').toLowerCase()}`}>
                          {file.sensitivity || 'Internal'}
                        </span>
                      </td>
                      <td className="destCell">
                        <code>{file.destination_path || '—'}</code>
                      </td>
                      <td>
                        <span className={`statusTag ${(file.status || 'pending').toLowerCase()}`}>
                          {file.status === 'ROUTED' ? 'ROUTED' : file.status === 'EXCEPTION_QUEUE' ? 'EXCEPTION' : file.status}
                        </span>
                      </td>
                      <td>
                        {file.result ? (
                          <button
                            type="button"
                            className="srtViewBtn"
                            onClick={() => setSelectedDocResult(file.result)}
                          >
                            Inspect ↗
                          </button>
                        ) : (
                          <span className="noAct">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. SINGLE DOCUMENT DETAIL MODAL (CLEAN RESULT CARD) */}
      {selectedDocResult && (
        <div className="srtModalOverlay" onClick={() => setSelectedDocResult(null)}>
          <div className="srtModalContent" onClick={e => e.stopPropagation()}>
            <div className="srtModalHead">
              <span>DOCUMENT CLASSIFICATION DETAIL</span>
              <button
                type="button"
                className="srtModalClose"
                onClick={() => setSelectedDocResult(null)}
              >
                ✕
              </button>
            </div>
            <div className="srtModalBody">
              <SortiaResultCard data={selectedDocResult} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
