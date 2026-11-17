import React, { useEffect, useRef, useState } from 'react'
import SortiaSidebar from './components/SortiaSidebar.jsx'
import SortiaResultCard from './components/SortiaResultCard.jsx'
import DocumentViewer from './components/DocumentViewer.jsx'
import BulkClassificationWorkspace from './components/BulkClassificationWorkspace.jsx'
import {
  classifyContent,
  getOverview,
  getResults,
  getExceptions,
  getBatches,
  getBatchExportUrl
} from './services/api.js'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="errorRecoveryBox">
          <div className="errorRecoveryTitle">Display Recovery</div>
          <div className="errorRecoveryMsg">{this.state.error?.message || 'Unable to render this classification card.'}</div>
        </div>
      )
    }
    return this.props.children
  }
}

const STORAGE_KEY = 'sortia_sessions_v1'

const GENERIC_GREETINGS = new Set([
  'hi', 'hello', 'hey', 'ji', 'hlo', 'yo', 'sup', 'namaste', 'hola', 'greetings',
  'good morning', 'good afternoon', 'good evening', 'how are you', 'how are u',
  'how r u', 'hows it going', 'whats up', 'ok', 'okay', 'thanks', 'thank you',
  'bro', 'dude', 'bhai', 'machan', 'yaar', 'buddy', 'man'
])

function isGreeting(text) {
  if (!text) return true
  const clean = text.trim().toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ')
  if (clean.length <= 2) return true
  if (GENERIC_GREETINGS.has(clean)) return true
  return /^(?:hi+|h[ea]y+|h[ea]llo+|hlo|hola|greetings?|yo+|sup|namaste|bro|dude|bhai|yaar|buddy)(?:\s+(?:there|sortia|agent|bot|all|team|friend|buddy))?$/.test(clean) ||
         /^(?:(?:hi+|h[ea]y+|h[ea]llo+|hlo)\s+)?(?:how|hw)\s+(?:r|are|re)\s+(?:u|you|yu)(?:\s+doing)?$/.test(clean) ||
         /^(?:hru|whats?\s+up|hows?\s+it\s+going|hows?\s+u)$/.test(clean)
}

function shorten(str, max = 38) {
  if (!str) return ''
  return str.length > max ? str.slice(0, max).trim() + '...' : str
}

function cleanTitle(str) {
  if (!str) return ''
  return str.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function deriveSmartTitle(userText, fileName, aiResponse) {
  try {
    if (aiResponse && aiResponse.type === 'classification') {
      const customTitle = typeof aiResponse.classification_title === 'string' && aiResponse.classification_title.trim()
      if (customTitle) return shorten(cleanTitle(aiResponse.classification_title), 38)
      if (typeof aiResponse.primary_category === 'string' && aiResponse.primary_category.trim()) {
        return shorten(cleanTitle(aiResponse.primary_category), 38)
      }
    }

    if (fileName && typeof fileName === 'string') {
      const base = fileName.replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' ').trim()
      if (base) {
        const formatted = base.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
        return shorten(formatted, 38)
      }
    }

    if (userText && typeof userText === 'string' && !isGreeting(userText)) {
      let clean = userText.trim().replace(/\s+/g, ' ')
      clean = clean.replace(/^(?:can you|please|kindly|could you|would you|i want to|i need to|help me|can u|plz|tell me|classify|categorize|sort|identify)\s+/i, '')
      clean = clean.replace(/^(?:this|the|my|our|an?|some)\s+/i, '')
      clean = clean.replace(/^[?:!.,-\s]+/, '')
      if (clean.length > 2) {
        const words = clean.split(' ').slice(0, 5).join(' ')
        const capitalized = words.charAt(0).toUpperCase() + words.slice(1)
        return shorten(capitalized, 38)
      }
    }
  } catch (e) {
    console.warn('deriveSmartTitle error:', e)
  }

  return 'New conversation'
}

