import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';

export const Worlds = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [worlds, setWorlds] = useState([]);
  const [activeWorld, setActiveWorld] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Modal confirmation state
  const [deleteModalTarget, setDeleteModalTarget] = useState(null);
  const [activeModalTarget, setActiveModalTarget] = useState(null);

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
      // data might be { worlds: [...], activeWorld: 'Bedrock level' } or an array
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
        <div className="header-actions">
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
    </div>
  );
};

export default Worlds;
