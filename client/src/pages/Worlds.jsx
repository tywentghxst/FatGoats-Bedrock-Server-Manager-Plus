import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
export const Worlds = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'operator';

  const [worlds, setWorlds] = useState([]);
  const [activeWorld, setActiveWorld] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Modal confirmation state
  const [deleteModalTarget, setDeleteModalTarget] = useState(null);
  const [activeModalTarget, setActiveModalTarget] = useState(null);

  // Import modal state
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [customWorldName, setCustomWorldName] = useState('');
  const [setActiveImmediate, setSetActiveImmediate] = useState(true);
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importError, setImportError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const formatSize = (bytes) => {
    if (!bytes || isNaN(bytes)) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let size = Number(bytes);
    while (size >= 1024 && i < units.length - 1) {
      size /= 1024;
      i++;
    }
    return `${size.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
  };

  const loadWorlds = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.Worlds.list();
      if (Array.isArray(data)) {
        setWorlds(data);
        const active = data.find((w) => w.isActive || w.active);
        if (active) setActiveWorld(active.name);
      } else if (data && typeof data === 'object') {
        const list = data.worlds || [];
        setWorlds(list);
        if (data.activeWorld) {
          setActiveWorld(data.activeWorld);
        } else {
          const active = list.find((w) => w.isActive || w.active);
          if (active) setActiveWorld(active.name);
        }
      }
    } catch (err) {
      console.error('Failed to load worlds:', err);
      setError(err.message || 'Failed to fetch worlds list from server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWorlds();
  }, [loadWorlds]);

  const handleSetActive = async (worldName) => {
    setActionLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await api.Worlds.setActive(worldName);
      setSuccessMsg(`"${worldName}" is now set as the active world. Restart server for changes to take effect.`);
      setActiveModalTarget(null);
      await loadWorlds();
    } catch (err) {
      console.error('Failed to set active world:', err);
      setError(err.message || `Failed to set "${worldName}" as active world.`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteWorld = async (worldName) => {
    if (worldName === activeWorld) {
      setError('Cannot delete the currently active world.');
      setDeleteModalTarget(null);
      return;
    }

    setActionLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await api.Worlds.delete(worldName);
      setSuccessMsg(`World "${worldName}" was successfully deleted.`);
      setDeleteModalTarget(null);
      await loadWorlds();
    } catch (err) {
      console.error('Failed to delete world:', err);
      setError(err.message || `Failed to delete world "${worldName}".`);
    } finally {
      setActionLoading(false);
    }
  };

  // Handle file drop / selection
  const handleFileChosen = (file) => {
    if (!file) return;
    setSelectedFile(file);
    setImportError(null);
    let suggestedName = file.name || 'Imported World';
    suggestedName = suggestedName.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ').trim();
    setCustomWorldName(suggestedName || 'Imported World');
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer?.files && e.dataTransfer.files[0]) {
      handleFileChosen(e.dataTransfer.files[0]);
    }
  };

  const resetImportState = () => {
    setSelectedFile(null);
    setCustomWorldName('');
    setImportProgress(0);
    setImportError(null);
    setIsImporting(false);
    setImportModalOpen(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleImportSubmit = async (e) => {
    e.preventDefault();
    if (!selectedFile) {
      setImportError('Please select a .mcworld or .zip file to import.');
      return;
    }

    setIsImporting(true);
    setImportError(null);
    setImportProgress(30);

    try {
      setImportProgress(60);
      const res = await api.Worlds.import(selectedFile, {
        name: customWorldName.trim(),
        setActive: setActiveImmediate,
        overwrite: overwriteExisting,
      });

      setImportProgress(100);
      setSuccessMsg(res.message || `World "${customWorldName || selectedFile.name}" imported successfully!`);
      resetImportState();
      await loadWorlds();
    } catch (err) {
      console.error('World import failed:', err);
      setImportError(err.message || 'Failed to import world package.');
      setIsImporting(false);
    }
  };

  const activeWorldObj = worlds.find((w) => w.name === activeWorld || w.isActive || w.active);

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header d-flex justify-between items-center flex-wrap gap-3">
        <div>
          <h1 className="page-title">World Management</h1>
          <p className="page-subtitle">Configure, import <code>.mcworld</code> saves, export, and switch active Bedrock worlds</p>
        </div>
        <div className="header-actions d-flex items-center gap-2">
          <button
            type="button"
            className="btn btn-primary d-flex items-center gap-1.5"
            onClick={() => setImportModalOpen(true)}
            disabled={actionLoading || !isAdmin}
            title={!isAdmin ? 'Admin permission required to import worlds' : 'Import a .mcworld or world .zip archive'}
          >
            <span>📥</span>
            <span>Import World (.mcworld)</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary d-flex items-center gap-1.5"
            onClick={loadWorlds}
            disabled={loading || actionLoading}
          >
            <span className={`refresh-icon ${loading ? 'rotating' : ''}`}>↻</span>
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="toast toast-error mb-4" role="alert">
          <span className="toast-icon">⚠️</span>
          <div className="toast-content">{error}</div>
          <button type="button" className="toast-close" onClick={() => setError(null)}>✕</button>
        </div>
      )}
      {successMsg && (
        <div className="toast toast-success mb-4" role="alert">
          <span className="toast-icon">✓</span>
          <div className="toast-content">{successMsg}</div>
          <button type="button" className="toast-close" onClick={() => setSuccessMsg(null)}>✕</button>
        </div>
      )}

      {/* Active World Banner */}
      <div className="card active-world-card mb-6">
        <div className="card-header d-flex justify-between items-center">
          <div className="d-flex items-center gap-2">
            <span className="status-dot running" />
            <h2 className="card-title m-0">Active World</h2>
          </div>
          <div className="d-flex items-center gap-2">
            {activeWorldObj?.gameMode && (
              <span className="badge badge-info">{activeWorldObj.gameMode}</span>
            )}
            <span className="badge badge-success">Currently Loaded</span>
          </div>
        </div>
        <div className="card-body">
          {activeWorldObj ? (
            <div className="active-world-details">
              <div className="world-banner-info d-flex items-center gap-4 flex-wrap">
                <div className="world-icon-large-wrapper" style={{ flexShrink: 0 }}>
                  {activeWorldObj.hasIcon && activeWorldObj.iconUrl ? (
                    <img
                      src={activeWorldObj.iconUrl}
                      alt={activeWorldObj.displayName || activeWorldObj.name}
                      style={{
                        width: 72,
                        height: 72,
                        borderRadius: 12,
                        objectFit: 'cover',
                        border: '2px solid rgba(16, 185, 129, 0.4)',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                      }}
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 72,
                        height: 72,
                        borderRadius: 12,
                        background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(5, 150, 105, 0.3) 100%)',
                        border: '2px solid rgba(16, 185, 129, 0.4)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '2.2rem',
                      }}
                    >
                      🌍
                    </div>
                  )}
                </div>

                <div className="world-meta" style={{ flex: 1, minWidth: 220 }}>
                  <div className="d-flex items-center gap-2 flex-wrap">
                    <h3 className="active-world-name m-0" style={{ fontSize: '1.4rem', fontWeight: 700 }}>
                      {activeWorldObj.displayName || activeWorldObj.name}
                    </h3>
                    {activeWorldObj.displayName && activeWorldObj.displayName !== activeWorldObj.name && (
                      <span className="font-mono text-xs text-muted">
                        ({activeWorldObj.name})
                      </span>
                    )}
                  </div>

                  <div className="world-stat-badges d-flex flex-wrap gap-2 mt-2">
                    <span className="stat-pill">
                      <strong>Folder Size:</strong> {formatSize(activeWorldObj.size || activeWorldObj.sizeBytes)}
                    </span>
                    {activeWorldObj.lastModified && (
                      <span className="stat-pill">
                        <strong>Last Played:</strong> {new Date(activeWorldObj.lastModified).toLocaleString()}
                      </span>
                    )}
                    {activeWorldObj.hasLevelDat && (
                      <span className="stat-pill text-emerald">
                        ✓ level.dat OK
                      </span>
                    )}
                  </div>
                </div>

                <div className="active-world-banner-actions d-flex items-center gap-2">
                  <a
                    href={api.exportWorldUrl ? api.exportWorldUrl(activeWorldObj.name) : api.Worlds.getExportUrl(activeWorldObj.name)}
                    className="btn btn-secondary btn-sm d-flex items-center gap-1.5"
                    download={`${activeWorldObj.name}.mcworld`}
                    title="Export and download as .mcworld"
                  >
                    <span>⬇️</span>
                    <span>Export .mcworld</span>
                  </a>
                </div>
              </div>
              <p className="text-secondary mt-3 m-0 text-sm">
                This world is configured as <code>level-name</code> in <code>server.properties</code>. All connecting players spawn into this world.
              </p>
            </div>
          ) : (
            <div className="empty-state py-4">
              <p className="m-0 text-muted">
                {loading ? 'Checking active world configuration...' : `Active world is set to "${activeWorld || 'None'}", but folder was not found on disk.`}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* World List Section */}
      <div className="section-header d-flex justify-between items-center mb-4">
        <h2 className="section-title m-0">All Saved Worlds ({worlds.length})</h2>
      </div>

      {loading && worlds.length === 0 ? (
        <div className="loading-container py-12 text-center">
          <div className="spinner" />
          <p className="text-muted mt-3">Loading worlds from server...</p>
        </div>
      ) : worlds.length === 0 ? (
        <div className="card empty-state-card py-12 text-center">
          <div className="empty-state-icon" style={{ fontSize: '3rem' }}>🗺️</div>
          <h3>No Worlds Found</h3>
          <p className="text-muted mb-4">You can import an existing <code>.mcworld</code> or start the server to generate a fresh vanilla world.</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setImportModalOpen(true)}
            disabled={!isAdmin}
          >
            📥 Import Your First World (.mcworld)
          </button>
        </div>
      ) : (
        <div className="worlds-grid">
          {worlds.map((world) => {
            const isActive = world.name === activeWorld || world.isActive || world.active;
            const exportUrl = api.exportWorldUrl ? api.exportWorldUrl(world.name) : api.Worlds.getExportUrl(world.name);

            return (
              <div key={world.name} className={`card world-card ${isActive ? 'is-active-border' : ''}`}>
                <div className="card-header d-flex justify-between items-center gap-2">
                  <div className="d-flex items-center gap-2.5 overflow-hidden">
                    {world.hasIcon && world.iconUrl ? (
                      <img
                        src={world.iconUrl}
                        alt={world.displayName || world.name}
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 8,
                          objectFit: 'cover',
                          flexShrink: 0,
                          border: '1px solid rgba(255,255,255,0.1)',
                        }}
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    ) : (
                      <span className="world-icon" style={{ fontSize: '1.6rem', flexShrink: 0 }}>🗺️</span>
                    )}
                    <div className="overflow-hidden">
                      <h3 className="world-title text-truncate m-0" title={world.displayName || world.name} style={{ fontSize: '1rem', fontWeight: 600 }}>
                        {world.displayName || world.name}
                      </h3>
                      {world.displayName && world.displayName !== world.name && (
                        <span className="font-mono text-2xs text-muted text-truncate d-block">
                          {world.name}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="d-flex items-center gap-1.5 flex-shrink-0">
                    {world.gameMode && (
                      <span className="badge badge-secondary text-2xs">{world.gameMode}</span>
                    )}
                    {isActive ? (
                      <span className="badge badge-success">Active</span>
                    ) : (
                      <span className="badge badge-secondary">Inactive</span>
                    )}
                  </div>
                </div>

                <div className="card-body">
                  <div className="world-properties-list">
                    <div className="property-row d-flex justify-between py-1 text-sm border-bottom-subtle">
                      <span className="text-muted">Folder Size:</span>
                      <span className="font-mono text-white">{formatSize(world.size || world.sizeBytes)}</span>
                    </div>
                    {world.lastModified && (
                      <div className="property-row d-flex justify-between py-1 text-sm border-bottom-subtle">
                        <span className="text-muted">Last Saved:</span>
                        <span className="text-white">{new Date(world.lastModified).toLocaleDateString()}</span>
                      </div>
                    )}
                    <div className="property-row d-flex justify-between py-1 text-sm">
                      <span className="text-muted">Level Status:</span>
                      <span className={world.hasLevelDat !== false ? 'text-emerald' : 'text-warning'}>
                        {world.hasLevelDat !== false ? '✓ level.dat ready' : '⚠️ Pending creation'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="card-footer d-flex justify-between items-center gap-2 flex-wrap">
                  <div className="d-flex items-center gap-2">
                    {isActive ? (
                      <button type="button" className="btn btn-secondary btn-sm" disabled>
                        ✓ Current
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => setActiveModalTarget(world.name)}
                        disabled={actionLoading || !isAdmin}
                        title={!isAdmin ? 'Admin permission required' : 'Make this world active'}
                      >
                        Set as Active
                      </button>
                    )}

                    <a
                      href={exportUrl}
                      className="btn btn-secondary btn-sm d-flex items-center gap-1"
                      download={`${world.name}.mcworld`}
                      title="Export and download as .mcworld"
                    >
                      <span>⬇️</span>
                      <span>Export</span>
                    </a>
                  </div>

                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => setDeleteModalTarget(world.name)}
                    disabled={isActive || actionLoading || !isAdmin}
                    title={
                      isActive
                        ? 'Cannot delete the active world'
                        : !isAdmin
                        ? 'Admin permission required'
                        : 'Delete this world folder'
                    }
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Import World Modal */}
      {importModalOpen && (
        <div className="modal-overlay" onClick={() => !isImporting && resetImportState()}>
          <div
            className="modal"
            style={{ maxWidth: 540, width: '100%' }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header d-flex justify-between items-center">
              <div className="d-flex items-center gap-2">
                <span style={{ fontSize: '1.3rem' }}>📥</span>
                <h3 className="modal-title m-0">Import Minecraft World (.mcworld)</h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={resetImportState}
                disabled={isImporting}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleImportSubmit}>
              <div className="modal-body p-4">
                {importError && (
                  <div className="alert alert-danger mb-3 p-2.5 text-xs">
                    ⚠️ {importError}
                  </div>
                )}

                {/* Dropzone with native overlay for 100% reliable tap/click across mobile & desktop */}
                <div
                  className={`upload-zone-modern ${isDragging ? 'dragging' : ''} ${isImporting ? 'uploading' : ''} mb-4 position-relative`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  style={{
                    border: '2px dashed rgba(16, 185, 129, 0.4)',
                    borderRadius: 12,
                    padding: '1.75rem 1rem',
                    textAlign: 'center',
                    cursor: isImporting ? 'wait' : 'pointer',
                    background: isDragging ? 'rgba(16, 185, 129, 0.15)' : 'rgba(15, 23, 42, 0.6)',
                    transition: 'all 0.2s ease',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept=".mcworld,.zip,application/zip,application/x-zip-compressed,application/octet-stream,*/*"
                    onChange={(e) => handleFileChosen(e.target.files?.[0])}
                    disabled={isImporting}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      opacity: 0,
                      cursor: isImporting ? 'wait' : 'pointer',
                      zIndex: 10,
                    }}
                    title="Tap or click to browse world file (.mcworld or .zip)"
                  />

                  {selectedFile ? (
                    <div className="file-selected-box" style={{ pointerEvents: 'none', position: 'relative', zIndex: 1 }}>
                      <div className="mb-2" style={{ fontSize: '2.4rem' }}>🗺️</div>
                      <div className="font-semibold text-white mb-1" style={{ wordBreak: 'break-all' }}>
                        {selectedFile.name}
                      </div>
                      <div className="text-muted text-xs font-mono mb-2">
                        {formatSize(selectedFile.size)}
                      </div>
                      <span className="badge badge-primary text-2xs">
                        Tap or drop another file to change
                      </span>
                    </div>
                  ) : (
                    <div className="file-prompt-box" style={{ pointerEvents: 'none', position: 'relative', zIndex: 1 }}>
                      <div className="mb-2" style={{ fontSize: '2.4rem' }}>📦</div>
                      <div className="font-semibold text-white mb-1">
                        {isDragging ? 'Drop .mcworld file here' : 'Tap or click to browse .mcworld save'}
                      </div>
                      <div className="text-muted text-xs mb-3">
                        Supports standard <code>.mcworld</code> export packages and world <code>.zip</code> archives.
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        style={{ pointerEvents: 'none' }}
                      >
                        Browse World Files
                      </button>
                    </div>
                  )}
                </div>

                {/* World Configuration Inputs */}
                {selectedFile && (
                  <div className="world-import-options bg-darker p-3 rounded mb-3 border">
                    <div className="form-group mb-3">
                      <label className="form-label text-xs font-semibold text-sub mb-1 d-block">
                        World Display Name
                      </label>
                      <input
                        type="text"
                        className="input-modern w-full text-sm"
                        placeholder="e.g. Castle World Survival"
                        value={customWorldName}
                        onChange={(e) => setCustomWorldName(e.target.value)}
                        disabled={isImporting}
                      />
                      <small className="text-muted text-2xs mt-1 d-block">
                        This name will appear in Bedrock Server Manager and <code>server.properties</code>.
                      </small>
                    </div>

                    <div className="form-check mb-2 d-flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="setActiveCheck"
                        className="form-check-input"
                        checked={setActiveImmediate}
                        onChange={(e) => setSetActiveImmediate(e.target.checked)}
                        disabled={isImporting}
                      />
                      <label htmlFor="setActiveCheck" className="form-check-label text-xs text-white cursor-pointer m-0">
                        <strong>Set as Active World immediately</strong> (updates <code>level-name</code> in server.properties)
                      </label>
                    </div>

                    <div className="form-check d-flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="overwriteCheck"
                        className="form-check-input"
                        checked={overwriteExisting}
                        onChange={(e) => setOverwriteExisting(e.target.checked)}
                        disabled={isImporting}
                      />
                      <label htmlFor="overwriteCheck" className="form-check-label text-xs text-sub cursor-pointer m-0">
                        Overwrite existing world if a folder with this name already exists
                      </label>
                    </div>
                  </div>
                )}

                {/* Upload Progress */}
                {isImporting && (
                  <div className="upload-progress-box mb-3">
                    <div className="d-flex justify-between text-xs text-sub mb-1.5 font-mono">
                      <span>Extracting & registering world files...</span>
                      <span>{importProgress}%</span>
                    </div>
                    <div className="metric-progress-bg" style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                      <div
                        className="metric-progress-fill"
                        style={{
                          height: '100%',
                          width: `${importProgress}%`,
                          background: 'linear-gradient(90deg, #10b981 0%, #3b82f6 100%)',
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="modal-footer d-flex justify-between items-center p-3 border-top">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={resetImportState}
                  disabled={isImporting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary d-flex items-center gap-1.5"
                  disabled={!selectedFile || isImporting}
                >
                  {isImporting ? (
                    <>
                      <span className="spinner-sm" />
                      <span>Importing World...</span>
                    </>
                  ) : (
                    <>
                      <span>📥</span>
                      <span>Import & Install World</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModalTarget && (
        <div className="modal-overlay" onClick={() => setDeleteModalTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3 className="modal-title">Confirm World Deletion</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setDeleteModalTarget(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p>
                Are you sure you want to permanently delete world <strong>"{deleteModalTarget}"</strong>?
              </p>
              <div className="alert alert-danger mt-3">
                ⚠️ This operation cannot be undone. All chunk saves, player data, and structures in this world folder will be deleted.
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDeleteModalTarget(null)}
                disabled={actionLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => handleDeleteWorld(deleteModalTarget)}
                disabled={actionLoading}
              >
                {actionLoading ? 'Deleting...' : 'Delete World'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Set Active Confirmation Modal */}
      {activeModalTarget && (
        <div className="modal-overlay" onClick={() => setActiveModalTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3 className="modal-title">Switch Active World</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setActiveModalTarget(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p>
                Switch active level to <strong>"{activeModalTarget}"</strong>?
              </p>
              <p className="text-secondary mt-2">
                This updates <code>level-name={activeModalTarget}</code> in your <code>server.properties</code> configuration.
              </p>
              <div className="alert alert-warning mt-3">
                💡 If the dedicated server is currently online, you must restart it for Minecraft to load the new world.
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setActiveModalTarget(null)}
                disabled={actionLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleSetActive(activeModalTarget)}
                disabled={actionLoading}
              >
                {actionLoading ? 'Updating...' : 'Confirm & Switch'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Worlds;
