const API_BASE = import.meta.env.VITE_API_BASE || ''

export async function classifyContent({ file, text, conversationHistory = [] }) {
  const formData = new FormData()
  if (file) {
    formData.append('file', file)
  }
  if (text) {
    formData.append('text', text)
  }
  formData.append('conversation_history', JSON.stringify(conversationHistory))

  const res = await fetch(`${API_BASE}/api/classify`, {
    method: 'POST',
    body: formData
  })

  const textResp = await res.text()
  let data
  try {
    data = JSON.parse(textResp)
  } catch (e) {
    if (textResp.trim().startsWith('<!doctype') || textResp.trim().startsWith('<html')) {
      throw new Error(`CloudFront/API Gateway returned HTML (${res.status}). Verify /api/* routing.`)
    }
    throw new Error(`Invalid server response (${res.status}): ${textResp.slice(0, 150)}`)
  }

  if (!res.ok) {
    throw new Error(data.detail || data.message || `Request failed (${res.status})`)
  }

  return data
}

export async function createBatch({ files = [], batchName = '', targetStorageLocation = '' }) {
  const formData = new FormData()
  for (const f of files) {
    formData.append('files', f)
  }
  if (batchName) {
    formData.append('batch_name', batchName)
  }
  if (targetStorageLocation) {
    formData.append('target_storage_location', targetStorageLocation)
  }

  const res = await fetch(`${API_BASE}/api/batch/create`, {
    method: 'POST',
    body: formData
  })
  const textResp = await res.text()
  let data
  try {
    data = JSON.parse(textResp)
  } catch (e) {
    throw new Error(`Invalid server response (${res.status}): ${textResp.slice(0, 150)}`)
  }
  if (!res.ok) {
    throw new Error(data.detail || data.message || `Failed to create batch (${res.status})`)
  }
  return data
}

export async function createBatchFromPath({ folderPath = '', batchName = '', targetStorageLocation = '' }) {
  const res = await fetch(`${API_BASE}/api/batch/create-from-path`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: folderPath,
      batch_name: batchName,
      target_storage_location: targetStorageLocation,
    })
  })
  const textResp = await res.text()
  let data
  try {
    data = JSON.parse(textResp)
  } catch (e) {
    throw new Error(`Invalid server response (${res.status}): ${textResp.slice(0, 150)}`)
  }
  if (!res.ok) {
    throw new Error(data.detail || data.message || `Failed to scan folder location (${res.status})`)
  }
  return data
}

export async function updateBatchStorageLocation(batchId, targetStorageLocation) {
  const res = await fetch(`${API_BASE}/api/batch/${encodeURIComponent(batchId)}/store-location`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target_storage_location: targetStorageLocation })
  })
  if (!res.ok) throw new Error(`Failed to update storage location (${res.status})`)
  return res.json()
}

export async function getBatch(batchId) {
  const res = await fetch(`${API_BASE}/api/batch/${encodeURIComponent(batchId)}`)
  if (!res.ok) throw new Error(`Batch not found (${res.status})`)
  return res.json()
}

export async function retryBatch(batchId) {
  const res = await fetch(`${API_BASE}/api/batch/${encodeURIComponent(batchId)}/retry`, {
    method: 'POST'
  })
  if (!res.ok) throw new Error(`Failed to retry batch (${res.status})`)
  return res.json()
}

export function getBatchExportUrl(batchId) {
  return `${API_BASE}/api/batch/${encodeURIComponent(batchId)}/export`
}

export async function getOverview() {
  const res = await fetch(`${API_BASE}/api/overview`)
  if (!res.ok) return null
  return res.json()
}

export async function getResults({ q = '', category = '', status = '' } = {}) {
  const p = new URLSearchParams()
  if (q) p.append('q', q)
  if (category) p.append('category', category)
  if (status) p.append('status', status)
  const res = await fetch(`${API_BASE}/api/results?${p.toString()}`)
  if (!res.ok) return { results: [], total: 0 }
  return res.json()
}

export async function getExceptions() {
  const res = await fetch(`${API_BASE}/api/exceptions`)
  if (!res.ok) return { exceptions: [], total: 0 }
  return res.json()
}

export async function getBatches() {
  const res = await fetch(`${API_BASE}/api/batches`)
  if (!res.ok) return { batches: [], total: 0 }
  return res.json()
}
