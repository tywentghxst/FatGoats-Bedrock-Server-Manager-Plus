import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { safeCopyToClipboard } from '../utils/clipboard';

export const Worlds = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [worlds, setWorlds] = useState([]);
  const [activeWorld, setActiveWorld] = useState('');
  const [worldsDir, setWorldsDir] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [copiedDir, setCopiedDir] = useState(false);

  // Modal confirmation state
  const [deleteModalTarget, setDeleteModalTarget] = useState(null);
  const [activeModalTarget, setActiveModalTarget] = useState(null);

  // Add World Folder Modal
  const [showAddWorldModal, setShowAddWorldModal] = useState(false);
  const [newWorldName, setNewWorldName] = useState('');
  const [setNewWorldActive, setSetNewWorldActive] = useState(true);
  const [newWorldGameMode, setNewWorldGameMode] = useState('survival');
  const [newWorldSeed, setNewWorldSeed] = useState('');

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
      const [data, folderData] = await Promise.allSettled([
        api.Worlds.list(),
        api.Folders.get(),
      ]);

      if (folderData.status === 'fulfilled' && folderData.value?.worldsDir) {
        setWorldsDir(folderData.value.worldsDir);
      }

      if (data.status === 'fulfilled') {
        const val = data.value;
        if (Array.isArray(val)) {
          setWorlds(val);
          const active = val.find((w) => w.isActive || w.active);
          if (active) setActiveWorld(active.name);
        } else if (val && typeof val === 'object') {
          const list = val.worlds || [];
          setWorlds(list);
          if (val.activeWorld) {
            setActiveWorld(val.activeWorld);
          } else {
            const active = list.find((w) => w.isActive || w.active);
            if (active) setActiveWorld(active.name);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load worlds:', err);
      setError(err.message || 'Failed to fetch worlds list from server.');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleCreateWorldFolder = async (e) => {
    e.preventDefault();
    if (!newWorldName.trim()) return;
    setActionLoading(true);
    setError(null);
    try {
      const res = await api.Folders.createWorld(
        newWorldName.trim(),
        setNewWorldActive,
        newWorldGameMode,
        newWorldSeed.trim()
      );
      setSuccessMsg(res.message || `World folder "${newWorldName}" created!`);
      setShowAddWorldModal(false);
      setNewWorldName('');
      setNewWorldSeed('');
      await loadWorlds();
    } catch (err) {
      setError(err.message || 'Failed to create world folder.');
    } finally {
      setActionLoading(false);
    }
  };

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

  const activeWorldObj = worlds.find((w) => w.name === activeWorld || w.isActive || w.active);
  const inactiveWorlds = worlds.filter((w) => w.name !== activeWorld && !w.isActive && !w.active);

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">World Management</h1>
          <p className="page-subtitle">Configure, inspect, and switch active Bedrock worlds</p>
        </div>
        <div className="header-actions d-flex gap-2">
          {isAdmin && (
            <>
              <button
                type="button"
                className="btn btn-success"
                onClick={() => setShowAddWorldModal(true)}
              >
                ➕ Add World Folder
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => navigate('/folders')}
                title="Manage server directories and settings"
              >
                📁 Folders &amp; Settings
              </button>
            </>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={loadWorlds}
            disabled={loading || actionLoading}
          >
            <span className={`refresh-icon ${loading ? 'rotating' : ''}`}>↻</span> Refresh
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="toast toast-error" role="alert">
          <span className="toast-icon">⚠️</span>
          <div className="toast-content">{error}</div>
          <button type="button" className="toast-close" onClick={() => setError(null)}>✕</button>
        </div>
      )}
      {successMsg && (
        <div className="toast toast-success" role="alert">
          <span className="toast-icon">✓</span>
          <div className="toast-content">{successMsg}</div>
          <button type="button" className="toast-close" onClick={() => setSuccessMsg(null)}>✕</button>
        </div>
      )}

      {/* Worlds Directory Path Banner */}
      {worldsDir && (
        <div className="card folder-path-banner-card mb-5">
          <div className="card-body p-3 d-flex items-center justify-between flex-wrap gap-2">
            <div className="d-flex items-center gap-2">
              <span className="folder-icon text-lg">📁</span>
              <div>
                <span className="text-2xs text-sub font-bold uppercase tracking-wider d-block">Worlds Directory Path</span>
                <code className="text-xs text-emerald font-mono">{worldsDir}</code>
              </div>
            </div>
            <div className="d-flex items-center gap-1.5">
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => {
                  safeCopyToClipboard(worldsDir);
                  setCopiedDir(true);
                  setTimeout(() => setCopiedDir(false), 2000);
                }}
              >
                {copiedDir ? '✓ Copied' : '📋 Copy'}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={async () => {
                  try {
                    await api.Folders.openExplorer('worlds');
                  } catch (_) {}
                }}
              >
                📂 Explorer
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => navigate('/folders')}
              >
                ⚙️ Change Folder
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active World Banner */}
      <div className="card active-world-card mb-6">
        <div className="card-header d-flex justify-between items-center">
          <div className="d-flex items-center gap-2">
            <span className="status-dot running" />
            <h2 className="card-title m-0">Active World</h2>
          </div>
          <span className="badge badge-success">Current Level</span>
        </div>
        <div className="card-body">
          {activeWorldObj ? (
            <div className="active-world-details">
              <div className="world-banner-info">
                <div className="world-icon-large">🌍</div>
                <div className="world-meta">
                  <h3 className="active-world-name">{activeWorldObj.name}</h3>
                  <div className="world-stat-badges">
                    <span className="stat-pill">
                      <strong>Size:</strong> {formatSize(activeWorldObj.size || activeWorldObj.sizeBytes)}
                    </span>
                    {activeWorldObj.lastModified && (
                      <span className="stat-pill">
                        <strong>Modified:</strong> {new Date(activeWorldObj.lastModified).toLocaleString()}
                      </span>
                    )}
                    {activeWorldObj.gameMode && (
                      <span className="stat-pill">
                        <strong>Game Mode:</strong> {activeWorldObj.gameMode}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <p className="text-secondary mt-3 m-0">
                This world is defined as <code>level-name</code> in <code>server.properties</code>. All incoming player sessions connect directly to this dimension.
              </p>
            </div>
          ) : (
            <div className="empty-state py-4">
              <p className="m-0 text-muted">
                {loading ? 'Checking active world configuration...' : `Active world is set to "${activeWorld || 'None'}", but folder was not found.`}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* World List Section */}
      <div className="section-header mb-4">
        <h2 className="section-title">All Saved Worlds ({worlds.length})</h2>
      </div>

      {loading && worlds.length === 0 ? (
        <div className="loading-container py-12">
          <div className="spinner" />
          <p className="text-muted mt-3">Loading worlds from server...</p>
        </div>
      ) : worlds.length === 0 ? (
        <div className="card empty-state-card py-12 text-center">
          <div className="empty-state-icon">🗺️</div>
          <h3>No Worlds Found</h3>
          <p className="text-muted">Start the server once to automatically generate a default Bedrock world.</p>
        </div>
      ) : (
        <div className="worlds-grid">
          {worlds.map((world) => {
            const isActive = world.name === activeWorld || world.isActive || world.active;
            return (
              <div key={world.name} className={`card world-card ${isActive ? 'is-active-border' : ''}`}>
                <div className="card-header d-flex justify-between items-center">
                  <div className="d-flex items-center gap-2">
                    <span className="world-icon">🗺️</span>
                    <h3 className="world-title" title={world.name}>{world.name}</h3>
                  </div>
                  {isActive ? (
                    <span className="badge badge-success">Active</span>
                  ) : (
                    <span className="badge badge-secondary">Inactive</span>
                  )}
                </div>

                <div className="card-body">
                  <div className="world-properties-list">
                    <div className="property-row">
                      <span className="text-muted">Folder Size:</span>
                      <span className="font-mono">{formatSize(world.size || world.sizeBytes)}</span>
                    </div>
                    {world.lastModified && (
                      <div className="property-row">
                        <span className="text-muted">Last Played:</span>
                        <span>{new Date(world.lastModified).toLocaleDateString()}</span>
                      </div>
                    )}
                    {world.playerCount !== undefined && (
                      <div className="property-row">
                        <span className="text-muted">Known Players:</span>
                        <span>{world.playerCount}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="card-footer d-flex justify-between items-center gap-2">
                  {isActive ? (
                    <button type="button" className="btn btn-secondary btn-sm" disabled>
                      Currently Active
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

      {/* Add New World Folder Modal */}
      {showAddWorldModal && (
        <div className="modal-overlay" onClick={() => setShowAddWorldModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3 className="modal-title">➕ Add New World Folder</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowAddWorldModal(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreateWorldFolder}>
              <div className="modal-body">
                <p className="text-secondary text-xs mb-3">
                  Creates a new world folder in <code>{worldsDir || 'worlds/'}</code> and optionally switches active level in <code>server.properties</code>.
                </p>

                <div className="form-group mb-3">
                  <label className="form-label text-xs">World Folder Name:</label>
                  <input
                    type="text"
                    className="input-modern"
                    value={newWorldName}
                    onChange={(e) => setNewWorldName(e.target.value)}
                    placeholder="e.g. MyNewWorld, Survival2026, AdventureZone"
                    required
                    autoFocus
                  />
                </div>

                <div className="form-group mb-3">
                  <label className="form-label text-xs">Game Mode:</label>
                  <select
                    className="input-modern"
                    value={newWorldGameMode}
                    onChange={(e) => setNewWorldGameMode(e.target.value)}
                  >
                    <option value="survival">Survival</option>
                    <option value="creative">Creative</option>
                    <option value="adventure">Adventure</option>
                  </select>
                </div>

                <div className="form-group mb-3">
                  <label className="form-label text-xs">Generation Seed (Optional):</label>
                  <input
                    type="text"
                    className="input-modern"
                    value={newWorldSeed}
                    onChange={(e) => setNewWorldSeed(e.target.value)}
                    placeholder="Leave blank for random world seed"
                  />
                </div>

                <label className="checkbox-label text-xs d-flex items-center gap-2 mt-2">
                  <input
                    type="checkbox"
                    checked={setNewWorldActive}
                    onChange={(e) => setSetNewWorldActive(e.target.checked)}
                  />
                  <span>Immediately set as active world (<code>level-name</code> in server.properties)</span>
                </label>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAddWorldModal(false)}
                  disabled={actionLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-success"
                  disabled={actionLoading || !newWorldName.trim()}
                >
                  {actionLoading ? 'Creating...' : '➕ Create World Folder'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Worlds;
