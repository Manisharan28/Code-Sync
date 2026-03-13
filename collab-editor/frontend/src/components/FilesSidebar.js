/*
  FilesSidebar — File list with delete option (#9) and extension-stripped display (#7).
  - Display shows basename without extension
  - Full filename (with extension) is stored/used internally
  - Delete button with confirmation
  - Language icons via devicon SVGs (#5)
*/
import { useState } from 'react';

/* Language icon URLs from devicon CDN */
const DEVICON_BASE = 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons';
const LANG_ICONS = {
  py:   `${DEVICON_BASE}/python/python-original.svg`,
  js:   `${DEVICON_BASE}/javascript/javascript-original.svg`,
  jsx:  `${DEVICON_BASE}/react/react-original.svg`,
  ts:   `${DEVICON_BASE}/typescript/typescript-original.svg`,
  tsx:  `${DEVICON_BASE}/react/react-original.svg`,
  cpp:  `${DEVICON_BASE}/cplusplus/cplusplus-original.svg`,
  java: `${DEVICON_BASE}/java/java-original.svg`,
  html: `${DEVICON_BASE}/html5/html5-original.svg`,
  css:  `${DEVICON_BASE}/css3/css3-original.svg`,
  json: `${DEVICON_BASE}/json/json-original.svg`,
};

function getIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return LANG_ICONS[ext] || null;
}

/* Strip extension for display (#7) */
function displayName(filename) {
  const idx = filename.lastIndexOf('.');
  return idx > 0 ? filename.substring(0, idx) : filename;
}

function FilesSidebar({ files, activeFile, onSwitch, onCreate, onDelete }) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');

  const handleCreate = (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    if (files.includes(name)) { setError('File already exists'); return; }
    if (!name.includes('.')) { setError('Include a file extension (e.g. .py, .js)'); return; }
    onCreate(name);
    setNewName('');
    setCreating(false);
    setError('');
  };

  const handleDelete = (filename, e) => {
    e.stopPropagation();
    if (files.length <= 1) {
      alert('Cannot delete the last file.');
      return;
    }
    if (window.confirm(`Are you sure you want to delete "${filename}"? This cannot be undone.`)) {
      onDelete(filename);
    }
  };

  return (
    <div className="files-sidebar">
      <div className="files-header">
        <span className="files-title">Files</span>
        <button className="icon-btn" title="New file" onClick={() => { setCreating(true); setError(''); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      <div className="files-list">
        {files.map(f => {
          const iconUrl = getIcon(f);
          return (
            <button
              key={f}
              className={`file-item ${f === activeFile ? 'active' : ''}`}
              onClick={() => onSwitch(f)}
              title={f}
            >
              {iconUrl ? (
                <img src={iconUrl} alt="" className="file-lang-icon" width="16" height="16" />
              ) : (
                <span className="file-icon">📄</span>
              )}
              <span className="file-name">{displayName(f)}</span>
              {/* Delete button */}
              <span
                className="file-delete-btn"
                title={`Delete ${f}`}
                onClick={(e) => handleDelete(f, e)}
              >
                ✕
              </span>
            </button>
          );
        })}
      </div>

      {creating && (
        <form className="new-file-form" onSubmit={handleCreate}>
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="filename.py"
            className="new-file-input"
            autoFocus
          />
          {error && <span className="new-file-error">{error}</span>}
          <div className="new-file-actions">
            <button type="submit" className="btn btn-primary btn-sm">Create</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCreating(false); setError(''); }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

export default FilesSidebar;
