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

