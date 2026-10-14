import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';

export const Versions = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // Version states
  const [currentVersion, setCurrentVersion] = useState(null);
  const [availableVersions, setAvailableVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [installingUrl, setInstallingUrl] = useState(null);

  // Upload custom zip states
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDraggingZip, setIsDraggingZip] = useState(false);
  const zipInputRef = useRef(null);

  // Status and log display
  const [installLogs, setInstallLogs] = useState([]);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Modal confirmation
  const [confirmInstallTarget, setConfirmInstallTarget] = useState(null); // { version, url }

  const addLog = (msg) => {
    const timestamp = new Date().toLocaleTimeString();
    setInstallLogs((prev) => [...prev, `[${timestamp}] ${msg}`]);
  };

  const loadCurrentVersion = useCallback(async () => {
    try {
      const data = await api.Versions.getCurrent();
      const versionStr = typeof data === 'string' ? data : data?.version || data?.current || 'Unknown';
      setCurrentVersion(versionStr);
    } catch (err) {
      console.error('Failed to get current version:', err);
      setCurrentVersion('Undetected');
    }
  }, []);

  const checkForUpdates = useCallback(async () => {
    setCheckingUpdates(true);
    setError(null);
    try {
      const data = await api.Versions.getAvailable();
      const list = Array.isArray(data) ? data : data?.versions || [];
      setAvailableVersions(list);
      setSuccessMsg(`Found ${list.length} available Bedrock Dedicated Server builds.`);
    } catch (err) {
      console.error('Failed to fetch available versions:', err);
      setError(err.message || 'Failed to check official Mojang Bedrock download channels.');
    } finally {
      setCheckingUpdates(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await loadCurrentVersion();
      try {
        const data = await api.Versions.getAvailable();
        const list = Array.isArray(data) ? data : data?.versions || [];
        setAvailableVersions(list);
      } catch (err) {
        console.warn('Initial available versions check failed:', err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [loadCurrentVersion]);

  const handleInstall = async (target) => {
    setInstallingUrl(target.url);
    setError(null);
    setSuccessMsg(null);
    setConfirmInstallTarget(null);
    addLog(`Initiating installation of Bedrock build ${target.version || target.url}...`);
    addLog('Stopping server if running to safely swap server binaries...');

    try {
      addLog('Preserving existing worlds, server.properties, permissions.json, and allowlist.json...');
      const res = await api.Versions.install(target.url);
      addLog('Extraction and binary replacement complete.');
      if (res?.message) addLog(res.message);
      setSuccessMsg(`Successfully upgraded to version ${target.version || 'selected build'}!`);
      await loadCurrentVersion();
    } catch (err) {
      console.error('Version installation failed:', err);
      addLog(`ERROR: ${err.message || 'Installation encountered a critical error.'}`);
      setError(err.message || 'Failed to complete server installation.');
    } finally {
      setInstallingUrl(null);
    }
  };

  // Upload handler for custom zip
  const handleZipDrop = (e) => {
    e.preventDefault();
    setIsDraggingZip(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) {
      handleZipFileSelected(files[0]);
    }
  };

  const handleZipFileSelected = async (file) => {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setError('Please select a valid .zip archive containing Bedrock Dedicated Server binaries.');
      return;
    }

    setIsUploading(true);
    setUploadProgress(10);
    setError(null);
    setSuccessMsg(null);
    addLog(`Uploading custom server zip: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)...`);

    try {
      setUploadProgress(50);
      const res = await api.Versions.upload(file);
      setUploadProgress(100);
      addLog('Custom server package uploaded and unpacked successfully.');
      if (res?.message) addLog(res.message);
      setSuccessMsg(`Custom server binary "${file.name}" uploaded and installed!`);
      await loadCurrentVersion();
    } catch (err) {
      console.error('Failed to upload custom version:', err);
      addLog(`ERROR: Upload failed - ${err.message}`);
      setError(err.message || 'Custom server package upload failed.');
    } finally {
      setIsUploading(false);
      if (zipInputRef.current) zipInputRef.current.value = '';
    }
  };

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Server Version & Upgrades</h1>
          <p className="page-subtitle">Inspect the current Bedrock Dedicated Server build, upgrade binaries, or upload custom versions</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={checkForUpdates}
            disabled={checkingUpdates || !!installingUrl || isUploading}
          >
            <span className={`refresh-icon ${checkingUpdates ? 'rotating' : ''}`}>↻</span> Check for Updates
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

      {/* Preservation Notice Alert */}
      <div className="alert alert-info d-flex items-center gap-3 mb-6">
        <span className="text-xl">🛡️</span>
        <div>
          <strong>Safe Upgrades:</strong> Installing a new version will preserve your worlds, <code>server.properties</code>, <code>permissions.json</code>, and active addons. Only the core server binaries and base assets are updated.
        </div>
      </div>

      {/* Current Version Banner */}
      <div className="card mb-6">
        <div className="card-header d-flex justify-between items-center">
          <h2 className="card-title m-0">Installed Bedrock Version</h2>
          <span className="badge badge-success font-mono text-sm px-3 py-1">
            Active Binary
          </span>
        </div>
        <div className="card-body">
          <div className="d-flex items-center justify-between flex-wrap gap-4">
            <div className="d-flex items-center gap-4">
              <div className="server-cube-icon">🧊</div>
              <div>
                <div className="text-xs uppercase font-semibold text-muted">Minecraft Bedrock Dedicated Server</div>
                <div className="current-version-display font-mono">
                  {loading ? 'Detecting version...' : currentVersion || '1.21.x'}
                </div>
              </div>
            </div>
            <div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={checkForUpdates}
                disabled={checkingUpdates || !!installingUrl}
              >
                {checkingUpdates ? 'Querying Mojang API...' : '🔍 Check for Updates'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Available Versions List */}
      <div className="card mb-6">
        <div className="card-header d-flex justify-between items-center">
          <div>
            <h2 className="card-title m-0">Official Available Builds</h2>
            <p className="text-muted text-xs mt-1 mb-0">Official release and preview builds fetched directly from Mojang</p>
          </div>
          <span className="badge badge-secondary">{availableVersions.length} Builds</span>
        </div>
        <div className="card-body p-0">
          {checkingUpdates && availableVersions.length === 0 ? (
            <div className="loading-container py-8">
              <div className="spinner" />
              <p className="text-muted mt-2">Checking Mojang release channels...</p>
            </div>
          ) : availableVersions.length === 0 ? (
            <div className="empty-state py-8 text-center">
              <p className="text-muted">No builds cached. Click "Check for Updates" to fetch available versions.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-striped w-full">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Channel / Type</th>
                    <th>Release Date</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {availableVersions.map((v, idx) => {
                    const verName = v.version || v.name || `Build #${idx + 1}`;
                    const isCurrent = currentVersion && (verName === currentVersion || currentVersion.includes(verName));
                    const isInstallingThis = installingUrl === v.url;
                    const channel = v.channel || (verName.toLowerCase().includes('preview') ? 'Preview' : 'Release');

                    return (
                      <tr key={v.url || verName}>
                        <td className="font-mono font-semibold text-primary">
                          {verName}
                          {isCurrent && <span className="badge badge-success ml-2">Current</span>}
                        </td>
                        <td>
                          <span className={`badge ${channel === 'Release' ? 'badge-primary' : 'badge-warning'}`}>
                            {channel}
                          </span>
                        </td>
                        <td className="text-secondary text-sm">
                          {v.date || v.releaseDate || 'Recent'}
                        </td>
                        <td className="text-right">
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={isCurrent || !!installingUrl || isUploading || !isAdmin}
                            onClick={() => setConfirmInstallTarget(v)}
                            title={
                              isCurrent
                                ? 'Already on this version'
                                : !isAdmin
                                ? 'Admin permission required'
                                : 'Download and install this server build'
                            }
                          >
                            {isInstallingThis ? (
                              <>
                                <span className="spinner-sm mr-1" /> Installing...
                              </>
                            ) : (
                              'Install Build'
                            )}
                          </button>
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

      {/* Custom Upload Section */}
      <div className="card mb-6">
        <div className="card-header">
          <h2 className="card-title m-0">Custom Server Package Upload</h2>
        </div>
        <div className="card-body">
          <div
            className={`upload-zone ${isDraggingZip ? 'dragging' : ''} ${isUploading ? 'uploading' : ''}`}
            onDragEnter={(e) => { e.preventDefault(); setIsDraggingZip(true); }}
            onDragLeave={(e) => { e.preventDefault(); setIsDraggingZip(false); }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleZipDrop}
            onClick={() => !isUploading && zipInputRef.current?.click()}
          >
            <input
              type="file"
              ref={zipInputRef}
              className="d-none"
              accept=".zip"
              onChange={(e) => e.target.files?.[0] && handleZipFileSelected(e.target.files[0])}
              disabled={isUploading || !isAdmin}
            />

            <div className="upload-zone-content text-center py-6">
              <div className="upload-icon mb-2">📦</div>
              <h3 className="upload-title mb-1">
                {isDraggingZip ? 'Drop Bedrock Server ZIP here' : 'Upload Custom Server ZIP'}
              </h3>
              <p className="upload-subtitle text-muted mb-4">
                Upload a customized Bedrock Dedicated Server distribution or specific version zip.
              </p>

              <button
                type="button"
                className="btn btn-secondary"
                disabled={isUploading || !isAdmin}
                onClick={(e) => {
                  e.stopPropagation();
                  zipInputRef.current?.click();
                }}
              >
                Choose Local ZIP
              </button>

              {!isAdmin && (
                <p className="text-warning text-xs mt-3">
                  * Administrator role required to install server binaries.
                </p>
              )}
            </div>

            {isUploading && (
              <div className="upload-progress-container px-6 pb-6">
                <div className="d-flex justify-between text-sm mb-2">
                  <span>Extracting and verifying package...</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="progress-bar-bg">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Installation Log Output */}
      {installLogs.length > 0 && (
        <div className="card mb-6">
          <div className="card-header d-flex justify-between items-center">
            <h3 className="card-title m-0">Installation Activity Log</h3>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setInstallLogs([])}
            >
              Clear Log
            </button>
          </div>
          <div className="card-body p-0">
            <div className="console-output max-h-300">
              {installLogs.map((log, index) => (
                <div key={index} className="console-line">
                  {log}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Install Confirmation Modal */}
      {confirmInstallTarget && (
        <div className="modal-overlay" onClick={() => !installingUrl && setConfirmInstallTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3 className="modal-title">Confirm Version Installation</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => !installingUrl && setConfirmInstallTarget(null)}
                disabled={!!installingUrl}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p>
                Install Bedrock Dedicated Server <strong>"{confirmInstallTarget.version || 'Selected Build'}"</strong>?
              </p>
              <div className="alert alert-info mt-3">
                🛡️ <strong>Safety Guarantee:</strong> Your world folders, configuration files (<code>server.properties</code>), and player whitelist will remain intact.
              </div>
              <p className="text-secondary text-sm mt-2">
                If the server is currently online, it will be safely stopped before swapping binaries.
              </p>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setConfirmInstallTarget(null)}
                disabled={!!installingUrl}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleInstall(confirmInstallTarget)}
                disabled={!!installingUrl}
              >
                {installingUrl ? 'Installing...' : 'Confirm & Install'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Versions;