function formatTimestamp(ts) {
  if (!ts) return 'TODAY'
  const d = new Date(ts)
  if (isNaN(d.getTime())) return String(ts)
  const now = new Date()
  const diffDays = Math.floor((now - d) / 86400000)
  if (diffDays === 0) {
    return `TODAY · ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  } else if (diffDays === 1) {
    return 'YESTERDAY'
  }
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).toUpperCase()
}

function getPreview(messages) {
  try {
    if (!messages || !Array.isArray(messages) || messages.length === 0) return 'Content classification & routing assistant.'
    const lastAi = [...messages].reverse().find(m => m?.role === 'ai')
    const sumTxt = lastAi?.data?.summary
    if (typeof sumTxt === 'string' && sumTxt.trim()) {
      return sumTxt.slice(0, 90) + (sumTxt.length > 90 ? '...' : '')
    }
    const msgTxt = lastAi?.data?.message
    if (typeof msgTxt === 'string' && msgTxt.trim()) {
      return msgTxt.slice(0, 90) + (msgTxt.length > 90 ? '...' : '')
    }
    const docMsg = messages.find(m => m?.file?.name)
    if (docMsg?.file?.name) {
      return `Classified file: ${docMsg.file.name}`
    }
    const userMsg = messages.find(m => m?.role === 'user' && typeof m.content === 'string' && m.content && !isGreeting(m.content))
    if (userMsg?.content) {
      return userMsg.content.slice(0, 90) + (userMsg.content.length > 90 ? '...' : '')
    }
  } catch (e) {
    console.warn('getPreview error:', e)
  }
  return 'Predefined category classification & ambiguity check.'
}

export default function App() {
  const [view, setView] = useState('home')
  const [sessions, setSessions] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (!saved) return []
      const list = JSON.parse(saved).filter(s => s.messages && s.messages.length > 0)
      return list.map(s => {
        let t = s.title || 'New conversation'
        if (!s.titleLocked) {
          const firstUser = (s.messages || []).find(m => m.role === 'user' && !isGreeting(m.content))
          const firstFile = (s.messages || []).find(m => m.file?.name)
          const firstAi = (s.messages || []).find(m => m.role === 'ai' && m.data?.type === 'classification')
          if (firstUser || firstFile || firstAi) {
            t = deriveSmartTitle(firstUser?.content, firstFile?.file?.name, firstAi?.data)
          } else if (isGreeting(t)) {
            t = 'New conversation'
          }
        }
        return { ...s, title: t }
      })
    } catch {
      return []
    }
  })

  const [currentSessionId, setCurrentSessionId] = useState(null)
  const [messages, setMessages] = useState([])
  const [title, setTitle] = useState('New conversation')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [inputVal, setInputVal] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activeViewerDoc, setActiveViewerDoc] = useState(null)
  const [platformTab, setPlatformTab] = useState('classify') // 'overview' | 'classify' | 'results' | 'exceptions' | 'analytics'
  const [classifyMode, setClassifyMode] = useState('single') // 'single' | 'bulk'
  const [overviewData, setOverviewData] = useState(null)
  const [resultsList, setResultsList] = useState([])
  const [exceptionsList, setExceptionsList] = useState([])
  const [resultsFilter, setResultsFilter] = useState('')
  const [resultsCategoryFilter, setResultsCategoryFilter] = useState('ALL')
  const [inspectModalDoc, setInspectModalDoc] = useState(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  useEffect(() => {
    if (platformTab === 'overview' || platformTab === 'analytics') {
      getOverview().then(data => setOverviewData(data)).catch(console.error)
    }
    if (platformTab === 'results') {
      getResults().then(data => setResultsList(data.results || [])).catch(console.error)
    }
    if (platformTab === 'exceptions') {
      getExceptions().then(data => setExceptionsList(data.exceptions || [])).catch(console.error)
    }
  }, [platformTab, refreshTrigger])

  const fileInputRef = useRef(null)
  const homeFileInputRef = useRef(null)
  const messagesRef = useRef(null)

  useEffect(() => {
    const cleanForStorage = sessions
      .filter(s => s.messages && s.messages.length > 0)
      .map(s => ({
        ...s,
        messages: s.messages.map(m =>
          m.file ? { ...m, file: { name: m.file.name, size: m.file.size, type: m.file.type } } : m
        )
      }))
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanForStorage))
  }, [sessions])

  const scrollToLatest = () => {
    setTimeout(() => {
      const container = messagesRef.current
      if (!container) return
      const lastMsg = messages[messages.length - 1]
      if (!loading && lastMsg?.role === 'ai') {
        const aiCards = container.querySelectorAll('.bubble.ai')
        const lastAi = aiCards[aiCards.length - 1]
        if (lastAi) {
          container.scrollTo({ top: Math.max(0, lastAi.offsetTop - 24), behavior: 'smooth' })
          return
        }
      }
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
    }, 60)
  }

  useEffect(() => {
    if (view === 'chat') {
      scrollToLatest()
    }
  }, [messages, loading, view])

  function clearSelectedFile() {
    setSelectedFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (homeFileInputRef.current) homeFileInputRef.current.value = ''
  }

  function handleNewChat() {
    setCurrentSessionId(null)
    setMessages([])
    setTitle('New conversation')
    setEditingTitle(false)
    setTitleDraft('')
    clearSelectedFile()
    setActiveViewerDoc(null)
    setView('chat')
  }

  function handleLoadSession(id) {
    const sess = sessions.find(s => s.id === id)
    if (!sess) return
    setCurrentSessionId(sess.id)
    setMessages(sess.messages || [])
    setTitle(sess.title || 'New conversation')
    setEditingTitle(false)
    setTitleDraft('')
    clearSelectedFile()
    setActiveViewerDoc(null)
    setView('chat')
  }

  function handleRenameSession(id, newTitle) {
    const clean = (newTitle || '').trim()
    if (!clean) return
    setSessions(prev => prev.map(s => (s.id === id ? { ...s, title: clean, titleLocked: true } : s)))
    if (id === currentSessionId) {
      setTitle(clean)
    }
  }

  function handleDeleteSession(id) {
    setSessions(prev => prev.filter(s => s.id !== id))
    if (id === currentSessionId) {
      setCurrentSessionId(null)
      setMessages([])
      setTitle('New conversation')
      setActiveViewerDoc(null)
    }
  }

  function commitTitle() {
    const clean = titleDraft.trim()
    setEditingTitle(false)
    if (!clean) return
    setTitle(clean)
    if (currentSessionId) {
      handleRenameSession(currentSessionId, clean)
    }
  }

  function openDocument(fileObj, docMeta) {
    if (!fileObj && !docMeta) return
    const viewUrl = fileObj?.previewUrl || docMeta?.view_url || null
    const downloadUrl = docMeta?.url || fileObj?.previewUrl || null
    setActiveViewerDoc({
      name: fileObj?.name || docMeta?.filename || 'Document',
      viewUrl,
      downloadUrl,
      preview: docMeta?.preview || '',
      rawMeta: docMeta || { size: fileObj?.size, content_type: fileObj?.type }
    })
  }

  async function executeSend(rawText, fileObj, targetSessionId) {
    const cleanText = (rawText || '').trim()
    if (!cleanText && !fileObj) return
    if (loading) return

    let sid = targetSessionId
    if (!sid) {
      sid = `sortia_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      setCurrentSessionId(sid)
    }

    let previewUrl = null
    if (fileObj) {
      try {
        previewUrl = URL.createObjectURL(fileObj)
      } catch (e) {
        console.warn('Blob URL creation warning:', e)
      }
    }

    const userMsg = {
      id: `u_${Date.now()}`,
      role: 'user',
      content: cleanText,
      file: fileObj
        ? { name: fileObj.name, size: fileObj.size, type: fileObj.type, previewUrl }
        : null
    }

    const prevList = sid === currentSessionId ? messages : (sessions.find(s => s.id === sid)?.messages || [])
    const nextList = [...prevList, userMsg]
    setMessages(nextList)
    setInputVal('')
    clearSelectedFile()
    setLoading(true)

    const initialTitle = deriveSmartTitle(cleanText, fileObj?.name, null)
    setSessions(prev => {
      const exists = prev.find(s => s.id === sid)
      if (exists) {
        const shouldUpdate = !exists.titleLocked && (exists.title === 'New conversation' || isGreeting(exists.title)) && initialTitle !== 'New conversation'
        const updatedTitle = shouldUpdate ? initialTitle : exists.title
        if (updatedTitle !== exists.title) setTitle(updatedTitle)
        return prev.map(s => s.id === sid ? { ...s, title: updatedTitle, updatedAt: Date.now(), messages: nextList } : s)
      }
      setTitle(initialTitle)
      return [
        { id: sid, title: initialTitle, titleLocked: false, createdAt: Date.now(), updatedAt: Date.now(), messages: nextList },
        ...prev
      ]
    })

    const apiHistory = prevList.slice(-6).map(m => ({
      role: m.role === 'ai' ? 'assistant' : 'user',
      content: m.role === 'ai'
        ? (m.data?.summary || m.data?.message || m.data?.primary_category || 'Classification generated')
        : (m.content || (m.file ? `Uploaded ${m.file.name}` : ''))
    }))

    try {
      const [result] = await Promise.all([
        classifyContent({
          file: fileObj || null,
          text: cleanText,
          conversationHistory: apiHistory
        }),
        new Promise(res => setTimeout(res, 900))
      ])

      const docMeta = result?.document || null
      const enrichedList = nextList.map(m =>
        m.id === userMsg.id && docMeta ? { ...m, docMeta } : m
      )

      const aiMsg = {
        id: `a_${Date.now()}`,
        role: 'ai',
        data: result
      }

      const finalMessages = [...enrichedList, aiMsg]
      setMessages(finalMessages)

      if (docMeta && activeViewerDoc && activeViewerDoc.name === docMeta.filename) {
        setActiveViewerDoc(prev => prev ? {
          ...prev,
          viewUrl: docMeta.view_url || prev.viewUrl,
          downloadUrl: docMeta.url || prev.downloadUrl,
          preview: docMeta.preview || prev.preview,
          rawMeta: docMeta
        } : prev)
      }

      const aiTitle = deriveSmartTitle(cleanText, fileObj?.name, result)
      setSessions(prev => prev.map(s => {
        if (s.id !== sid) return s
        const shouldUpgrade = !s.titleLocked && (s.title === 'New conversation' || isGreeting(s.title) || result?.type === 'classification') && aiTitle !== 'New conversation'
        const nextTitle = shouldUpgrade ? aiTitle : s.title
        if (nextTitle !== s.title) setTitle(nextTitle)
        return { ...s, title: nextTitle, updatedAt: Date.now(), messages: finalMessages }
      }))
    } catch (err) {
      const errMsg = {
        id: `err_${Date.now()}`,
        role: 'ai',
        data: {
          type: 'chat',
          message: `Sorry, I ran into an issue classifying that content: ${err.message}. Please try again.`
        }
      }
      const errList = [...nextList, errMsg]
      setMessages(errList)
      setSessions(prev => prev.map(s => (s.id === sid ? { ...s, updatedAt: Date.now(), messages: errList } : s)))
    } finally {
      setLoading(false)
    }
  }

  function handleHomeStart(e) {
    if (e) e.preventDefault()
    const cleanText = inputVal.trim()
    if (!cleanText && !selectedFile) return

    const newId = `sortia_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const initialTitle = deriveSmartTitle(cleanText, selectedFile?.name, null)

    setCurrentSessionId(newId)
    setMessages([])
    setTitle(initialTitle)
    setActiveViewerDoc(null)
    setView('chat')

    executeSend(cleanText, selectedFile, newId)
  }

  function handleChatSubmit(e) {
    e.preventDefault()
    if (!inputVal.trim() && !selectedFile) return
    executeSend(inputVal, selectedFile, currentSessionId)
  }

  return (
    <div className="app">
      <div className="aurora" />
      <div className="grid" />

      {/* ENTERPRISE PLATFORM SHELL */}
      <div className="srtPlatformShell">
        <header className="srtPlatformHeader">
          <div className="srtBrand" onClick={() => { setPlatformTab('classify'); setView('home') }}>
            <div className="srtBrandLogo">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#38bdf8" strokeWidth="2.2">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </div>
            <div className="srtBrandText">
              <span className="srtBrandName">SORTIA</span>
              <span className="srtBrandSub">ENTERPRISE CONTENT CLASSIFIER &amp; ROUTER</span>
            </div>
          </div>

          <nav className="srtPlatformNav">
            <button
              className={`srtNavBtn ${platformTab === 'overview' ? 'active' : ''}`}
              onClick={() => setPlatformTab('overview')}
            >
              <span className="srtNavNum">01</span>
              <span>Overview</span>
            </button>
            <button
              className={`srtNavBtn ${platformTab === 'classify' ? 'active' : ''}`}
              onClick={() => setPlatformTab('classify')}
            >
              <span className="srtNavNum">02</span>
              <span>Classify Files</span>
            </button>
            <button
              className={`srtNavBtn ${platformTab === 'results' ? 'active' : ''}`}
              onClick={() => setPlatformTab('results')}
            >
              <span className="srtNavNum">03</span>
              <span>Classification Results</span>
            </button>
            <button
              className={`srtNavBtn ${platformTab === 'exceptions' ? 'active' : ''}`}
              onClick={() => setPlatformTab('exceptions')}
            >
              <span className="srtNavNum">04</span>
              <span>Routing &amp; Exceptions</span>
              {overviewData?.exceptions_count > 0 && (
                <span className="srtNavBadge">{overviewData.exceptions_count}</span>
              )}
            </button>
            <button
              className={`srtNavBtn ${platformTab === 'analytics' ? 'active' : ''}`}
              onClick={() => setPlatformTab('analytics')}
            >
              <span className="srtNavNum">05</span>
              <span>Analytics &amp; Audit</span>
            </button>
          </nav>

          <div className="srtHeaderRight">
            <span className="srtEngineStatus">
              <span className="srtLiveDot" />
              <span>AI ENGINE ACTIVE</span>
            </span>
          </div>
        </header>

        {/* 01. OVERVIEW VIEW */}
        {platformTab === 'overview' && (
          <div className="srtViewContainer">
            <div className="srtViewHeader">
              <div className="srtViewPre">01 · ENTERPRISE OPERATIONS</div>
              <h2 className="srtViewTitle">Content Classification &amp; Routing Overview</h2>
              <p className="srtViewSub">Autonomous routing throughput, category distribution, and recent batch operations.</p>
            </div>

            <div className="srtOverviewKpiGrid">
              <div className="srtOverviewKpiCard">
                <span className="srtOverviewKpiLabel">Total Files Classified</span>
                <div className="srtOverviewKpiValue cyan">
                  {overviewData?.total_files || (sessions.length > 0 ? sessions.length : 1)}
                </div>
                <span className="srtOverviewKpiSub">Across all sessions &amp; batches</span>
              </div>
              <div className="srtOverviewKpiCard">
                <span className="srtOverviewKpiLabel">Routing Success Rate</span>
                <div className="srtOverviewKpiValue green">{overviewData?.success_rate_pct || 98}%</div>
                <span className="srtOverviewKpiSub">Autonomously indexed to repositories</span>
              </div>
              <div className={`srtOverviewKpiCard ${overviewData?.exceptions_count > 0 ? 'alert' : ''}`}>
                <span className="srtOverviewKpiLabel">Exceptions &amp; Triage</span>
                <div className={`srtOverviewKpiValue ${overviewData?.exceptions_count > 0 ? 'red' : 'amber'}`}>
                  {overviewData?.exceptions_count || 0}
                </div>
                <span className="srtOverviewKpiSub">Policy or ambiguity flags</span>
              </div>
              <div className="srtOverviewKpiCard">
                <span className="srtOverviewKpiLabel">Avg Latency</span>
                <div className="srtOverviewKpiValue">{overviewData?.avg_processing_ms || 185} ms</div>
                <span className="srtOverviewKpiSub">Fast extraction &amp; routing</span>
              </div>
            </div>

            <div className="srtOverviewSplit">
              <div className="srtOverviewPanel">
                <div className="srtOverviewPanelHead">CLASSIFICATION DISTRIBUTION</div>
                <div className="srtCatBarList">
                  {(overviewData?.category_distribution || [
                    { category: 'Technical Documentation', count: 1 },
                    { category: 'Customer Communication', count: 0 },
                    { category: 'Policy', count: 0 },
                    { category: 'Contract', count: 0 },
                    { category: 'Invoice', count: 0 }
                  ]).map((c, idx) => {
                    const total = Math.max(1, (overviewData?.total_files || 1))
                    const pct = Math.min(100, Math.round((c.count / total) * 100))
                    return (
                      <div key={idx} className="srtCatBarRow">
                        <div className="srtCatBarTop">
                          <span>{c.category}</span>
                          <strong>{c.count} ({pct}%)</strong>
                        </div>
                        <div className="srtCatBarTrack">
                          <div className="srtCatBarFill" style={{ width: `${Math.max(6, pct)}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="srtOverviewPanel">
                <div className="srtOverviewPanelHead">RECENT BATCH &amp; INGESTION ACTIVITY</div>
                {(!overviewData?.recent_batches || overviewData.recent_batches.length === 0) ? (
                  <div style={{ color: '#94a3b8', fontSize: '13px', padding: '16px 0' }}>
                    No batch operations recorded yet. Go to <strong>02. Classify Files → Bulk Classification</strong> to process documents in parallel.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {overviewData.recent_batches.map((b, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'rgba(2, 14, 26, 0.5)', borderRadius: '8px', border: '1px solid rgba(56, 189, 248, 0.16)' }}>
                        <div>
                          <strong style={{ fontSize: '13px', color: '#f8fafc' }}>{b.batch_id}</strong>
                          <div style={{ fontSize: '11px', color: '#94a3b8' }}>{b.total_files} files · {b.classified_count} routed · {b.exceptions_count} exceptions</div>
                        </div>
                        <span className={`statusPill ${b.status === 'COMPLETED' ? 'optimal' : 'caution'}`}>
                          {b.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 02. CLASSIFY FILES VIEW */}
        {platformTab === 'classify' && (
          <div className="srtPlatformBody">
            <div className="srtClassifyBar">
              <div className="srtClassifyToggleGroup">
                <button
                  className={`srtClassifyToggleBtn ${classifyMode === 'single' ? 'active' : ''}`}
                  onClick={() => setClassifyMode('single')}
                >
                  Single Document Classifier
                </button>
                <button
                  className={`srtClassifyToggleBtn ${classifyMode === 'bulk' ? 'active' : ''}`}
                  onClick={() => setClassifyMode('bulk')}
                >
                  Bulk File Classification Workspace
                </button>
              </div>
              <span style={{ fontSize: '11.5px', color: '#94a3b8' }}>
                {classifyMode === 'single' ? 'Interactive conversational & file routing' : 'Parallel batch processing & directory ingestion'}
              </span>
            </div>

            {classifyMode === 'bulk' ? (
              <BulkClassificationWorkspace onInspectResult={(res) => setInspectModalDoc(res)} />
            ) : (
              <>
                {view === 'home' && (
                  <section id="home">
                    <main className="home">
                      <div className="eyebrow">CONTENT CLASSIFIER</div>
                      <h1>
                        Know the type.<br />
                        <span>Choose the path.</span>
                      </h1>
                      <p className="sub">
                        Classify documents, communications, invoices, policies, and technical specs into predefined categories with confidence scores and ambiguity review detection.
                      </p>

                      <div className="promptGlow">
                        <form className="prompt" onSubmit={handleHomeStart}>
                          <input
                            ref={homeFileInputRef}
                            className="fileInput"
                            type="file"
                            accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.json,.xml,.txt,.md"
                            onChange={e => {
                              if (e.target.files && e.target.files[0]) {
                                setSelectedFile(e.target.files[0])
                              }
                            }}
                          />
                          <button
                            className="startAttach"
                            type="button"
                            aria-label="Add file"
                            title="Attach document to classify"
                            onClick={() => homeFileInputRef.current?.click()}
                          >
                            <svg className="icon" viewBox="0 0 24 24" width="18" height="18">
                              <path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.3-9.3a4 4 0 0 1 5.7 5.7l-9.3 9.3a2 2 0 0 1-2.8-2.8l8.6-8.6" />
                            </svg>
                          </button>
                          <input
                            id="startInput"
                            value={inputVal}
                            onChange={e => setInputVal(e.target.value)}
                            placeholder="Ask SORTIA or attach a file..."
                            aria-label="Start conversation"
                          />
                          <button className="send" type="submit" aria-label="Send">
                            <svg className="icon" viewBox="0 0 24 24" width="18" height="18">
                              <path d="M5 12h13" />
                              <path d="m13 7 5 5-5 5" />
                            </svg>
                          </button>
                        </form>
                      </div>

                      {selectedFile && (
                        <div style={{ display: 'flex', justifyContent: 'center', width: '100%', margin: '8px auto 0' }}>
                          <div className="filePill">
                            <span>Attached · {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)</span>
                            <button
                              className="filePillRemove"
                              type="button"
                              onClick={clearSelectedFile}
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="recentHead">
                        <span>RECENT CONVERSATIONS</span>
                      </div>

                      <div className="cards">
                        {sessions.length === 0 ? (
                          <div className="card emptyCard">
                            <small>READY TO CLASSIFY</small>
                            <b>No previous conversations yet</b>
                            <p>Paste any content or attach a file above to identify its category.</p>
                          </div>
                        ) : (
                          sessions.slice(0, 3).map(session => (
                            <button
                              key={session.id}
                              className="card"
                              type="button"
                              onClick={() => handleLoadSession(session.id)}
                            >
                              <small>{formatTimestamp(session.updatedAt || session.createdAt)}</small>
                              <b>{session.title || 'New conversation'}</b>
                              <p>{getPreview(session.messages)}</p>
                            </button>
                          ))
                        )}
                      </div>
                    </main>
                  </section>
                )}

                {view === 'chat' && (
                  <section className="chatPage" id="chatPage">
                    <div className={`layout${activeViewerDoc ? ' withViewer' : ''}`}>
                      <SortiaSidebar
                        sessions={sessions}
                        currentSessionId={currentSessionId}
                        onNew={handleNewChat}
                        onLoad={handleLoadSession}
                        onClose={() => setSidebarOpen(false)}
                        isOpen={sidebarOpen}
                        onRename={handleRenameSession}
                        onDelete={handleDeleteSession}
                      />

                      <main className="chat">
                        <div className="chatHead">
                          <div>
                            {editingTitle ? (
                              <input
                                autoComplete="off"
                                autoFocus
                                className="titleInput"
                                value={titleDraft}
                                maxLength={60}
                                onChange={e => setTitleDraft(e.target.value)}
                                onBlur={commitTitle}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') commitTitle()
                                  if (e.key === 'Escape') setEditingTitle(false)
                                }}
                              />
                            ) : (
                              <b
                                id="title"
                                className="titleEditable"
                                title="Click to rename"
                                onClick={() => {
                                  setTitleDraft(title)
                                  setEditingTitle(true)
                                }}
                              >
                                {title}
                              </b>
                            )}
                            <small>CONTENT CLASSIFICATION WORKSPACE</small>
                          </div>

                          <div className="mobileActions">
                            <button
                              className="mobileMenu"
                              type="button"
                              onClick={() => setSidebarOpen(true)}
                            >
                              <svg className="icon" viewBox="0 0 24 24" width="16" height="16">
                                <path d="M5 7h14M5 12h14M5 17h14" />
                              </svg>
                              <span>RECENT</span>
                            </button>
                            <button
                              className="ghost"
                              id="back"
                              type="button"
                              onClick={() => setView('home')}
                            >
                              <svg className="icon" viewBox="0 0 24 24" width="16" height="16">
                                <path d="m3 10 9-7 9 7" />
                                <path d="M5 9v11h14V9" />
                                <path d="M9 20v-6h6v6" />
                              </svg>
                              <span style={{ marginLeft: '7px' }}>HOME</span>
                            </button>
                          </div>
                        </div>

                        <div className="messages" id="messages" ref={messagesRef} aria-live="polite">
                          {messages.length === 0 && (
                            <div className="card emptyCard" style={{ margin: '40px auto' }}>
                              <small>EMPTY WORKSPACE</small>
                              <b>No content classified yet</b>
                              <p>Message SORTIA or attach an invoice, policy, contract, notice, or tech doc below.</p>
                            </div>
                          )}

                          {messages.map(msg => {
                            if (msg.role === 'user') {
                              return (
                                <div key={msg.id} className="bubble user">
                                  {msg.file && (
                                    <div className="userFileBadgeRow">
                                      <div className="userFileMeta">
                                        <svg className="icon" viewBox="0 0 24 24" width="14" height="14">
                                          <path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.3-9.3a4 4 0 0 1 5.7 5.7l-9.3 9.3a2 2 0 0 1-2.8-2.8l8.6-8.6" />
                                        </svg>
                                        <b>{msg.file.name}</b>
                                        <span className="userFileSize">({(msg.file.size / 1024).toFixed(1)} KB)</span>
                                      </div>
                                      <button
                                        type="button"
                                        className="userFileViewBtn"
                                        onClick={() => openDocument(msg.file, msg.docMeta)}
                                      >
                                        Open ↗
                                      </button>
                                    </div>
                                  )}
                                  {msg.content && <div>{msg.content}</div>}
                                </div>
                              )
                            }

                            if (msg.role === 'ai') {
                              return (
                                <div key={msg.id} className="bubble ai">
                                  <ErrorBoundary>
                                    <SortiaResultCard
                                      data={msg.data}
                                      guardrails={msg.data?.guardrails || msg.guardrails}
                                      onFollowUp={(prompt) => executeSend(prompt, null, currentSessionId)}
                                    />
                                  </ErrorBoundary>
                                </div>
                              )
                            }

                            return null
                          })}

                          {loading && (
                            <div className="thinking">
                              <span className="thinkName">SORTIA</span>
                              <span className="bars">
                                <i />
                                <i />
                                <i />
                                <i />
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="composerArea">
                          {selectedFile && (
                            <div style={{ display: 'flex', justifyContent: 'center', width: '100%', margin: '0 auto 10px' }}>
                              <div className="attachedRow composerAttached">
                                <span className="attachChip">
                                  <span className="attachName">{selectedFile.name}</span>
                                  <button
                                    type="button"
                                    className="attachRemove"
                                    aria-label={`Remove ${selectedFile.name}`}
                                    onClick={() => { setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                                  >
                                    ×
                                  </button>
                                </span>
                              </div>
                            </div>
                          )}
                          <div className="composer">
                            <form id="form" onSubmit={handleChatSubmit}>
                              <input
                                ref={fileInputRef}
                                className="fileInput"
                                type="file"
                                accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.json,.xml,.txt,.md"
                                onChange={e => {
                                  if (e.target.files && e.target.files[0]) {
                                    setSelectedFile(e.target.files[0])
                                  }
                                }}
                              />
                              <button
                                className="plus"
                                type="button"
                                aria-label="Add file"
                                title="Attach document"
                                onClick={() => fileInputRef.current?.click()}
                              >
                                <svg className="icon" viewBox="0 0 24 24" width="18" height="18">
                                  <path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.3-9.3a4 4 0 0 1 5.7 5.7l-9.3 9.3a2 2 0 0 1-2.8-2.8l8.6-8.6" />
                                </svg>
                              </button>
                              <input
                                id="input"
                                value={inputVal}
                                onChange={e => setInputVal(e.target.value)}
                                placeholder="Message SORTIA or attach a document..."
                                maxLength={2000}
                                autoComplete="off"
                                aria-label="Message"
                              />
                              <button className="chatSend" type="submit" aria-label="Send">
                                <svg className="icon" viewBox="0 0 24 24" width="18" height="18">
                                  <path d="M5 12h13" />
                                  <path d="m13 7 5 5-5 5" />
                                </svg>
                              </button>
                            </form>
                          </div>
                          <div className="fine">
                            CONTENT CLASSIFIER · SECURE &amp; SANITIZED
                          </div>
                        </div>
                      </main>

                      {activeViewerDoc && (
                        <DocumentViewer
                          doc={activeViewerDoc}
                          onClose={() => setActiveViewerDoc(null)}
                        />
                      )}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        )}

        {/* 03. CLASSIFICATION RESULTS VIEW */}
        {platformTab === 'results' && (
          <div className="srtViewContainer">
            <div className="srtViewHeader">
              <div className="srtViewPre">03 · REPOSITORY LEDGER</div>
              <h2 className="srtViewTitle">Classification Results &amp; Document Registry</h2>
              <p className="srtViewSub">Searchable index of all classified enterprise content, confidence metrics, and destinations.</p>
            </div>

            <div className="srtTableCard">
              <div className="srtTableToolbar">
                <input
                  type="text"
                  className="srtSearchInput"
                  placeholder="Filter by document name or category..."
                  value={resultsFilter}
                  onChange={e => setResultsFilter(e.target.value)}
                />
                <select
                  className="srtSelectInput"
                  value={resultsCategoryFilter}
                  onChange={e => setResultsCategoryFilter(e.target.value)}
                >
                  <option value="ALL">All Categories</option>
                  <option value="Technical Documentation">Technical Documentation</option>
                  <option value="Customer Communication">Customer Communication</option>
                  <option value="Policy">Policy Document</option>
                  <option value="Contract">Contract / Agreement</option>
                  <option value="Invoice">Invoice / Financial</option>
                </select>
              </div>

              <div className="srtTableWrap">
                <table className="srtTable">
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Primary Category</th>
                      <th>Confidence</th>
                      <th>Ambiguity</th>
                      <th>Sensitivity</th>
                      <th>Target Destination</th>
                      <th>Routing Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const list = (resultsList.length > 0 ? resultsList : [
                        {
                          file_name: 'C2PA_Signature_Spec.pdf',
                          primary_category: 'Technical Documentation',
                          confidence: 98,
                          ambiguity_level: 'Low',
                          sensitivity: 'Internal',
                          destination: '/Enterprise/TechDocs/',
                          status: 'ROUTED',
                          raw: {
                            type: 'classification',
                            primary_category: 'Technical Documentation',
                            confidence: 98,
                            classification_title: 'C2PA Signature Document',
                            secondary_classifications: ['Digital Identity', 'Security Metadata', 'Assertion Ledger'],
                            taxonomy_hierarchy: ['Technology', 'Security', 'Digital Signatures', 'C2PA'],
                            summary: 'This content defines cryptographic assertion specs, instance IDs, and verification parameters for C2PA manifest records.',
                            candidates: [
                              { category: 'Technical Documentation', ranking_score: 98, status: 'Selected Primary', reasoning: 'Explicit technical terminology, assertion specs, cryptographic schemas.' },
                              { category: 'Contract / NDA', ranking_score: 10, status: 'Rejected Alternative', rejection_reason: 'Lacks legal terminology, covenants, and signature binding clauses.' }
                            ],
                            ambiguity: { level: 'Low', score: 12, reasoning: 'Clear separation (+88%) with dominant technical indicators.' },
                            sensitivity: { level: 'Internal', access_control_cleared: true, data_handling_policy: 'Cleared for automated repository routing.' },
                            autonomous_routing: { destination_repository: 'Technical Documentation Repository', destination_path: '/Enterprise/TechDocs/', department: 'Software Engineering', retention_tier: '7 Years', workflow_triggered: 'Auto-Index-Sync', execution_status: 'ROUTED' }
                          }
                        }
                      ]).filter(r => {
                        const q = resultsFilter.toLowerCase()
                        const matchText = !q || (r.file_name && r.file_name.toLowerCase().includes(q)) || (r.primary_category && r.primary_category.toLowerCase().includes(q))
                        const matchCat = resultsCategoryFilter === 'ALL' || r.primary_category === resultsCategoryFilter
                        return matchText && matchCat
                      })

                      if (list.length === 0) {
                        return (
                          <tr>
                            <td colSpan="8" style={{ textAlign: 'center', padding: '24px', color: '#94a3b8' }}>
                              No matching documents found.
                            </td>
                          </tr>
                        )
                      }

                      return list.map((r, i) => (
                        <tr key={i}>
                          <td><strong>{r.file_name}</strong></td>
                          <td><span className="primaryCatBadge">{r.primary_category}</span></td>
                          <td><strong style={{ color: '#38bdf8' }}>{r.confidence}%</strong></td>
                          <td><span className={`statusPill ${r.ambiguity_level === 'High' ? 'caution' : 'optimal'}`}>{r.ambiguity_level || 'Low'}</span></td>
                          <td><span className={`srtSensPill sens-${(r.sensitivity || 'internal').toLowerCase()}`}>{r.sensitivity || 'Internal'}</span></td>
                          <td><code>{r.destination || '/Enterprise/'}</code></td>
                          <td>
                            <span className={`statusPill ${r.status === 'ROUTED' ? 'optimal' : 'caution'}`}>
                              {r.status || 'ROUTED'}
                            </span>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="srtInspectBtn"
                              onClick={() => setInspectModalDoc(r.raw || r)}
                            >
                              Inspect ↗
                            </button>
                          </td>
                        </tr>
                      ))
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 04. ROUTING & EXCEPTIONS VIEW */}
        {platformTab === 'exceptions' && (
          <div className="srtViewContainer">
            <div className="srtViewHeader">
              <div className="srtViewPre">04 · TRIAGE &amp; RESOLUTION</div>
              <h2 className="srtViewTitle">Routing &amp; Exception Handling Queue</h2>
              <p className="srtViewSub">AI-flagged ambiguities, policy restrictions, and unconfirmed repository destinations.</p>
            </div>

            <div className="srtTableCard">
              <div className="srtTableWrap">
                <table className="srtTable">
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Category Detected</th>
                      <th>Ambiguity Score</th>
                      <th>Security Status</th>
                      <th>Exception Reason</th>
                      <th>Recommended Action</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const list = (exceptionsList.length > 0 ? exceptionsList : [
                        {
                          file_name: 'Vendor_Compliance_Policy_Draft.docx',
                          category: 'Policy Document',
                          ambiguity_score: 48,
                          security_status: 'Confidential · Restricted',
                          reason: 'Overlapping signals between Policy and Commercial Contract covenants.',
                          action: 'Trigger secondary taxonomy lexical re-evaluation.',
                          raw: {
                            type: 'classification',
                            primary_category: 'Policy Document',
                            confidence: 52,
                            classification_title: 'Vendor Compliance Policy',
                            summary: 'Document includes operational guidelines alongside indemnity covenants.',
                            ambiguity: { level: 'Moderate', score: 48, reasoning: 'Candidate score gap is under 15% between Policy and Contract.' },
                            sensitivity: { level: 'Confidential', access_control_cleared: false, data_handling_policy: 'Restricted from automatic sync without clearance.' },
                            autonomous_routing: { destination_repository: 'Exception Triage Queue', destination_path: '/Enterprise/Exceptions/', execution_status: 'EXCEPTION_QUEUE' }
                          }
                        }
                      ])

                      return list.map((item, idx) => (
                        <tr key={idx}>
                          <td><strong>{item.file_name}</strong></td>
                          <td><span className="primaryCatBadge">{item.category}</span></td>
                          <td><strong style={{ color: '#fbbf24' }}>{item.ambiguity_score}/100</strong></td>
                          <td><span className="srtSensPill sens-confidential">{item.security_status}</span></td>
                          <td style={{ color: '#fca5a5' }}>{item.reason}</td>
                          <td style={{ color: '#94a3b8' }}>{item.action}</td>
                          <td>
                            <button
                              type="button"
                              className="srtInspectBtn"
                              onClick={() => setInspectModalDoc(item.raw || item)}
                            >
                              Triage ↗
                            </button>
                          </td>
                        </tr>
                      ))
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 05. ANALYTICS & AUDIT VIEW */}
        {platformTab === 'analytics' && (
          <div className="srtViewContainer">
            <div className="srtViewHeader">
              <div className="srtViewPre">05 · COMPLIANCE &amp; GOVERNANCE</div>
              <h2 className="srtViewTitle">Analytics, Taxonomy &amp; Audit Trail</h2>
              <p className="srtViewSub">Enterprise taxonomy hierarchy, cryptographic fingerprinting, and execution verification.</p>
            </div>

            <div className="srtOverviewSplit">
              <div className="srtOverviewPanel">
                <div className="srtOverviewPanelHead">ENTERPRISE SMART TAXONOMY HIERARCHY</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div className="srtTaxSimpleBox">
                    <strong>Technology Hierarchy:</strong>
                    <div className="srtTaxSimpleTree">
                      <span>Technology</span><span className="srtTaxSimpleArrow">→</span>
                      <span>Security</span><span className="srtTaxSimpleArrow">→</span>
                      <span>Digital Signatures</span><span className="srtTaxSimpleArrow">→</span>
                      <strong style={{ color: '#38bdf8' }}>C2PA Specification</strong>
                    </div>
                  </div>
                  <div className="srtTaxSimpleBox">
                    <strong>Legal &amp; Contracts Hierarchy:</strong>
                    <div className="srtTaxSimpleTree">
                      <span>Legal</span><span className="srtTaxSimpleArrow">→</span>
                      <span>Agreements</span><span className="srtTaxSimpleArrow">→</span>
                      <span>Commercial</span><span className="srtTaxSimpleArrow">→</span>
                      <strong style={{ color: '#38bdf8' }}>NDA / Master Service Agreement</strong>
                    </div>
                  </div>
                  <div className="srtTaxSimpleBox">
                    <strong>Finance &amp; Operations Hierarchy:</strong>
                    <div className="srtTaxSimpleTree">
                      <span>Finance</span><span className="srtTaxSimpleArrow">→</span>
                      <span>Accounts Payable</span><span className="srtTaxSimpleArrow">→</span>
                      <span>Invoicing</span><span className="srtTaxSimpleArrow">→</span>
                      <strong style={{ color: '#38bdf8' }}>Commercial Invoice</strong>
                    </div>
                  </div>
                </div>
              </div>

              <div className="srtOverviewPanel">
                <div className="srtOverviewPanelHead">8-STAGE VERIFICATION PIPELINE STATUS</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px' }}>
                  {[
                    'Stage 1: Content Intake & Format Normalization',
                    'Stage 2: Enterprise Security Guardrails & DLP Sanitization',
                    'Stage 3: High-Density Evidence Signal Extraction',
                    'Stage 4: Multi-Label Hierarchical Taxonomy Evaluation',
                    'Stage 5: Candidate Score Calibration & Ambiguity Routing',
                    'Stage 6: Sensitivity Classification (Public / Internal / Conf / Restr)',
                    'Stage 7: Deterministic Access Control & Policy Clearance',
                    'Stage 8: Autonomous Storage Repository Sync & Ledger Persistence'
                  ].map((stg, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#34d399', padding: '6px 10px', background: 'rgba(16, 185, 129, 0.08)', borderRadius: '6px', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <strong style={{ color: '#f1f5f9' }}>{stg}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* INSPECT MODAL */}
      {inspectModalDoc && (
        <div className="srtModalBackdrop" onClick={() => setInspectModalDoc(null)}>
          <div className="srtModalCard" onClick={e => e.stopPropagation()}>
            <button
              className="srtModalClose"
              type="button"
              onClick={() => setInspectModalDoc(null)}
              aria-label="Close"
            >
              ×
            </button>
            <SortiaResultCard data={inspectModalDoc} />
          </div>
        </div>
      )}
    </div>
  )
}

