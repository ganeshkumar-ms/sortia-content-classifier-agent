import React, { useEffect, useRef, useState } from 'react'
import SortiaSidebar from './components/SortiaSidebar.jsx'
import SortiaResultCard from './components/SortiaResultCard.jsx'
import DocumentViewer from './components/DocumentViewer.jsx'
import { classifyContent } from './services/api.js'

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
      const result = await classifyContent({
        file: fileObj || null,
        text: cleanText,
        conversationHistory: apiHistory
      })

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

      {view === 'home' && (
        <section id="home">
          <header>
            <div className="word">SORTIA</div>
            <button
              className="enter"
              id="enter"
              type="button"
              onClick={() => {
                handleNewChat()
                setView('chat')
              }}
            >
              ENTER WORKSPACE ↗
            </button>
          </header>

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
                {selectedFile && (
                  <div className="filePill" style={{ maxWidth: '820px' }}>
                    <span>Attached · {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)</span>
                    <button
                      className="filePillRemove"
                      type="button"
                      onClick={clearSelectedFile}
                    >
                      ✕
                    </button>
                  </div>
                )}
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
    </div>
  )
}

