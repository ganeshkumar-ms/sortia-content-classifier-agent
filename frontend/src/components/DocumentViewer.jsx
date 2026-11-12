import { useState } from 'react'

export default function DocumentViewer({ doc, onClose }) {
  const [activeTab, setActiveTab] = useState('preview')

  if (!doc) return null

  const isImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(doc.name || '')
  const hasViewUrl = Boolean(doc.viewUrl)

  return (
    <aside className="docViewer">
      <div className="docViewerHead">
        <div className="docViewerTitleWrap">
          <svg className="icon" viewBox="0 0 24 24" width="15" height="15">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span className="docViewerTitle" title={doc.name}>{doc.name}</span>
        </div>
        <div className="docViewerActions">
          {doc.downloadUrl && (
            <a
              href={doc.downloadUrl}
              download={doc.name}
              className="docViewerBtn"
              title="Download file"
            >
              <svg className="icon" viewBox="0 0 24 24" width="14" height="14">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </a>
          )}
          <button
            onClick={onClose}
            className="docViewerCloseBtn"
            title="Close viewer"
            type="button"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="docViewerTabs">
        <button
          className={`docTab${activeTab === 'preview' ? ' active' : ''}`}
          onClick={() => setActiveTab('preview')}
          type="button"
        >
          Viewer
        </button>
        <button
          className={`docTab${activeTab === 'meta' ? ' active' : ''}`}
          onClick={() => setActiveTab('meta')}
          type="button"
        >
          Extracted Text
        </button>
      </div>

      <div className="docViewerBody">
        {activeTab === 'preview' ? (
          hasViewUrl ? (
            isImage ? (
              <div className="docViewerImage">
                <img src={doc.viewUrl} alt={doc.name} />
              </div>
            ) : (
              <iframe
                src={doc.viewUrl}
                title={doc.name}
                className="docViewerIframe"
              />
            )
          ) : (
            <div className="docViewerFallback">
              <pre className="docViewerText">{doc.preview || 'Preview not available.'}</pre>
            </div>
          )
        ) : (
          <div className="docViewerMeta">
            <div className="metaRow">
              <span className="metaKey">Filename</span>
              <span className="metaVal">{doc.name}</span>
            </div>
            {doc.rawMeta?.size && (
              <div className="metaRow">
                <span className="metaKey">Size</span>
                <span className="metaVal">{(doc.rawMeta.size / 1024).toFixed(1)} KB</span>
              </div>
            )}
            {doc.rawMeta?.words > 0 && (
              <div className="metaRow">
                <span className="metaKey">Words</span>
                <span className="metaVal">{doc.rawMeta.words} words</span>
              </div>
            )}
            {doc.rawMeta?.content_type && (
              <div className="metaRow">
                <span className="metaKey">Type</span>
                <span className="metaVal">{doc.rawMeta.content_type}</span>
              </div>
            )}
            <div className="metaSection">
              <div className="metaSectionTitle">Extracted Content</div>
              <pre className="docViewerText">{doc.preview || 'No extracted text preview available.'}</pre>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}

