import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';

export const Backups = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [backups, setBackups] = useState([]);
  const [worlds, setWorlds] = useState([]);
  const [selectedWorld, setSelectedWorld] = useState('');
  const [loading, setLoading] = useState(true);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [deletingBackup, setDeletingBackup] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Auto-backup configuration state
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(false);
  const [frequencyHours, setFrequencyHours] = useState(6);
  const [lastBackupTime, setLastBackupTime] = useState(null);
  const [nextBackupEstimate, setNextBackupEstimate] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);

  // Modals
  const [restoreModalFile, setRestoreModalFile] = useState(null);
  const [deleteModalFile, setDeleteModalFile] = useState(null);

  const formatSize = (bytes) => {
    if (!bytes || isNaN(bytes)) return '0 B';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(2)} GB`;
    }
    return `${mb.toFixed(2)} MB`;
  };

  const formatDate = (dateVal) => {
    if (!dateVal) return 'Unknown';
    try {
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return String(dateVal);
      return d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return String(dateVal);
    }
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [backupsData, worldsData, settingsData] = await Promise.allSettled([
        api.Backups.list(),
        api.Worlds.list(),
        api.Backups.getSettings(),
      ]);

      if (backupsData.status === 'fulfilled') {
        const rawList = Array.isArray(backupsData.value)
          ? backupsData.value
          : backupsData.value?.backups || [];
        
        // Sort descending by created/date/timestamp/mtime
        const sorted = [...rawList].sort((a, b) => {
          const dateA = new Date(a.created || a.date || a.timestamp || a.mtime || 0).getTime();
          const dateB = new Date(b.created || b.date || b.timestamp || b.mtime || 0).getTime();
          return dateB - dateA;
        });
        setBackups(sorted);
      } else {
        console.error('Failed to load backups:', backupsData.reason);
        setError('Failed to fetch backups list.');
      }

      if (worldsData.status === 'fulfilled') {
        const wVal = worldsData.value;
        const wList = Array.isArray(wVal) ? wVal : wVal?.worlds || [];
        setWorlds(wList);
        if (wList.length > 0 && !selectedWorld) {
          const active = wList.find((w) => w.isActive || w.active);
          setSelectedWorld(active ? active.name : wList[0].name);
        }
      }

      if (settingsData.status === 'fulfilled' && settingsData.value) {
        const s = settingsData.value;
        setAutoBackupEnabled(Boolean(s.autoBackup));
        if (s.frequencyHours) setFrequencyHours(Number(s.frequencyHours));
        setLastBackupTime(s.lastBackupTime);
        setNextBackupEstimate(s.nextBackupEstimate);
      }
    } catch (err) {
      console.error('Failed to load backup data:', err);
      setError(err.message || 'Error communicating with server.');
    } finally {
      setLoading(false);
    }
  }, [selectedWorld]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateBackup = async (e) => {
    e.preventDefault();
    if (!selectedWorld) {
      setError('Please select a world to back up.');
      return;
    }

    setCreatingBackup(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const result = await api.Backups.create(selectedWorld);
      setSuccessMsg(`Backup created successfully for world "${selectedWorld}"!`);
      await loadData();
    } catch (err) {
      console.error('Failed to create backup:', err);
      setError(err.message || `Failed to create backup for world "${selectedWorld}".`);
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleRestoreBackup = async (filename) => {
    setRestoringBackup(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await api.Backups.restore(filename);
      setSuccessMsg(`Backup "${filename}" was restored successfully. Server world has been updated.`);
      setRestoreModalFile(null);
      await loadData();
    } catch (err) {
      console.error('Failed to restore backup:', err);
      setError(err.message || `Failed to restore backup "${filename}".`);
    } finally {
      setRestoringBackup(false);
    }
  };

  const handleDeleteBackup = async (filename) => {
    setDeletingBackup(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await api.Backups.delete(filename);
      setSuccessMsg(`Backup "${filename}" deleted successfully.`);
      setDeleteModalFile(null);
      await loadData();
    } catch (err) {
      console.error('Failed to delete backup:', err);
      setError(err.message || `Failed to delete backup "${filename}".`);
    } finally {
      setDeletingBackup(false);
    }
  };

  const handleToggleAutoBackup = async (newVal) => {
    if (!isAdmin) return;
    setSavingSettings(true);
    setAutoBackupEnabled(newVal);
    try {
      const res = await api.Backups.updateSettings(newVal, frequencyHours);
      setAutoBackupEnabled(Boolean(res.autoBackup));
      setNextBackupEstimate(res.nextBackupEstimate);
      setSuccessMsg(`Auto-backup ${newVal ? 'Enabled' : 'Disabled'}! Frequency: every ${frequencyHours} hour(s).`);
    } catch (err) {
      setAutoBackupEnabled(!newVal);
      setError(err.message || 'Failed to update auto-backup setting');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleChangeFrequency = async (newHours) => {
    if (!isAdmin) return;
    const hoursNum = parseFloat(newHours);
    setFrequencyHours(hoursNum);
    setSavingSettings(true);
    try {
      const res = await api.Backups.updateSettings(autoBackupEnabled, hoursNum);
      setNextBackupEstimate(res.nextBackupEstimate);
      setSuccessMsg(`Backup frequency updated: backups will run every ${hoursNum} hours.`);
    } catch (err) {
      setError(err.message || 'Failed to update backup frequency');
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Backups & Snapshots</h1>
          <p className="page-subtitle">Create archives of your worlds and restore when needed</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={loadData}
            disabled={loading || creatingBackup || restoringBackup || deletingBackup}
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

      {/* Operation progress banners */}
      {creatingBackup && (
        <div className="alert alert-info d-flex items-center gap-3 mb-4">
          <div className="spinner-sm" />
          <span>Creating archive for world <strong>"{selectedWorld}"</strong>... This may take a few moments depending on world size.</span>
        </div>
      )}
      {restoringBackup && (
        <div className="alert alert-warning d-flex items-center gap-3 mb-4">
          <div className="spinner-sm" />
          <span>Restoring backup archive... Dedicated server operations are currently locked during restoration.</span>
        </div>
      )}

      {/* Auto-Backup Settings Card */}
      <div className="card mb-6 auto-backup-card">
        <div className="card-header d-flex justify-between items-center">
          <div className="d-flex items-center gap-2">
            <span className="card-header-icon">🔄</span>
            <h2 className="card-title m-0">Automated World Backups & Scheduler</h2>
          </div>
          <span className={`badge ${autoBackupEnabled ? 'badge-success' : 'badge-secondary'}`}>
            {autoBackupEnabled ? '● ACTIVE SCHEDULER' : 'DISABLED'}
          </span>
        </div>
        <div className="card-body">
          <div className="auto-backup-controls-grid">
            <div className="auto-backup-toggle-group">
              <label className="switch-toggle-label">
                <input
                  type="checkbox"
                  checked={autoBackupEnabled}
                  onChange={(e) => handleToggleAutoBackup(e.target.checked)}
                  disabled={savingSettings || !isAdmin}
                />
                <span className="toggle-slider"></span>
              </label>
              <div className="toggle-desc">
                <strong>Enable Automatic World Backups</strong>
                <p className="text-muted text-sm m-0">
                  Automatically create compressed snapshots of server worlds in the background at regular intervals.
                </p>
              </div>
            </div>

            <div className="auto-backup-frequency-group">
              <label htmlFor="freqSelect" className="form-label">
                Backup Frequency:
              </label>
              <select
                id="freqSelect"
                className="form-select"
                value={frequencyHours}
                onChange={(e) => handleChangeFrequency(e.target.value)}
                disabled={savingSettings || !isAdmin}
              >
                <option value="1">Every 1 Hour (High Activity)</option>
                <option value="2">Every 2 Hours</option>
                <option value="4">Every 4 Hours</option>
                <option value="6">Every 6 Hours (Recommended)</option>
                <option value="12">Every 12 Hours (Twice Daily)</option>
                <option value="24">Every 24 Hours (Daily Snapshot)</option>
              </select>
            </div>
          </div>

          <div className="auto-backup-meta-row mt-4 pt-3 border-top d-flex gap-4 flex-wrap text-sm">
            <div>
              <span className="text-muted">Last Automatic Backup: </span>
              <strong>{lastBackupTime ? formatDate(lastBackupTime) : 'None recorded yet'}</strong>
            </div>
            {autoBackupEnabled && (
              <div>
                <span className="text-muted">Estimated Next Run: </span>
                <strong className="text-success">{nextBackupEstimate ? formatDate(nextBackupEstimate) : 'Calculating...'}</strong>
              </div>
            )}
            <div>
              <span className="text-muted">Safe Flush: </span>
              <span className="badge badge-info">Chunk Flush (save hold/resume)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Top Section - Create Backup Panel */}
      <div className="card mb-6">
        <div className="card-header">
          <h2 className="card-title m-0">Create New Backup</h2>
        </div>
        <div className="card-body">
          <form onSubmit={handleCreateBackup} className="backup-creation-form d-flex items-center gap-3 flex-wrap">
            <div className="form-group m-0 flex-1 min-w-250">
              <label htmlFor="worldSelect" className="form-label">
                Target World to Archive:
              </label>
              <select
                id="worldSelect"
                className="form-select"
                value={selectedWorld}
                onChange={(e) => setSelectedWorld(e.target.value)}
                disabled={creatingBackup || restoringBackup || worlds.length === 0}
              >
                {worlds.length === 0 ? (
                  <option value="">No worlds available</option>
                ) : (
                  worlds.map((w) => (
                    <option key={w.name} value={w.name}>
                      {w.name} {w.isActive || w.active ? '(Active)' : ''}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div className="d-flex items-end pt-5">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={creatingBackup || restoringBackup || !selectedWorld || !isAdmin}
                title={!isAdmin ? 'Admin permission required' : 'Create zip snapshot of selected world'}
              >
                {creatingBackup ? (
                  <>
                    <span className="spinner-sm mr-2" /> Archiving World...
                  </>
                ) : (
                  '📦 Create Backup'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Backups List Table */}
      <div className="card">
        <div className="card-header d-flex justify-between items-center">
          <h2 className="card-title m-0">Stored Backups ({backups.length})</h2>
          <span className="text-muted text-sm">Sorted newest to oldest</span>
        </div>
        <div className="card-body p-0">
          {loading && backups.length === 0 ? (
            <div className="loading-container py-12">
              <div className="spinner" />
              <p className="text-muted mt-3">Fetching backup archives...</p>
            </div>
          ) : backups.length === 0 ? (
            <div className="empty-state py-12 text-center">
              <div className="empty-state-icon">📦</div>
              <h3>No Backups Created Yet</h3>
              <p className="text-muted">Use the selector above to create your first world snapshot.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-striped w-full">
                <thead>
                  <tr>
                    <th>Filename</th>
                    <th>World</th>
                    <th>Archive Size</th>
                    <th>Date Created</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((b) => {
                    const filename = b.filename || b.name || b.file;
                    const sizeBytes = b.size || b.sizeBytes || 0;
                    const dateCreated = b.created || b.date || b.timestamp || b.mtime;
                    const targetWorld = b.worldName || b.world || filename?.split('_')[0] || '-';

                    return (
                      <tr key={filename}>
                        <td className="font-mono text-primary font-medium">
                          <span className="backup-file-icon mr-2">🗜️</span>
                          {filename}
                        </td>
                        <td>
                          <span className="badge badge-secondary">{targetWorld}</span>
                        </td>
                        <td className="font-mono">{formatSize(sizeBytes)}</td>
                        <td className="text-secondary">{formatDate(dateCreated)}</td>
                        <td className="text-right">
                          <div className="d-flex justify-end gap-2">
                            <button
                              type="button"
                              className="btn btn-warning btn-sm"
                              onClick={() => setRestoreModalFile(b)}
                              disabled={restoringBackup || creatingBackup || deletingBackup || !isAdmin}
                              title={!isAdmin ? 'Admin permission required' : 'Restore this backup'}
                            >
                              Restore
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              onClick={() => setDeleteModalFile(b)}
                              disabled={restoringBackup || creatingBackup || deletingBackup || !isAdmin}
                              title={!isAdmin ? 'Admin permission required' : 'Delete this archive'}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Restore Confirmation Modal */}
      {restoreModalFile && (
        <div className="modal-overlay" onClick={() => !restoringBackup && setRestoreModalFile(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3 className="modal-title">Confirm Backup Restoration</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => !restoringBackup && setRestoreModalFile(null)}
                disabled={restoringBackup}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p>
                Are you sure you want to restore from:
              </p>
              <div className="p-3 bg-darker rounded font-mono my-2 text-primary">
                {restoreModalFile.filename || restoreModalFile.name}
              </div>
              <div className="alert alert-danger mt-3">
                ⚠️ <strong>Warning:</strong> This will stop the server and overwrite the current world data with the snapshot contents. Any unsaved progress since this backup was taken will be permanently overwritten.
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setRestoreModalFile(null)}
                disabled={restoringBackup}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-warning"
                onClick={() => handleRestoreBackup(restoreModalFile.filename || restoreModalFile.name)}
                disabled={restoringBackup}
              >
                {restoringBackup ? 'Restoring Archive...' : 'Proceed with Restore'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModalFile && (
        <div className="modal-overlay" onClick={() => !deletingBackup && setDeleteModalFile(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3 className="modal-title">Delete Backup Archive</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => !deletingBackup && setDeleteModalFile(null)}
                disabled={deletingBackup}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p>
                Are you sure you want to delete backup archive:
              </p>
              <div className="p-3 bg-darker rounded font-mono my-2 text-danger">
                {deleteModalFile.filename || deleteModalFile.name}
              </div>
              <p className="text-secondary mt-2">
                This will free up {formatSize(deleteModalFile.size || deleteModalFile.sizeBytes)} of disk space.
              </p>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDeleteModalFile(null)}
                disabled={deletingBackup}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => handleDeleteBackup(deleteModalFile.filename || deleteModalFile.name)}
                disabled={deletingBackup}
              >
                {deletingBackup ? 'Deleting...' : 'Delete Archive'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Backups;
