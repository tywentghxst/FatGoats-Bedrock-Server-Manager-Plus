import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { safeCopyToClipboard } from '../utils/clipboard';

export const ServerFolders = ({ embedded = false }) => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // Folder and inspection data
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState(null); // { type: 'success' | 'error', text: '' }
  const [copiedKey, setCopiedKey] = useState(null);

  // Settings Changer Form State
  const [propsForm, setPropsForm] = useState({});
  const [savingSettings, setSavingSettings] = useState(false);
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'settings_changer' | 'explorer'

  // Modals state
  const [showBdsModal, setShowBdsModal] = useState(false);
  const [newBdsPath, setNewBdsPath] = useState('');
  const [createBdsIfMissing, setCreateBdsIfMissing] = useState(true);
  const [pathValidation, setPathValidation] = useState(null);
  const [validating, setValidating] = useState(false);

  const [showWorldsModal, setShowWorldsModal] = useState(false);
  const [newWorldsPath, setNewWorldsPath] = useState('');
  const [createWorldsIfMissing, setCreateWorldsIfMissing] = useState(true);

  const [showAddWorldModal, setShowAddWorldModal] = useState(false);
  const [newWorldName, setNewWorldName] = useState('');
  const [setNewWorldActive, setSetNewWorldActive] = useState(true);
  const [newWorldGameMode, setNewWorldGameMode] = useState('survival');
  const [newWorldSeed, setNewWorldSeed] = useState('');

  const [showAddFolderModal, setShowAddFolderModal] = useState(false);
  const [newSubfolderName, setNewSubfolderName] = useState('');
  const [newSubfolderParent, setNewSubfolderParent] = useState('bds');

  const showToast = (type, text) => {
    setToast({ type, text });
    setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 6000);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.Folders.get();
      setData(res);
      if (res.properties) {
        setPropsForm({ ...res.properties });
      }
    } catch (err) {
      showToast('error', err.message || 'Failed to load server folders and properties.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCopy = (text, key) => {
    safeCopyToClipboard(text);
    setCopiedKey(key);
    showToast('success', `Copied to clipboard: ${text}`);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const handleOpenExplorer = async (target) => {
    try {
      const res = await api.Folders.openExplorer(target);
      showToast('success', res.message || 'Opened folder in file explorer.');
    } catch (err) {
      showToast('error', err.message || 'Failed to open file explorer.');
    }
  };

  const handleValidatePath = async (folderPath) => {
    if (!folderPath || !folderPath.trim()) return;
    setValidating(true);
    setPathValidation(null);
    try {
      const res = await api.Folders.validatePath(folderPath.trim());
      setPathValidation(res);
    } catch (err) {
      showToast('error', err.message || 'Validation failed.');
    } finally {
      setValidating(false);
    }
  };

  const handleSaveBdsDir = async (e) => {
    e.preventDefault();
    if (!newBdsPath.trim()) return;
    setActionLoading(true);
    try {
      const res = await api.Folders.setBdsDir(newBdsPath.trim(), createBdsIfMissing);
      showToast('success', res.message || 'Server folder updated successfully.');
      setShowBdsModal(false);
      setNewBdsPath('');
      setPathValidation(null);
      await loadData();
    } catch (err) {
      showToast('error', err.message || 'Failed to update server folder.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetBdsDir = async () => {
    if (!window.confirm('Reset server folder to default installation path?')) return;
    setActionLoading(true);
    try {
      const res = await api.Folders.resetBdsDir();
      showToast('success', res.message || 'Server folder reset to default.');
      await loadData();
    } catch (err) {
      showToast('error', err.message || 'Failed to reset server folder.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveWorldsDir = async (e) => {
    e.preventDefault();
    if (!newWorldsPath.trim()) return;
    setActionLoading(true);
    try {
      const res = await api.Folders.setWorldsDir(newWorldsPath.trim(), createWorldsIfMissing);
      showToast('success', res.message || 'Worlds folder updated successfully.');
      setShowWorldsModal(false);
      setNewWorldsPath('');
      await loadData();
    } catch (err) {
      showToast('error', err.message || 'Failed to update worlds folder.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetWorldsDir = async () => {
    if (!window.confirm('Reset worlds folder to default ($BDS_DIR/worlds)?')) return;
    setActionLoading(true);
    try {
      const res = await api.Folders.resetWorldsDir();
      showToast('success', res.message || 'Worlds folder reset to default.');
      await loadData();
    } catch (err) {
      showToast('error', err.message || 'Failed to reset worlds folder.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateWorld = async (e) => {
    e.preventDefault();
    if (!newWorldName.trim()) return;
    setActionLoading(true);
    try {
      const res = await api.Folders.createWorld(
        newWorldName.trim(),
        setNewWorldActive,
        newWorldGameMode,
        newWorldSeed.trim()
      );
      showToast('success', res.message || `World folder "${newWorldName}" created!`);
      setShowAddWorldModal(false);
      setNewWorldName('');
      setNewWorldSeed('');
      await loadData();
    } catch (err) {
      showToast('error', err.message || 'Failed to create world folder.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateSubfolder = async (e) => {
    e.preventDefault();
    if (!newSubfolderName.trim()) return;
    setActionLoading(true);
    try {
      const res = await api.Folders.createFolder(newSubfolderParent, newSubfolderName.trim());
      showToast('success', res.message || `Folder "${newSubfolderName}" created!`);
      setShowAddFolderModal(false);
      setNewSubfolderName('');
      await loadData();
    } catch (err) {
      showToast('error', err.message || 'Failed to create folder.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleQuickSettingChange = (key, value) => {
    setPropsForm((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const applyPreset = (presetName) => {
    if (presetName === 'survival') {
      setPropsForm((prev) => ({
        ...prev,
        gamemode: 'survival',
        difficulty: 'normal',
        'max-players': 15,
        'server-port': 19132,
        'view-distance': 16,
        'tick-distance': 4,
        'allow-cheats': 'false',
        'online-mode': 'true',
      }));
      showToast('success', 'Applied "Survival Normal" preset. Click "Save & Apply Settings" to write.');
    } else if (presetName === 'creative') {
      setPropsForm((prev) => ({
        ...prev,
        gamemode: 'creative',
        difficulty: 'peaceful',
        'max-players': 20,
        'allow-cheats': 'true',
        'online-mode': 'true',
      }));
      showToast('success', 'Applied "Creative Sandbox" preset.');
    } else if (presetName === 'high_perf') {
      setPropsForm((prev) => ({
        ...prev,
        'server-ram-limit': 8192,
        'view-distance': 12,
        'tick-distance': 4,
        'max-threads': 4,
        'compression-threshold': 256,
      }));
      showToast('success', 'Applied "High Performance (8GB)" preset.');
    } else if (presetName === 'crossplay') {
      setPropsForm((prev) => ({
        ...prev,
        transport: 'nethernet',
        'server-port': 19132,
        'server-portv6': 19133,
        'max-players': 35,
        'online-mode': 'true',
      }));
      showToast('success', 'Applied "NetherNet Crossplay" preset.');
    }
  };

  const handleSaveSettings = async (e) => {
    if (e) e.preventDefault();
    setSavingSettings(true);
    try {
      const res = await api.Folders.updateSettings(propsForm);
      showToast('success', res.message || 'server.properties updated successfully!');
      if (res.properties) {
        setPropsForm({ ...res.properties });
      }
      await loadData();
    } catch (err) {
      showToast('error', err.message || 'Failed to save server.properties.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleRestartServer = async () => {
    if (!window.confirm('Restart Bedrock server now to apply all folder and properties changes?')) return;
    try {
      await api.restart();
      showToast('success', 'Server restart signal sent.');
      setTimeout(loadData, 2500);
    } catch (err) {
      showToast('error', err.message || 'Failed to restart server.');
    }
  };

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

  if (loading && !data) {
    return (
      <div className={embedded ? 'p-4' : 'page-container'}>
        <div className="loading-container py-12 text-center">
          <div className="spinner mb-3" />
          <p className="text-sub">Loading server directory, worlds folder &amp; properties...</p>
        </div>
      </div>
    );
  }

  const bdsDir = data?.bdsDir || 'Unknown';
  const worldsDir = data?.worldsDir || 'Unknown';
  const isRunning = data?.serverState === 'running';
  const worlds = data?.worlds || [];
  const bdsContents = data?.bdsContents || [];

  return (
    <div className={embedded ? 'server-folders-embedded' : 'page-container server-folders-page'}>
      {/* Toast Notification */}
      {toast && (
        <div className={`toast toast-${toast.type} mb-4`} role="alert">
          <span className="toast-icon">{toast.type === 'success' ? '✓' : '⚠️'}</span>
          <div className="toast-content">{toast.text}</div>
          <button type="button" className="toast-close" onClick={() => setToast(null)}>✕</button>
        </div>
      )}

      {/* Top Header */}
      {!embedded && (
        <div className="page-header d-flex justify-between items-center mb-6">
          <div>
            <h1 className="page-title d-flex items-center gap-2">
              <span>📁</span> Server Folders &amp; Settings Changer
            </h1>
            <p className="page-subtitle">
              Inspect, change, and add folders for <code>server.properties</code> and <code>worlds</code>, plus quick settings controls
            </p>
          </div>
          <div className="header-actions d-flex gap-2">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={loadData}
              disabled={loading || actionLoading}
            >
              <span className={`refresh-icon ${loading ? 'rotating' : ''}`}>↻</span> Refresh
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => handleOpenExplorer('bds')}
              title="Open Server Directory in Windows Explorer"
            >
              📂 Open in Explorer
            </button>
          </div>
        </div>
      )}

      {/* Server Restart Alert if changes were made while server is running */}
      {isRunning && (
        <div className="alert-toast alert-warning mb-5 d-flex items-center justify-between flex-wrap gap-2">
          <div className="d-flex items-center gap-2">
            <span className="toast-icon">⚡</span>
            <div>
              <strong className="text-sm">Server is Live:</strong>
              <span className="text-xs text-sub ml-1.5">
                Changes to <code>server.properties</code> or changing the active world require a server restart to take effect in-game.
              </span>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-warning btn-xs"
            onClick={handleRestartServer}
          >
            🔄 Restart Server Now
          </button>
        </div>
      )}

      {/* Navigation Sub-Tabs */}
      <div className="tab-navigation-bar mb-6">
        <button
          type="button"
          className={`tab-btn-pill ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <span className="tab-icon">🗂️</span> Folders &amp; Paths Hub
        </button>
        <button
          type="button"
          className={`tab-btn-pill ${activeTab === 'settings_changer' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings_changer')}
        >
          <span className="tab-icon">⚙️</span> Settings Changer
        </button>
        <button
          type="button"
          className={`tab-btn-pill ${activeTab === 'explorer' ? 'active' : ''}`}
          onClick={() => setActiveTab('explorer')}
        >
          <span className="tab-icon">📂</span> Files &amp; Subfolders ({bdsContents.length})
        </button>
      </div>

      {/* TAB 1: OVERVIEW & FOLDERS HUB */}
      {activeTab === 'overview' && (
        <div className="folders-overview-grid">
          {/* CARD 1: SERVER ROOT DIRECTORY (Holds server.properties) */}
          <div className="card folder-card mb-5">
            <div className="card-header d-flex justify-between items-center">
              <div className="d-flex items-center gap-2">
                <span className="folder-card-icon">📁</span>
                <div>
                  <h3 className="card-title m-0">Server Root Directory (Holds <code>server.properties</code>)</h3>
                  <span className="card-subtitle text-xs text-sub">Contains server binaries, properties, packs, and world saves</span>
                </div>
              </div>
              <div className="d-flex gap-1.5">
                {data?.isCustomBdsDir ? (
                  <span className="badge badge-warning">Custom Path</span>
                ) : (
                  <span className="badge badge-success">Default BDS Path</span>
                )}
              </div>
            </div>

            <div className="card-body">
              {/* Path display box */}
              <div className="folder-path-box mb-4">
                <div className="folder-path-text font-mono" title={bdsDir}>
                  {bdsDir}
                </div>
                <div className="folder-path-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    onClick={() => handleCopy(bdsDir, 'bds')}
                    title="Copy full path"
                  >
                    {copiedKey === 'bds' ? '✓ Copied' : '📋 Copy'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    onClick={() => handleOpenExplorer('bds')}
                    title="Open in Windows Explorer"
                  >
                    📂 Explorer
                  </button>
                </div>
              </div>

              {/* Status pills */}
              <div className="folder-status-row d-flex flex-wrap gap-2 mb-4">
                <span className={`stat-pill ${data?.serverPropertiesExists ? 'pill-success' : 'pill-error'}`}>
                  {data?.serverPropertiesExists ? '✓ server.properties found' : '⚠️ server.properties missing'}
                </span>
                <span className={`stat-pill ${data?.bedrockExecutableExists ? 'pill-success' : 'pill-warning'}`}>
                  {data?.bedrockExecutableExists ? '✓ bedrock_server executable found' : '⚠️ Executable not installed'}
                </span>
                <span className={`stat-pill ${data?.worldsDirExists ? 'pill-success' : 'pill-error'}`}>
                  {data?.worldsDirExists ? `✓ worlds/ folder found (${worlds.length} worlds)` : '⚠️ worlds/ directory missing'}
                </span>
              </div>

              {/* Action buttons */}
              {isAdmin && (
                <div className="folder-actions-row d-flex flex-wrap gap-2 pt-2 border-top">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      setNewBdsPath(bdsDir);
                      setPathValidation(null);
                      setShowBdsModal(true);
                    }}
                  >
                    ✏️ Change Server Folder
                  </button>
                  {data?.isCustomBdsDir && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={handleResetBdsDir}
                      disabled={actionLoading}
                    >
                      ↺ Reset to Default
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm ml-auto"
                    onClick={() => {
                      setNewSubfolderParent('bds');
                      setShowAddFolderModal(true);
                    }}
                  >
                    ➕ Add Subfolder
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* CARD 2: WORLDS DIRECTORY (Holds world folders) */}
          <div className="card folder-card mb-5">
            <div className="card-header d-flex justify-between items-center">
              <div className="d-flex items-center gap-2">
                <span className="folder-card-icon">🌍</span>
                <div>
                  <h3 className="card-title m-0">Worlds Directory (Holds world folders)</h3>
                  <span className="card-subtitle text-xs text-sub">Current active level: <strong>{data?.activeWorld || 'None'}</strong></span>
                </div>
              </div>
              <div className="d-flex gap-1.5">
                <span className="badge badge-info">{worlds.length} Worlds</span>
                {data?.isCustomWorldsDir && <span className="badge badge-warning">Custom Worlds Path</span>}
              </div>
            </div>

            <div className="card-body">
              {/* Path display box */}
              <div className="folder-path-box mb-4">
                <div className="folder-path-text font-mono" title={worldsDir}>
                  {worldsDir}
                </div>
                <div className="folder-path-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    onClick={() => handleCopy(worldsDir, 'worlds')}
                  >
                    {copiedKey === 'worlds' ? '✓ Copied' : '📋 Copy'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    onClick={() => handleOpenExplorer('worlds')}
                  >
                    📂 Explorer
                  </button>
                </div>
              </div>

              {/* World folders quick chip list */}
              <div className="worlds-chips-container mb-4">
                <div className="text-xs font-bold text-sub mb-2">Saved World Folders:</div>
                {worlds.length === 0 ? (
                  <p className="text-xs text-muted m-0">No world folders found in directory. Click "Add New World Folder" to create one.</p>
                ) : (
                  <div className="d-flex flex-wrap gap-2">
                    {worlds.map((w) => (
                      <div
                        key={w.name}
                        className={`world-folder-chip ${w.isActive ? 'is-active' : ''}`}
                        title={`${w.name} (${formatSize(w.size)})`}
                      >
                        <span className="chip-icon">{w.isActive ? '⭐' : '🗺️'}</span>
                        <span className="chip-text font-medium">{w.name}</span>
                        <span className="chip-size text-xs">{formatSize(w.size)}</span>
                        {w.isActive && <span className="badge badge-success badge-xs">Active</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Action buttons */}
              {isAdmin && (
                <div className="folder-actions-row d-flex flex-wrap gap-2 pt-2 border-top">
                  <button
                    type="button"
                    className="btn btn-success btn-sm"
                    onClick={() => setShowAddWorldModal(true)}
                  >
                    ➕ Add New World Folder
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      setNewWorldsPath(worldsDir);
                      setShowWorldsModal(true);
                    }}
                  >
                    ✏️ Change Worlds Folder Path
                  </button>
                  {data?.isCustomWorldsDir && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={handleResetWorldsDir}
                      disabled={actionLoading}
                    >
                      ↺ Reset Worlds Path
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* CARD 3: SERVER.PROPERTIES QUICK INSPECTOR */}
          <div className="card folder-card mb-5">
            <div className="card-header d-flex justify-between items-center">
              <div className="d-flex items-center gap-2">
                <span className="folder-card-icon">📄</span>
                <div>
                  <h3 className="card-title m-0"><code>server.properties</code> File Details</h3>
                  <span className="card-subtitle text-xs text-sub">Bedrock Dedicated Server configuration descriptor</span>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-xs"
                onClick={() => setActiveTab('settings_changer')}
              >
                ⚙️ Open Settings Changer
              </button>
            </div>

            <div className="card-body">
              <div className="folder-path-box mb-3">
                <div className="folder-path-text font-mono" title={data?.serverPropertiesPath}>
                  {data?.serverPropertiesPath}
                </div>
                <div className="folder-path-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    onClick={() => handleCopy(data?.serverPropertiesPath, 'props')}
                  >
                    {copiedKey === 'props' ? '✓ Copied' : '📋 Copy'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    onClick={() => handleOpenExplorer('properties')}
                  >
                    📂 Select File
                  </button>
                </div>
              </div>

              {data?.serverPropertiesStats && (
                <div className="d-flex flex-wrap gap-3 text-xs text-sub">
                  <span><strong>File Size:</strong> {formatSize(data.serverPropertiesStats.size)}</span>
                  <span><strong>Configured Keys:</strong> {data.serverPropertiesStats.keysCount} properties</span>
                  <span><strong>Last Modified:</strong> {new Date(data.serverPropertiesStats.lastModified).toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: SETTINGS CHANGER */}
      {activeTab === 'settings_changer' && (
        <div className="settings-changer-container">
          {/* Quick Presets Bar */}
          <div className="card mb-4 presets-card">
            <div className="card-header pb-2">
              <h3 className="card-title text-sm m-0">⚡ 1-Click Server Presets</h3>
            </div>
            <div className="card-body pt-0 d-flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => applyPreset('survival')}
              >
                ⚔️ Survival Default
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => applyPreset('creative')}
              >
                🎨 Creative Sandbox
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => applyPreset('high_perf')}
              >
                🚀 High Performance (8GB)
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={() => applyPreset('crossplay')}
              >
                🌐 NetherNet Crossplay
              </button>
            </div>
          </div>

          <form onSubmit={handleSaveSettings}>
            <div className="card settings-changer-form-card mb-5">
              <div className="card-header d-flex justify-between items-center">
                <div className="d-flex items-center gap-2">
                  <span className="card-icon">⚙️</span>
                  <div>
                    <h3 className="card-title m-0">Server Settings Changer</h3>
                    <span className="card-subtitle text-xs text-sub">Quickly modify key <code>server.properties</code> and save directly</span>
                  </div>
                </div>
                <div className="d-flex gap-2">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      if (data?.properties) setPropsForm({ ...data.properties });
                      showToast('info', 'Form reloaded from file.');
                    }}
                  >
                    ↻ Discard Changes
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary btn-sm"
                    disabled={savingSettings}
                  >
                    {savingSettings ? 'Saving...' : '💾 Save & Apply Settings'}
                  </button>
                </div>
              </div>

              <div className="card-body">
                <div className="settings-changer-grid">
                  {/* GROUP 1: World & Level Selection */}
                  <div className="settings-group-card">
                    <h4 className="group-title">🌍 World &amp; Level Selection</h4>

                    <div className="form-group mb-3">
                      <label className="form-label text-xs">Active World Name (<code>level-name</code>):</label>
                      <div className="d-flex gap-2">
                        <select
                          className="input-modern flex-1 text-sm"
                          value={propsForm['level-name'] || ''}
                          onChange={(e) => handleQuickSettingChange('level-name', e.target.value)}
                        >
                          {worlds.map((w) => (
                            <option key={w.name} value={w.name}>
                              {w.name} {w.name === data?.activeWorld ? '(Current)' : ''}
                            </option>
                          ))}
                          {propsForm['level-name'] && !worlds.some((w) => w.name === propsForm['level-name']) && (
                            <option value={propsForm['level-name']}>{propsForm['level-name']} (Custom)</option>
                          )}
                        </select>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => setShowAddWorldModal(true)}
                          title="Add a new world folder"
                        >
                          ➕ New
                        </button>
                      </div>
                      <span className="form-help text-xs text-sub mt-1">
                        Must match an existing folder in <code>worlds/</code> or BDS will generate it.
                      </span>
                    </div>

                    <div className="form-group mb-3">
                      <label className="form-label text-xs">World Seed (<code>level-seed</code>):</label>
                      <input
                        type="text"
                        className="input-modern text-sm"
                        placeholder="Leave blank for random seed"
                        value={propsForm['level-seed'] ?? ''}
                        onChange={(e) => handleQuickSettingChange('level-seed', e.target.value)}
                      />
                    </div>

                    <div className="form-group mb-0">
                      <label className="form-label text-xs">World Terrain Type (<code>level-type</code>):</label>
                      <div className="option-segmented-group">
                        {['DEFAULT', 'FLAT', 'LEGACY'].map((type) => (
                          <button
                            key={type}
                            type="button"
                            className={`segmented-btn ${(propsForm['level-type'] || 'DEFAULT').toUpperCase() === type ? 'active' : ''}`}
                            onClick={() => handleQuickSettingChange('level-type', type)}
                          >
                            {type}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* GROUP 2: Gameplay & Difficulty */}
                  <div className="settings-group-card">
                    <h4 className="group-title">⚔️ Gameplay &amp; Difficulty</h4>

                    <div className="form-group mb-3">
                      <label className="form-label text-xs">Default Game Mode (<code>gamemode</code>):</label>
                      <div className="option-segmented-group">
                        {['survival', 'creative', 'adventure'].map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            className={`segmented-btn ${(propsForm['gamemode'] || 'survival').toLowerCase() === mode ? 'active' : ''}`}
                            onClick={() => handleQuickSettingChange('gamemode', mode)}
                          >
                            {mode.charAt(0).toUpperCase() + mode.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="form-group mb-3">
                      <label className="form-label text-xs">World Difficulty (<code>difficulty</code>):</label>
                      <div className="option-segmented-group">
                        {['peaceful', 'easy', 'normal', 'hard'].map((diff) => (
                          <button
                            key={diff}
                            type="button"
                            className={`segmented-btn ${(propsForm['difficulty'] || 'normal').toLowerCase() === diff ? 'active' : ''}`}
                            onClick={() => handleQuickSettingChange('difficulty', diff)}
                          >
                            {diff.charAt(0).toUpperCase() + diff.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="form-group mb-0 d-flex justify-between items-center pt-2">
                      <div>
                        <span className="text-xs font-bold text-white d-block">Allow In-Game Cheats</span>
                        <span className="text-xs text-sub">Commands like <code>/gamemode</code>, <code>/time</code></span>
                      </div>
                      <label className="modern-switch-wrapper">
                        <input
                          type="checkbox"
                          checked={String(propsForm['allow-cheats']).toLowerCase() === 'true'}
                          onChange={(e) => handleQuickSettingChange('allow-cheats', e.target.checked ? 'true' : 'false')}
                        />
                        <span className="modern-switch-slider" />
                      </label>
                    </div>
                  </div>

                  {/* GROUP 3: Server Display & Capacity */}
                  <div className="settings-group-card">
                    <h4 className="group-title">🏷️ Server Name &amp; Capacity</h4>

                    <div className="form-group mb-3">
                      <label className="form-label text-xs">Server Display Name (<code>server-name</code>):</label>
                      <input
                        type="text"
                        className="input-modern text-sm"
                        value={propsForm['server-name'] || ''}
                        onChange={(e) => handleQuickSettingChange('server-name', e.target.value)}
                      />
                    </div>

                    <div className="form-group mb-3">
                      <div className="d-flex justify-between items-center mb-1">
                        <label className="form-label text-xs m-0">Max Players (<code>max-players</code>):</label>
                        <span className="text-xs font-bold text-emerald">{propsForm['max-players'] || 10} Players</span>
                      </div>
                      <input
                        type="range"
                        className="range-slider-modern"
                        min="1"
                        max="100"
                        value={Number(propsForm['max-players'] || 10)}
                        onChange={(e) => handleQuickSettingChange('max-players', Number(e.target.value))}
                      />
                    </div>

                    <div className="form-group mb-0">
                      <label className="form-label text-xs">IPv4 Server Port (<code>server-port</code>):</label>
                      <input
                        type="number"
                        className="input-modern text-sm"
                        value={propsForm['server-port'] || 19132}
                        onChange={(e) => handleQuickSettingChange('server-port', Number(e.target.value))}
                      />
                    </div>
                  </div>

                  {/* GROUP 4: Performance & Hardware */}
                  <div className="settings-group-card">
                    <h4 className="group-title">💾 Performance &amp; Hardware Allocation</h4>

                    <div className="form-group mb-3">
                      <label className="form-label text-xs">Server RAM Allocation (<code>server-ram-limit</code>):</label>
                      <div className="option-segmented-group mb-2">
                        {['2048', '4096', '8192', '16384'].map((ram) => (
                          <button
                            key={ram}
                            type="button"
                            className={`segmented-btn ${String(propsForm['server-ram-limit']) === ram ? 'active' : ''}`}
                            onClick={() => handleQuickSettingChange('server-ram-limit', ram)}
                          >
                            {Math.round(Number(ram) / 1024)} GB
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="form-group mb-3">
                      <div className="d-flex justify-between items-center mb-1">
                        <label className="form-label text-xs m-0">View Distance (<code>view-distance</code>):</label>
                        <span className="text-xs font-bold text-indigo">{propsForm['view-distance'] || 16} Chunks</span>
                      </div>
                      <input
                        type="range"
                        className="range-slider-modern"
                        min="4"
                        max="32"
                        value={Number(propsForm['view-distance'] || 16)}
                        onChange={(e) => handleQuickSettingChange('view-distance', Number(e.target.value))}
                      />
                    </div>

                    <div className="form-group mb-0">
                      <div className="d-flex justify-between items-center mb-1">
                        <label className="form-label text-xs m-0">Simulation Tick Distance (<code>tick-distance</code>):</label>
                        <span className="text-xs font-bold text-amber">{propsForm['tick-distance'] || 4} Chunks</span>
                      </div>
                      <input
                        type="range"
                        className="range-slider-modern"
                        min="4"
                        max="12"
                        value={Number(propsForm['tick-distance'] || 4)}
                        onChange={(e) => handleQuickSettingChange('tick-distance', Number(e.target.value))}
                      />
                    </div>
                  </div>

                  {/* GROUP 5: Security & Protocol */}
                  <div className="settings-group-card">
                    <h4 className="group-title">🛡️ Security &amp; Protocol</h4>

                    <div className="form-group mb-3 d-flex justify-between items-center">
                      <div>
                        <span className="text-xs font-bold text-white d-block">Online Mode (Xbox Authentication)</span>
                        <span className="text-xs text-sub">Require players to verify Xbox Live Gamertags</span>
                      </div>
                      <label className="modern-switch-wrapper">
                        <input
                          type="checkbox"
                          checked={String(propsForm['online-mode']).toLowerCase() === 'true'}
                          onChange={(e) => handleQuickSettingChange('online-mode', e.target.checked ? 'true' : 'false')}
                        />
                        <span className="modern-switch-slider" />
                      </label>
                    </div>

                    <div className="form-group mb-3 d-flex justify-between items-center">
                      <div>
                        <span className="text-xs font-bold text-white d-block">Allowlist Enforced (<code>allow-list</code>)</span>
                        <span className="text-xs text-sub">Only players in <code>allowlist.json</code> may connect</span>
                      </div>
                      <label className="modern-switch-wrapper">
                        <input
                          type="checkbox"
                          checked={String(propsForm['allow-list'] || propsForm['white-list']).toLowerCase() === 'true'}
                          onChange={(e) => {
                            handleQuickSettingChange('allow-list', e.target.checked ? 'true' : 'false');
                            handleQuickSettingChange('white-list', e.target.checked ? 'true' : 'false');
                          }}
                        />
                        <span className="modern-switch-slider" />
                      </label>
                    </div>

                    <div className="form-group mb-0">
                      <label className="form-label text-xs">Network Transport (<code>transport</code>):</label>
                      <div className="option-segmented-group">
                        {['nethernet', 'raknet'].map((proto) => (
                          <button
                            key={proto}
                            type="button"
                            className={`segmented-btn ${(propsForm['transport'] || 'nethernet').toLowerCase() === proto ? 'active' : ''}`}
                            onClick={() => handleQuickSettingChange('transport', proto)}
                          >
                            {proto}
                          </button>
                        ))}
                      </div>
                      <span className="form-help text-xs text-sub mt-1">
                        "nethernet" is Mojang's required transport in BDS 1.26+.
                      </span>
                    </div>
                  </div>
                </div>

                <div className="settings-changer-actions mt-5 d-flex justify-end gap-2 border-top pt-4">
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={savingSettings}
                  >
                    {savingSettings ? 'Writing server.properties...' : '💾 Save & Apply Settings'}
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* TAB 3: FILE & FOLDER EXPLORER */}
      {activeTab === 'explorer' && (
        <div className="card file-explorer-card mb-5">
          <div className="card-header d-flex justify-between items-center">
            <div className="d-flex items-center gap-2">
              <span className="card-icon">📂</span>
              <div>
                <h3 className="card-title m-0">Server Root File Explorer</h3>
                <span className="card-subtitle text-xs text-sub">Viewing all items inside <code>{bdsDir}</code></span>
              </div>
            </div>
            <div className="d-flex gap-2">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setNewSubfolderParent('bds');
                  setShowAddFolderModal(true);
                }}
              >
                ➕ Add Subfolder
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => handleOpenExplorer('bds')}
              >
                📂 Open in Explorer
              </button>
            </div>
          </div>

          <div className="card-body p-0">
            <div className="table-responsive">
              <table className="table-modern">
                <thead>
                  <tr>
                    <th>Item Name</th>
                    <th>Category</th>
                    <th>Size</th>
                    <th>Last Modified</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bdsContents.map((item) => (
                    <tr key={item.name}>
                      <td className="d-flex items-center gap-2">
                        <span className="item-icon-glyph">
                          {item.isDirectory ? (item.category === 'world' ? '🌍' : '📁') : (item.name === 'server.properties' ? '📄' : '📝')}
                        </span>
                        <div>
                          <strong className="text-sm font-mono text-white">{item.name}</strong>
                          {item.name === 'server.properties' && (
                            <span className="badge badge-primary badge-xs ml-2">Active Config</span>
                          )}
                          {item.name === 'worlds' && (
                            <span className="badge badge-info badge-xs ml-2">Worlds Folder</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className={`badge badge-category badge-${item.category}`}>
                          {item.category.toUpperCase()}
                        </span>
                      </td>
                      <td className="text-xs text-sub">
                        {item.isDirectory ? '—' : formatSize(item.size)}
                      </td>
                      <td className="text-xs text-sub">
                        {item.lastModified ? new Date(item.lastModified).toLocaleString() : '—'}
                      </td>
                      <td className="text-right">
                        {item.name === 'server.properties' ? (
                          <button
                            type="button"
                            className="btn btn-primary btn-xs"
                            onClick={() => setActiveTab('settings_changer')}
                          >
                            ⚙️ Change Settings
                          </button>
                        ) : item.name === 'worlds' ? (
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            onClick={() => handleOpenExplorer('worlds')}
                          >
                            📂 Open Worlds
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            onClick={() => handleCopy(item.path, item.name)}
                          >
                            📋 Copy Path
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 1: CHANGE BDS SERVER FOLDER */}
      {showBdsModal && (
        <div className="modal-backdrop" onClick={() => setShowBdsModal(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">📁 Change Server Root Directory</h3>
              <button type="button" className="modal-close" onClick={() => setShowBdsModal(false)}>✕</button>
            </div>
            <form onSubmit={handleSaveBdsDir}>
              <div className="modal-body">
                <p className="text-xs text-sub mb-3">
                  Specify the absolute folder path where your Bedrock server files (including <code>server.properties</code> and <code>worlds/</code>) reside.
                </p>

                <div className="form-group mb-3">
                  <label className="form-label text-xs">Server Directory Path:</label>
                  <div className="d-flex gap-2">
                    <input
                      type="text"
                      className="input-modern flex-1 text-sm font-mono"
                      value={newBdsPath}
                      onChange={(e) => {
                        setNewBdsPath(e.target.value);
                        setPathValidation(null);
                      }}
                      placeholder="e.g. C:\Minecraft\bedrock-server"
                      required
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleValidatePath(newBdsPath)}
                      disabled={validating || !newBdsPath.trim()}
                    >
                      {validating ? 'Checking...' : '🔍 Validate'}
                    </button>
                  </div>
                </div>

                {pathValidation && (
                  <div className="validation-result-box p-3 mb-3 border rounded text-xs">
                    <div className="font-bold mb-1">Path Inspection Result:</div>
                    <div>Exists on disk: {pathValidation.exists ? '✓ Yes' : '❌ No'}</div>
                    {pathValidation.exists && (
                      <>
                        <div>Contains server.properties: {pathValidation.hasProperties ? '✓ Yes' : '⚠️ Missing (template will be created)'}</div>
                        <div>Contains worlds/ directory: {pathValidation.hasWorlds ? '✓ Yes' : '⚠️ Missing (folder will be created)'}</div>
                        <div>Contains bedrock_server executable: {pathValidation.hasExecutable ? '✓ Yes' : '⚠️ Missing'}</div>
                      </>
                    )}
                  </div>
                )}

                <label className="checkbox-label text-xs d-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={createBdsIfMissing}
                    onChange={(e) => setCreateBdsIfMissing(e.target.checked)}
                  />
                  <span>Create directory automatically if it does not exist</span>
                </label>
              </div>

              <div className="modal-footer d-flex justify-end gap-2">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowBdsModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={actionLoading || !newBdsPath.trim()}
                >
                  {actionLoading ? 'Saving...' : 'Save & Switch Folder'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: CHANGE WORLDS FOLDER */}
      {showWorldsModal && (
        <div className="modal-backdrop" onClick={() => setShowWorldsModal(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">🌍 Change Worlds Folder Path</h3>
              <button type="button" className="modal-close" onClick={() => setShowWorldsModal(false)}>✕</button>
            </div>
            <form onSubmit={handleSaveWorldsDir}>
              <div className="modal-body">
                <p className="text-xs text-sub mb-3">
                  Specify a custom directory path where your world folders are stored.
                </p>

                <div className="form-group mb-3">
                  <label className="form-label text-xs">Worlds Directory Path:</label>
                  <input
                    type="text"
                    className="input-modern text-sm font-mono"
                    value={newWorldsPath}
                    onChange={(e) => setNewWorldsPath(e.target.value)}
                    placeholder="e.g. D:\MinecraftWorlds"
                    required
                  />
                </div>

                <label className="checkbox-label text-xs d-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={createWorldsIfMissing}
                    onChange={(e) => setCreateWorldsIfMissing(e.target.checked)}
                  />
                  <span>Create directory automatically if it does not exist</span>
                </label>
              </div>

              <div className="modal-footer d-flex justify-end gap-2">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowWorldsModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={actionLoading || !newWorldsPath.trim()}
                >
                  {actionLoading ? 'Saving...' : 'Save Worlds Path'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: ADD NEW WORLD FOLDER */}
      {showAddWorldModal && (
        <div className="modal-backdrop" onClick={() => setShowAddWorldModal(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">➕ Add New World Folder</h3>
              <button type="button" className="modal-close" onClick={() => setShowAddWorldModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreateWorld}>
              <div className="modal-body">
                <p className="text-xs text-sub mb-3">
                  Creates a new world folder inside <code>{worldsDir}</code>. You can immediately set it as the active level in <code>server.properties</code>.
                </p>

                <div className="form-group mb-3">
                  <label className="form-label text-xs">World Folder Name:</label>
                  <input
                    type="text"
                    className="input-modern text-sm"
                    value={newWorldName}
                    onChange={(e) => setNewWorldName(e.target.value)}
                    placeholder="e.g. SurvivalRealm, Skyblock2026, Minigames"
                    required
                    autoFocus
                  />
                </div>

                <div className="form-group mb-3">
                  <label className="form-label text-xs">Game Mode:</label>
                  <select
                    className="input-modern text-sm"
                    value={newWorldGameMode}
                    onChange={(e) => setNewWorldGameMode(e.target.value)}
                  >
                    <option value="survival">Survival</option>
                    <option value="creative">Creative</option>
                    <option value="adventure">Adventure</option>
                  </select>
                </div>

                <div className="form-group mb-3">
                  <label className="form-label text-xs">World Seed (Optional):</label>
                  <input
                    type="text"
                    className="input-modern text-sm"
                    value={newWorldSeed}
                    onChange={(e) => setNewWorldSeed(e.target.value)}
                    placeholder="Leave blank for random generation"
                  />
                </div>

                <label className="checkbox-label text-xs d-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={setNewWorldActive}
                    onChange={(e) => setSetNewWorldActive(e.target.checked)}
                  />
                  <span>Immediately set as active world (<code>level-name</code> in server.properties)</span>
                </label>
              </div>

              <div className="modal-footer d-flex justify-end gap-2">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowAddWorldModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-success btn-sm"
                  disabled={actionLoading || !newWorldName.trim()}
                >
                  {actionLoading ? 'Creating...' : '➕ Create World Folder'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: ADD SUBFOLDER */}
      {showAddFolderModal && (
        <div className="modal-backdrop" onClick={() => setShowAddFolderModal(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">📁 Add New Subfolder</h3>
              <button type="button" className="modal-close" onClick={() => setShowAddFolderModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreateSubfolder}>
              <div className="modal-body">
                <div className="form-group mb-3">
                  <label className="form-label text-xs">Parent Directory:</label>
                  <select
                    className="input-modern text-sm"
                    value={newSubfolderParent}
                    onChange={(e) => setNewSubfolderParent(e.target.value)}
                  >
                    <option value="bds">Server Root ({bdsDir})</option>
                    <option value="worlds">Worlds Directory ({worldsDir})</option>
                  </select>
                </div>

                <div className="form-group mb-3">
                  <label className="form-label text-xs">Folder Name:</label>
                  <input
                    type="text"
                    className="input-modern text-sm"
                    value={newSubfolderName}
                    onChange={(e) => setNewSubfolderName(e.target.value)}
                    placeholder="e.g. custom_configs, scripts, maps"
                    required
                    autoFocus
                  />
                </div>
              </div>

              <div className="modal-footer d-flex justify-end gap-2">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowAddFolderModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={actionLoading || !newSubfolderName.trim()}
                >
                  {actionLoading ? 'Creating...' : 'Create Folder'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ServerFolders;
