import { useState, useEffect, useRef } from 'react'
import {
  createBatch,
  createBatchFromPath,
  getBatch,
  getBatches,
  retryBatch,
  updateBatchStorageLocation,
  getBatchExportUrl,
} from '../services/api.js'
import SortiaResultCard from './SortiaResultCard.jsx'

const BULK_HISTORY_KEY = 'sortia_bulk_batches_v1'

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

function loadSavedBulkBatches() {
  try {
    const raw = localStorage.getItem(BULK_HISTORY_KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list.filter(b => b && b.batch_id) : []
  } catch {
    return []
  }
}

function persistBulkBatches(list) {
  try {
    localStorage.setItem(BULK_HISTORY_KEY, JSON.stringify((list || []).slice(0, 40)))
  } catch {
    // ignore storage quota errors
  }
}

function buildClientSimilarGroups(batch) {
  if (!batch) return []
  const baseLoc = (batch.target_storage_location || '/Enterprise_Vault').replace(/[\\/]+$/, '')
  const sep = baseLoc.includes('\\') && !baseLoc.includes('/') ? '\\' : '/'
  const map = {}
  for (const f of batch.files || []) {
    if (f.status === 'FAILED') continue
    const cat = f.primary_category || 'Unclassified'
    const catSlug = cat.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'Classified'
    const folder = f.similar_group_folder || `${baseLoc}${sep}${catSlug}${sep}`
    if (!map[cat]) {
      map[cat] = { category: cat, target_folder: folder, count: 0, documents: [] }
    }
    const ownerOrg = f.owner_organization || f.result?.owner_organization || f.result?.extracted_metadata?.owner_organization || 'Enterprise Entity'
    const uniqueId = f.unique_entity_id || f.result?.unique_entity_id || f.result?.extracted_metadata?.unique_entity_id || f.doc_id
    const stdName = f.standardized_filename || f.result?.standardized_filename || `${ownerOrg.replace(/[^A-Za-z0-9]+/g, '_')}__${uniqueId}__${catSlug}_${f.filename}`
    map[cat].count += 1
    map[cat].documents.push({
      doc_id: f.doc_id,
      original_filename: f.filename,
      standardized_filename: stdName,
      owner_organization: ownerOrg,
      unique_entity_id: uniqueId,
      destination_path: f.destination_path || `${folder}${stdName}`,
    })
  }
  return Object.values(map).sort((a, b) => b.count - a.count)
}

export default function BulkClassificationWorkspace({
  onSelectDocForViewer,
  onClose,
  initialBatch = null,
  onBatchSaved,
}) {
  const [filesToUpload, setFilesToUpload] = useState([])
  const [batchName, setBatchName] = useState('')
  const [editLocationDraft, setEditLocationDraft] = useState('')
  const [isUpdatingLocation, setIsUpdatingLocation] = useState(false)
  const [locationSavedSuccess, setLocationSavedSuccess] = useState(false)
  const [inputLocationPath, setInputLocationPath] = useState('')
  const [isScanningPath, setIsScanningPath] = useState(false)
  const [ingestMode, setIngestMode] = useState('upload') // 'upload' | 'location'
  const [currentBatch, setCurrentBatch] = useState(initialBatch)
  const [bulkHistory, setBulkHistory] = useState(loadSavedBulkBatches)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [selectedDocResult, setSelectedDocResult] = useState(null)

  const fileInputRef = useRef(null)
  const folderInputRef = useRef(null)
  const similarLocInputRef = useRef(null)
  const pollIntervalRef = useRef(null)

  // Save/merge a batch into persistent history and notify parent App
  const upsertBatchInHistory = (batchObj) => {
    if (!batchObj || !batchObj.batch_id) return
    setBulkHistory(prev => {
      const next = [batchObj, ...prev.filter(b => b.batch_id !== batchObj.batch_id)]
      persistBulkBatches(next)
      return next
    })
    if (onBatchSaved) {
      onBatchSaved(batchObj)
    }
  }

  useEffect(() => {
    if (initialBatch && initialBatch.batch_id) {
      setCurrentBatch(initialBatch)
      setEditLocationDraft(initialBatch.target_storage_location || '')
      setLocationSavedSuccess(false)
    }
  }, [initialBatch?.batch_id])

  // Sync saved batches with backend /api/batches on mount
  useEffect(() => {
    let active = true
    getBatches()
      .then((res) => {
        if (!active || !res?.batches) return
        setBulkHistory(prev => {
          const byId = new Map()
          for (const b of prev) {
            if (b?.batch_id) byId.set(b.batch_id, b)
          }
          for (const b of res.batches) {
            if (!b?.batch_id) continue
            const existing = byId.get(b.batch_id)
            if (!existing || (b.files && b.files.length >= (existing.files?.length || 0))) {
              byId.set(b.batch_id, { ...existing, ...b })
            }
          }
          const merged = Array.from(byId.values()).sort((a, b) =>
            String(b.created_at || '').localeCompare(String(a.created_at || ''))
          )
          persistBulkBatches(merged)
          return merged
        })
      })
      .catch(() => {})
    return () => { active = false }
  }, [])

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

  const deleteBatchFromHistory = (batchId, e) => {
    if (e) e.stopPropagation()
    setBulkHistory(prev => {
      const next = prev.filter(b => b.batch_id !== batchId)
      persistBulkBatches(next)
      return next
    })
    if (currentBatch?.batch_id === batchId) {
      setCurrentBatch(null)
    }
  }

  // Start Batch from uploaded files (NO storage location required upfront!)
  const handleStartBatch = async () => {
    if (filesToUpload.length === 0) return
    setIsLoading(true)
    setError(null)
    setLocationSavedSuccess(false)
    try {
      const resp = await createBatch({
        files: filesToUpload,
        batchName: batchName || `Batch ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`,
        targetStorageLocation: '',
      })
      setCurrentBatch(resp)
      setEditLocationDraft(resp.target_storage_location || '')
      upsertBatchInHistory(resp)
      setFilesToUpload([])
      setBatchName('')
    } catch (err) {
      setError(err.message || 'Failed to start batch classification.')
    } finally {
      setIsLoading(false)
    }
  }

  // Start Batch from direct file or folder location path (NO storage location required upfront!)
  const handleStartPathBatch = async () => {
    if (!inputLocationPath.trim()) {
      setError('Please enter a source folder path or file location to scan.')
      return
    }
    setIsScanningPath(true)
    setError(null)
    setLocationSavedSuccess(false)
    try {
      const resp = await createBatchFromPath({
        folderPath: inputLocationPath.trim(),
        batchName: batchName || `Batch (${inputLocationPath.trim().split(/[\\/]/).pop()})`,
        targetStorageLocation: '',
      })
      setCurrentBatch(resp)
      setEditLocationDraft(resp.target_storage_location || '')
      upsertBatchInHistory(resp)
      setInputLocationPath('')
      setBatchName('')
    } catch (err) {
      setError(err.message || 'Failed to scan and ingest folder location.')
    } finally {
      setIsScanningPath(false)
    }
  }

  const handleApplyNewStorageLocation = async () => {
    if (!currentBatch?.batch_id || !editLocationDraft.trim()) return
    setIsUpdatingLocation(true)
    setError(null)
    setLocationSavedSuccess(false)
    try {
      const updated = await updateBatchStorageLocation(currentBatch.batch_id, editLocationDraft.trim())
      setCurrentBatch(updated)
      upsertBatchInHistory(updated)
      setLocationSavedSuccess(true)
    } catch (err) {
      // Fallback client-side update if batch was restored from localStorage after Lambda cold start
      const cleanLoc = editLocationDraft.trim().replace(/[\\/]+$/, '')
      const sep = cleanLoc.includes('\\') && !cleanLoc.includes('/') ? '\\' : '/'
      const updatedFiles = (currentBatch.files || []).map(f => {
        const catSlug = (f.primary_category || 'Classified').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'Classified'
        const stdName = f.standardized_filename || f.filename
        const groupFolder = `${cleanLoc}${sep}${catSlug}${sep}`
        return {
          ...f,
          similar_group_folder: groupFolder,
          destination_path: `${groupFolder}${stdName}`,
        }
      })
      const localUpdated = {
        ...currentBatch,
        target_storage_location: cleanLoc,
        files: updatedFiles,
      }
      localUpdated.similar_document_groups = buildClientSimilarGroups(localUpdated)
      setCurrentBatch(localUpdated)
      upsertBatchInHistory(localUpdated)
      setLocationSavedSuccess(true)
    } finally {
      setIsUpdatingLocation(false)
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
        upsertBatchInHistory(updated)
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
      upsertBatchInHistory(updated)
    } catch (e) {
      setError(e.message || 'Retry failed.')
    }
  }

  const handleOpenSavedBatch = async (b) => {
    setError(null)
    setLocationSavedSuccess(false)
    if (b.files && b.files.length > 0) {
      setCurrentBatch(b)
      setEditLocationDraft(b.target_storage_location || '')
      return
    }
    try {
      const full = await getBatch(b.batch_id)
      setCurrentBatch(full)
      setEditLocationDraft(full.target_storage_location || '')
      upsertBatchInHistory(full)
    } catch {
      setCurrentBatch(b)
      setEditLocationDraft(b.target_storage_location || '')
    }
  }

  // Filtered files list in current batch (searches filename, owner/organization name, unique ID, and category!)
  const batchFiles = (currentBatch?.files || []).filter(f => {
    const q = searchQuery.toLowerCase().trim()
    const ownerOrg = (f.owner_organization || f.result?.owner_organization || '').toLowerCase()
    const uniqueId = (f.unique_entity_id || f.result?.unique_entity_id || '').toLowerCase()
    const stdName = (f.standardized_filename || f.result?.standardized_filename || '').toLowerCase()
    const matchesQ =
      !q ||
      (f.filename || '').toLowerCase().includes(q) ||
      (f.primary_category || '').toLowerCase().includes(q) ||
      ownerOrg.includes(q) ||
      uniqueId.includes(q) ||
      stdName.includes(q)
    const matchesStatus = statusFilter === 'ALL' || f.status === statusFilter
    return matchesQ && matchesStatus
  })

  const allGroups = buildClientSimilarGroups(currentBatch)
  // A "Similar Document Group" is a category where 2 or more documents share the same classification
  const similarDocClusters = allGroups.filter(g => g.count >= 2)
  const totalSimilarDocsCount = similarDocClusters.reduce((acc, g) => acc + g.count, 0)

  return (
    <div className="srtBulkWorkspace">
      {/* 0. WORKSPACE HEADER */}
      {onClose && (
        <div className="srtBulkTopBar">
          <div className="srtBulkTopTitle">
            <div className="srtBulkTopIcon">
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#38bdf8" strokeWidth="2.2">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <div>
              <span className="srtBulkTopHeading">BULK FILE CLASSIFICATION &amp; ROUTING ENGINE</span>
              <span className="srtBulkTopSub">Identifies document type, owner/organization &amp; unique entity ID, and detects similar documents across batches</span>
            </div>
          </div>
          <button type="button" className="srtBulkCloseBtn" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>
      )}

      {/* 1. UPLOAD & INGEST STAGE (NO UPFRONT STORAGE PROMPT) */}
      {!currentBatch && (
        <div className="srtBulkUploadCard">
          <div className="srtBulkCardHead">
            <div>
              <h3>Enterprise Ingestion &amp; Batch Intake</h3>
              <p>Upload multiple files or scan a source folder to classify in parallel. If SORTIA detects similar documents, it will prompt you for a storage location to group them.</p>
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
              <span>Direct Source File / Folder Location</span>
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

          {/* MODE B: DIRECT LOCAL SOURCE FILE / FOLDER LOCATION */}
          {ingestMode === 'location' && (
            <div className="srtPathInputCard">
              <div className="srtPathHeader">
                <strong>Enter Source Directory or Network File Location to Scan:</strong>
                <p>Specify a local folder path on your system. SORTIA will crawl and classify all documents inside.</p>
              </div>
              <div className="srtPathInputRow">
                <div className="srtPathFieldWrap">
                  <svg className="srtPathIcon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#38bdf8" strokeWidth="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <input
                    type="text"
                    className="srtPathInput"
                    placeholder="e.g. C:\Users\Documents\Incoming_Files or D:\Archive\Unsorted_Batch"
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
                  placeholder="Optional Batch Name (e.g. Q4 Commercial Lending Batch)"
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
                  {isLoading ? 'Classifying Documents...' : `Start Batch Classification (${filesToUpload.length} Files)`}
                </button>
              </div>
            </div>
          )}

          {/* SAVED BULK CLASSIFICATION HISTORY */}
          {bulkHistory.length > 0 && (
            <div className="srtStagedFilesBox" style={{ marginTop: '20px' }}>
              <div className="srtStagedHead">
                <strong style={{ color: '#e2e8f0', fontSize: '13.5px' }}>
                  Saved Bulk Classification History ({bulkHistory.length})
                </strong>
              </div>
              <div className="srtStagedList" style={{ maxHeight: '240px' }}>
                {bulkHistory.map((b) => (
                  <div
                    key={b.batch_id}
                    className="srtStagedItem"
                    style={{ cursor: 'pointer', padding: '10px 12px', justifyContent: 'space-between' }}
                    onClick={() => handleOpenSavedBatch(b)}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <strong style={{ color: '#38bdf8', fontSize: '13px' }}>{b.batch_name || b.batch_id}</strong>
                        <code style={{ fontSize: '11px', color: '#94a3b8' }}>{b.batch_id}</code>
                        <span className={`statusTag ${(b.status || 'completed').toLowerCase()}`} style={{ fontSize: '10px', padding: '2px 7px' }}>
                          {b.status || 'COMPLETED'}
                        </span>
                      </div>
                      <div style={{ fontSize: '11.5px', color: '#94a3b8' }}>
                        {b.total_files || (b.files?.length || 0)} files · {b.classified_count ?? (b.files?.length || 0)} routed
                        {b.target_storage_location ? ` · Stored in: ${b.target_storage_location}` : ''}
                        {b.created_at ? ` · ${b.created_at}` : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        type="button"
                        className="srtViewBtn"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleOpenSavedBatch(b)
                        }}
                      >
                        Open Batch ↗
                      </button>
                      <button
                        type="button"
                        className="srtStagedDel"
                        title="Delete saved batch"
                        onClick={(e) => deleteBatchFromHistory(b.batch_id, e)}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
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
              <span className={`srtBatchStatusPill ${(currentBatch.status || 'completed').toLowerCase()}`}>
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
                <span>Export CSV (With Owner &amp; Unique ID)</span>
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
                ← All Batches / + New Batch
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
              <span className="kpiSub">Classified with Owner &amp; Unique ID</span>
            </div>
            <div className="srtBatchKpi">
              <span className="kpiLabel">SIMILAR DOC GROUPS</span>
              <strong className="kpiVal" style={{ color: '#38bdf8' }}>{similarDocClusters.length}</strong>
              <span className="kpiSub">
                {similarDocClusters.length > 0
                  ? `${totalSimilarDocsCount} similar docs detected`
                  : 'No multi-doc clusters'}
              </span>
            </div>
            <div className="srtBatchKpi">
              <span className="kpiLabel">EXCEPTIONS / FAILED</span>
              <strong className="kpiVal amber">{(currentBatch.exceptions_count || 0) + (currentBatch.failed_count || 0)}</strong>
              <span className="kpiSub">Ambiguous or validation error</span>
            </div>
          </div>

          {/* ONLY SHOW STORAGE LOCATION PROMPT AFTER FINDING SIMILAR DOCUMENTS (count >= 2) */}
          {similarDocClusters.length > 0 && (
            <div
              className="srtPathInputCard"
              style={{
                marginBottom: '14px',
                padding: '14px 16px',
                border: '1px solid rgba(56, 189, 248, 0.45)',
                background: 'rgba(7, 140, 255, 0.09)',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div>
                  <strong style={{ color: '#38bdf8', fontSize: '13.5px', display: 'block', marginBottom: '3px' }}>
                    📁 Similar Documents Found ({totalSimilarDocsCount} documents across {similarDocClusters.length} similar group{similarDocClusters.length > 1 ? 's' : ''}: {similarDocClusters.map(g => `${g.category} (${g.count})`).join(', ')})
                  </strong>
                  <span style={{ fontSize: '12.5px', color: '#cbd5e1' }}>
                    Where would you like to store these similar documents together? Enter a particular target folder location below:
                  </span>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
                  <div className="srtPathFieldWrap" style={{ flex: '1 1 360px' }}>
                    <svg className="srtPathIcon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#38bdf8" strokeWidth="2">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    <input
                      ref={similarLocInputRef}
                      type="text"
                      className="srtPathInput"
                      placeholder="Enter location to store similar documents (e.g. C:\Enterprise_Vault\Similar_Docs or /Archive/Commercial_Loan_Docs)"
                      value={editLocationDraft}
                      onChange={e => {
                        setEditLocationDraft(e.target.value)
                        if (locationSavedSuccess) setLocationSavedSuccess(false)
                      }}
                      onKeyDown={e => { if (e.key === 'Enter') handleApplyNewStorageLocation() }}
                    />
                  </div>
                  <button
                    type="button"
                    className="srtToolBtn primary"
                    onClick={handleApplyNewStorageLocation}
                    disabled={isUpdatingLocation || !editLocationDraft.trim()}
                    style={{ padding: '9px 16px', fontWeight: 700 }}
                  >
                    {isUpdatingLocation ? 'Storing Similar Docs...' : 'Store Similar Documents Here ↗'}
                  </button>
                </div>

                {(locationSavedSuccess || currentBatch.target_storage_location) && (
                  <div style={{ fontSize: '12px', color: '#6ee7b7', fontWeight: 600 }}>
                    ✓ All similar documents have been grouped and routed to: <code>{currentBatch.target_storage_location}</code>
                  </div>
                )}

                {/* Display grouped similar documents */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px', marginTop: '4px' }}>
                  {similarDocClusters.map((grp) => (
                    <div
                      key={grp.category}
                      style={{
                        background: 'rgba(4, 18, 32, 0.88)',
                        border: '1px solid rgba(56, 189, 248, 0.28)',
                        borderRadius: '10px',
                        padding: '10px 12px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <strong style={{ color: '#38bdf8', fontSize: '13px' }}>{grp.category}</strong>
                        <span className="distChip" style={{ fontSize: '11px', padding: '2px 8px' }}>
                          {grp.count} similar docs
                        </span>
                      </div>
                      <div style={{ fontSize: '11px', color: '#6ee7b7', fontFamily: 'monospace', wordBreak: 'break-all', marginBottom: '8px' }}>
                        📁 {grp.target_folder}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        {(grp.documents || []).map((d, di) => (
                          <div
                            key={d.doc_id || di}
                            style={{
                              fontSize: '11.5px',
                              padding: '5px 8px',
                              borderRadius: '6px',
                              background: 'rgba(15, 23, 42, 0.72)',
                              border: '1px solid rgba(148, 163, 184, 0.16)',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px', flexWrap: 'wrap' }}>
                              <strong style={{ color: '#f1f5f9' }}>{d.owner_organization}</strong>
                              <code style={{ color: '#38bdf8', fontSize: '11px' }}>ID: {d.unique_entity_id}</code>
                            </div>
                            <div style={{ color: '#94a3b8', fontSize: '11px', wordBreak: 'break-all', marginTop: '2px' }}>
                              → {d.standardized_filename}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Search & Filter Toolbar */}
          <div className="srtTableToolbar">
            <input
              type="text"
              placeholder="Search by organization/owner name, unique ID (e.g. CL-2024-00871), file name, or category..."
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

          {/* File-Level Results Table with OWNER / ORGANIZATION & UNIQUE ID */}
          <div className="srtTableWrap">
            <table className="srtBatchTable">
              <thead>
                <tr>
                  <th>DOCUMENT &amp; SORTED FILE ID</th>
                  <th>OWNER / ORGANIZATION &amp; UNIQUE ID</th>
                  <th>CLASSIFICATION</th>
                  <th>CONFIDENCE</th>
                  <th>SECURITY</th>
                  <th>STORAGE LOCATION</th>
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
                  batchFiles.map((file) => {
                    const ownerOrg = file.owner_organization || file.result?.owner_organization || file.result?.extracted_metadata?.owner_organization || 'Enterprise Entity'
                    const uniqueId = file.unique_entity_id || file.result?.unique_entity_id || file.result?.extracted_metadata?.unique_entity_id || file.doc_id
                    const stdName = file.standardized_filename || file.result?.standardized_filename || file.filename
                    return (
                      <tr key={file.doc_id}>
                        <td className="fileCell">
                          <strong>{file.filename}</strong>
                          <div style={{ fontSize: '11px', color: '#94a3b8', fontFamily: 'monospace', marginTop: '2px', wordBreak: 'break-all' }}>
                            Sorted ID: {stdName}
                          </div>
                          {file.is_duplicate && <span className="dupBadge">Duplicate</span>}
                        </td>
                        <td>
                          <strong style={{ color: '#38bdf8', display: 'block', fontSize: '12.5px' }}>{ownerOrg}</strong>
                          <code style={{ color: '#6ee7b7', fontSize: '11px' }}>ID: {uniqueId}</code>
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
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. SINGLE DOCUMENT DETAIL MODAL */}
      {selectedDocResult && (
        <div className="srtModalOverlay" onClick={() => setSelectedDocResult(null)}>
          <div className="srtModalContent" onClick={e => e.stopPropagation()}>
            <div className="srtModalHead">
              <span>DOCUMENT CLASSIFICATION &amp; OWNER IDENTITY DETAIL</span>
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
