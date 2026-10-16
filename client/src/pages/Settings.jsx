import React, { useState, useEffect, useRef } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { safeCopyToClipboard } from '../utils/clipboard';

export const Settings = () => {
  const { user, updateCredentials, isAdmin } = useAuth();

  // Admin Credentials form state
  const [newUsername, setNewUsername] = useState(user?.username || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Password visibility toggles
  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);

  // Status feedback
  const [credLoading, setCredLoading] = useState(false);
  const [credToast, setCredToast] = useState(null); // { type: 'success' | 'error', text: '' }

  // System Settings state
  const [autoUpdateServer, setAutoUpdateServer] = useState(false);
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(false);
  const [backupFrequency, setBackupFrequency] = useState(6);
  const [systemLoading, setSystemLoading] = useState(true);
  const [serverStatus, setServerStatus] = useState(null);

  // App GitHub Updates state
  const [updateStatus, setUpdateStatus] = useState(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updatingApp, setUpdatingApp] = useState(false);
  const [autoCheckAppUpdates, setAutoCheckAppUpdates] = useState(true);
  const [updateProgressData, setUpdateProgressData] = useState({
    percent: 10,
    stage: 1,
    progress: 'Preparing application update environment...',
  });
  const updatePollRef = useRef(null);

  // Active Settings Tab ('portal' | 'automation' | 'admin' | 'updates' | 'all')
  const [activeTab, setActiveTab] = useState('portal');

  // Default Portal Sections
  const defaultSections = [
    { id: 'server_status', name: 'Server Status & Power Controls', description: 'Live online status, active players, and Start / Restart / Start All / Restart All buttons', enabled: true },
    { id: 'online_players', name: 'Online Players (Name & Skin Face)', description: 'Show live connected players by gamertag and Minecraft skin face', enabled: true },
    { id: 'direct_ip', name: 'Direct Server IP Connection', description: 'Direct server IP & port, 1-click clipboard copy, and manual join steps for PC & mobile', enabled: true },
    { id: 'xbox_bot', name: 'Xbox Live Friend Relay Bot', description: 'Console & mobile quick-join relay bot card, Gamertag, auto-friend guide, and bot power buttons', enabled: true },
    { id: 'installed_addons', name: 'Installed Addons', description: 'Show enabled server addons, icons, versions, and details for players', enabled: true },
  ];

  // Player Quick-Start Portal state
  const [portalEnabled, setPortalEnabled] = useState(true);
  const [portalRequireLogin, setPortalRequireLogin] = useState(false);
  const [portalShowXboxBot, setPortalShowXboxBot] = useState(true);
  const [portalSlug, setPortalSlug] = useState('server');
  const [portalTitle, setPortalTitle] = useState('Minecraft Bedrock Server');
  const [portalLogoUrl, setPortalLogoUrl] = useState('');
  const [portalLogoSize, setPortalLogoSize] = useState(140);
  const [portalSubtitle, setPortalSubtitle] = useState('Dedicated Bedrock Realm');
  const [portalSections, setPortalSections] = useState(defaultSections);
  const [portalSaving, setPortalSaving] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    if (user?.username) {
      setNewUsername(user.username);
    }
  }, [user]);

  // Load automation, system settings, and player portal configuration
  useEffect(() => {
    const loadSystemSettings = async () => {
      setSystemLoading(true);
      try {
        const [vSettings, bSettings, sStatus, pConfig, uStatus] = await Promise.allSettled([
          api.Versions.getSettings(),
          api.Backups.getSettings(),
          api.Server.getStatus(),
          api.Portal.getConfig(),
          api.Updates.getStatus(false),
        ]);

        if (vSettings.status === 'fulfilled' && vSettings.value) {
          setAutoUpdateServer(Boolean(vSettings.value.autoUpdate));
        }

        if (uStatus.status === 'fulfilled' && uStatus.value) {
          setUpdateStatus(uStatus.value);
          setAutoCheckAppUpdates(Boolean(uStatus.value.autoCheck));
        }

        if (bSettings.status === 'fulfilled' && bSettings.value) {
          setAutoBackupEnabled(Boolean(bSettings.value.autoBackup));
          if (bSettings.value.frequencyHours) {
            setBackupFrequency(Number(bSettings.value.frequencyHours));
          }
        }

        if (sStatus.status === 'fulfilled') {
          setServerStatus(sStatus.value);
        }

        if (pConfig.status === 'fulfilled' && pConfig.value) {
          const cfg = pConfig.value;
          if (cfg.enabled !== undefined) setPortalEnabled(Boolean(cfg.enabled));
          if (cfg.requireLogin !== undefined) setPortalRequireLogin(Boolean(cfg.requireLogin));
          if (cfg.showXboxBot !== undefined) setPortalShowXboxBot(Boolean(cfg.showXboxBot));
          if (cfg.slug) setPortalSlug(cfg.slug);
          if (cfg.title) setPortalTitle(cfg.title);
          if (cfg.logoUrl !== undefined) setPortalLogoUrl(cfg.logoUrl || '');
          if (cfg.logoSize !== undefined) setPortalLogoSize(Number(cfg.logoSize) || 140);
          if (cfg.subtitle) setPortalSubtitle(cfg.subtitle);

          if (cfg.sections && Array.isArray(cfg.sections) && cfg.sections.length > 0) {
            const merged = cfg.sections.map((s) => {
              const match = defaultSections.find((d) => d.id === s.id);
              return {
                id: s.id,
                name: s.name || match?.name || s.id,
                description: match?.description || '',
                enabled: s.enabled !== false,
              };
            });
            defaultSections.forEach((d) => {
              if (!merged.some((m) => m.id === d.id)) {
                merged.push(d);
              }
            });
            setPortalSections(merged);
          }
        }
      } catch (err) {
        console.error('Failed to load system settings:', err);
      } finally {
        setSystemLoading(false);
      }
    };

    loadSystemSettings();
  }, []);

  const handleUpdateCredentials = async (e) => {
    e.preventDefault();
    setCredToast(null);

    if (!currentPassword) {
      setCredToast({ type: 'error', text: 'Current password is required to authorize changes.' });
      return;
    }

    if (newPassword && newPassword.length < 4) {
      setCredToast({ type: 'error', text: 'New password must be at least 4 characters long.' });
      return;
    }

    if (newPassword && newPassword !== confirmPassword) {
      setCredToast({ type: 'error', text: 'New password and confirmation do not match.' });
      return;
    }

    const payload = {
      currentPassword,
    };

    if (newUsername.trim() && newUsername.trim() !== user?.username) {
      if (newUsername.trim().length < 3) {
        setCredToast({ type: 'error', text: 'Username must be at least 3 characters long.' });
        return;
      }
      payload.username = newUsername.trim();
    }

    if (newPassword.trim()) {
      payload.newPassword = newPassword.trim();
    }

    if (!payload.username && !payload.newPassword) {
      setCredToast({ type: 'error', text: 'Please enter a new username or a new password to update.' });
      return;
    }

    setCredLoading(true);
    try {
      const res = await updateCredentials(payload);
      setCredToast({
        type: 'success',
        text: `✓ ${res.message || 'Admin login credentials updated successfully!'}`,
      });
      // Clear password fields on success
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setCredToast({
        type: 'error',
        text: err.message || 'Failed to update credentials. Please check your current password.',
      });
    } finally {
      setCredLoading(false);
    }
  };

  const handleToggleAutoUpdate = async (val) => {
    setAutoUpdateServer(val);
    try {
      await api.Versions.updateSettings(val);
      setCredToast({
        type: 'success',
        text: `Auto-Update ${val ? 'Enabled' : 'Disabled'} for Bedrock Dedicated Server!`,
      });
    } catch (err) {
      setAutoUpdateServer(!val);
      setCredToast({ type: 'error', text: 'Failed to update auto-update setting' });
    }
  };

  const handleToggleAutoBackup = async (val) => {
    setAutoBackupEnabled(val);
    try {
      await api.Backups.updateSettings(val, backupFrequency);
      setCredToast({
        type: 'success',
        text: `Automated world backups ${val ? 'Enabled' : 'Disabled'}!`,
      });
    } catch (err) {
      setAutoBackupEnabled(!val);
      setCredToast({ type: 'error', text: 'Failed to update auto-backup setting' });
    }
  };

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    try {
      const res = await api.Updates.check();
      setUpdateStatus(res);
      setAutoCheckAppUpdates(Boolean(res.autoCheck));
      setCredToast({
        type: res.updateAvailable ? 'info' : 'success',
        text: res.updateAvailable
          ? `🚀 Update available! ${res.commitsBehind} new commit(s) found on GitHub.`
          : '✓ App is up to date! You are running the latest version from GitHub.',
      });
    } catch (err) {
      setCredToast({ type: 'error', text: err.message || 'Failed to check GitHub for updates.' });
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleToggleAutoCheck = async (val) => {
    setAutoCheckAppUpdates(val);
    try {
      await api.Updates.setPreferences({ autoCheck: val });
      setCredToast({
        type: 'success',
        text: `Auto-check GitHub for updates on launch ${val ? 'Enabled' : 'Disabled'}!`,
      });
    } catch (err) {
      setAutoCheckAppUpdates(!val);
      setCredToast({ type: 'error', text: 'Failed to save auto-check setting.' });
    }
  };

  const handleApplyAppUpdate = async () => {
    if (!window.confirm('Apply latest updates from GitHub? All worlds, databases, player data, and configurations are 100% preserved.')) return;
    setUpdatingApp(true);
    setUpdateProgressData({
      percent: 15,
      stage: 1,
      progress: 'Creating safety backup of database...',
    });

    if (updatePollRef.current) clearInterval(updatePollRef.current);
    updatePollRef.current = setInterval(async () => {
      try {
        const p = await api.Updates.getProgress();
        if (p) {
          setUpdateProgressData((prev) => ({
            percent: Math.max(prev.percent, p.percent || 10),
            stage: p.stage || prev.stage || 1,
            progress: p.progress || prev.progress,
          }));
        }
      } catch (_) {}
    }, 600);

    try {
      const res = await api.Updates.apply();
      if (updatePollRef.current) clearInterval(updatePollRef.current);
      setUpdateProgressData({
        percent: 100,
        stage: 5,
        progress: 'App successfully updated to latest version!',
      });
      setCredToast({
        type: 'success',
        text: `✓ ${res.message || 'App successfully updated!'} Please reload the page to load new assets.`,
      });
      const fresh = await api.Updates.getStatus(false);
      setUpdateStatus(fresh);
    } catch (err) {
      if (updatePollRef.current) clearInterval(updatePollRef.current);
      setCredToast({ type: 'error', text: err.message || 'Failed to apply app update.' });
    } finally {
      setUpdatingApp(false);
    }
  };

  const handleResetIgnored = async () => {
    try {
      await api.Updates.setPreferences({ ignoredCommit: '', clearSnooze: true });
      const fresh = await api.Updates.getStatus(true);
      setUpdateStatus(fresh);
      setCredToast({ type: 'success', text: 'Reset ignored updates. Notifications restored.' });
    } catch (err) {
      setCredToast({ type: 'error', text: 'Failed to reset ignored updates.' });
    }
  };

  const handleChangeBackupFrequency = async (freq) => {
    const fNum = parseFloat(freq);
    setBackupFrequency(fNum);
    try {
      await api.Backups.updateSettings(autoBackupEnabled, fNum);
      setCredToast({
        type: 'success',
        text: `Backup frequency set to every ${fNum} hours.`,
      });
    } catch (err) {
      setCredToast({ type: 'error', text: 'Failed to update backup frequency' });
    }
  };

  const handleSavePortalSettings = async (overrides = {}) => {
    setPortalSaving(true);
    try {
      const payload = {
        enabled: overrides.enabled !== undefined ? overrides.enabled : portalEnabled,
        requireLogin: overrides.requireLogin !== undefined ? overrides.requireLogin : portalRequireLogin,
        showXboxBot: overrides.showXboxBot !== undefined ? overrides.showXboxBot : portalShowXboxBot,
        slug: overrides.slug !== undefined ? overrides.slug : portalSlug,
        title: overrides.title !== undefined ? overrides.title : portalTitle,
        logoUrl: overrides.logoUrl !== undefined ? overrides.logoUrl : portalLogoUrl,
        logoSize: overrides.logoSize !== undefined ? overrides.logoSize : portalLogoSize,
        subtitle: overrides.subtitle !== undefined ? overrides.subtitle : portalSubtitle,
        sections: overrides.sections !== undefined ? overrides.sections : portalSections,
      };
      await api.Portal.updateSettings(payload);
      setCredToast({
        type: 'success',
        text: '✓ Player Quick-Start Portal settings saved successfully!',
      });
    } catch (err) {
      setCredToast({ type: 'error', text: err.message || 'Failed to update portal settings.' });
    } finally {
      setPortalSaving(false);
    }
  };

  const handleMoveSection = (index, direction) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= portalSections.length) return;
    const updated = [...portalSections];
    const [moved] = updated.splice(index, 1);
    updated.splice(targetIndex, 0, moved);
    setPortalSections(updated);
  };

  const handleToggleSection = (id) => {
    setPortalSections((prev) =>
      prev.map((sec) => (sec.id === id ? { ...sec, enabled: !sec.enabled } : sec))
    );
  };

  const handleResetSections = () => {
    setPortalSections(defaultSections);
  };

  const handleCopyPortalLink = async () => {
    const cleanSlug = (portalSlug || 'server').trim().replace(/^\/+|\/+$/g, '');
    const fullUrl = `${window.location.origin}/${cleanSlug}`;
    const ok = await safeCopyToClipboard(fullUrl);
    if (ok) {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 3000);
      setCredToast({ type: 'success', text: `📋 Copied player portal link to clipboard: ${fullUrl}` });
    } else {
      setCredToast({ type: 'info', text: `Player portal link: ${fullUrl}` });
    }
  };

  return (
    <div className="page-container settings-page">
      {/* Toast Alert */}
      {credToast && (
        <div className={`toast-banner toast-${credToast.type} mb-4`}>
          <span className="toast-icon">{credToast.type === 'success' ? '✓' : '⚠️'}</span>
          <span>{credToast.text}</span>
          <button className="toast-close" onClick={() => setCredToast(null)}>✕</button>
        </div>
      )}

      {/* Header */}
      <div className="section-header-modern">
        <div>
          <h1 className="page-title">Settings &amp; Access Controls</h1>
          <p className="page-subtitle">
            Manage admin login credentials, password vault, automated engine services, and directory storage.
          </p>
        </div>
      </div>

      {/* Category Navigation Bar */}
      <div className="settings-nav-tabs mb-5">
        <button
          type="button"
          className={`settings-tab-btn ${activeTab === 'portal' ? 'active' : ''}`}
          onClick={() => setActiveTab('portal')}
        >
          <span className="tab-icon">🎮</span>
          <span>Player Quick-Start Portal</span>
        </button>
        <button
          type="button"
          className={`settings-tab-btn ${activeTab === 'automation' ? 'active' : ''}`}
          onClick={() => setActiveTab('automation')}
        >
          <span className="tab-icon">⚡</span>
          <span>Automation Services</span>
        </button>
        <button
          type="button"
          className={`settings-tab-btn ${activeTab === 'admin' ? 'active' : ''}`}
          onClick={() => setActiveTab('admin')}
        >
          <span className="tab-icon">🔐</span>
          <span>Admin Credentials</span>
        </button>
        <button
          type="button"
          className={`settings-tab-btn ${activeTab === 'updates' ? 'active' : ''}`}
          onClick={() => setActiveTab('updates')}
        >
          <span className="tab-icon">🚀</span>
          <span>App Updates &amp; GitHub Sync</span>
          {updateStatus?.updateAvailable && (
            <span className="badge badge-warning text-2xs ml-1.5 px-1.5 py-0.5">NEW</span>
          )}
        </button>
        <button
          type="button"
          className={`settings-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
          onClick={() => setActiveTab('all')}
        >
          <span className="tab-icon">📋</span>
          <span>View All</span>
        </button>
      </div>

      <div className={`settings-content-wrapper ${activeTab !== 'all' ? 'single-category-view' : 'settings-grid'}`}>

        {/* CARD 1: ADMIN LOGIN CREDENTIALS */}
        {(activeTab === 'admin' || activeTab === 'all') && (
        <div className="modern-card settings-card">
          <div className="card-header-styled">
            <div className="header-badge-title">
              <span className="icon-badge">🔐</span>
              <h2>Admin Login Credentials</h2>
            </div>
            <span className="header-meta">Username &amp; Password Vault</span>
          </div>

          <div className="card-body p-5">
            {/* Current Account Profile Strip */}
            <div className="user-profile-summary-box mb-5">
              <div className="profile-avatar">
                {user?.username?.charAt(0).toUpperCase() || 'A'}
              </div>
              <div className="profile-info">
                <div className="profile-name-row">
                  <span className="profile-name">{user?.username || 'admin'}</span>
                  <span className="role-tag-admin">🛡️ Administrator Account</span>
                </div>
                <span className="profile-sub">
                  Account ID: #{user?.id || 1} &bull; Active JWT Session &bull; Role: {user?.role || 'admin'}
                </span>
              </div>
            </div>

            <form onSubmit={handleUpdateCredentials}>
              {/* New Username Input */}
              <div className="form-group-modern mb-4">
                <label className="field-label-bold">
                  Admin Username:
                </label>
                <div className="input-with-icon">
                  <span className="input-icon">👤</span>
                  <input
                    type="text"
                    required
                    placeholder="Enter new admin username"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                  />
                </div>
                <small className="field-hint">
                  Used for logging into this administration panel. Minimum 3 characters.
                </small>
              </div>

              <div className="credential-divider my-4">
                <span>CHANGE PASSWORD (OPTIONAL)</span>
              </div>

              {/* New Password Input */}
              <div className="form-group-modern mb-3">
                <label className="field-label-bold">
                  New Password:
                </label>
                <div className="input-with-icon">
                  <span className="input-icon">🔑</span>
                  <input
                    type={showNewPass ? 'text' : 'password'}
                    placeholder="Leave blank to keep existing password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowNewPass(!showNewPass)}
                    tabIndex="-1"
                  >
                    {showNewPass ? '👁️' : '🔒'}
                  </button>
                </div>
                <small className="field-hint">
                  Minimum 4 characters. Leave blank if you only want to change your username.
                </small>
              </div>

              {/* Confirm New Password Input */}
              {newPassword && (
                <div className="form-group-modern mb-4">
                  <label className="field-label-bold">
                    Confirm New Password:
                  </label>
                  <div className="input-with-icon">
                    <span className="input-icon">🔒</span>
                    <input
                      type={showConfirmPass ? 'text' : 'password'}
                      required={!!newPassword}
                      placeholder="Repeat new password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="password-toggle-btn"
                      onClick={() => setShowConfirmPass(!showConfirmPass)}
                      tabIndex="-1"
                    >
                      {showConfirmPass ? '👁️' : '🔒'}
                    </button>
                  </div>
                  {confirmPassword && newPassword !== confirmPassword && (
                    <small className="text-danger mt-1">Passwords do not match.</small>
                  )}
                </div>
              )}

              {/* Current Password Input (Authorization) */}
              <div className="current-password-box mt-4 p-4">
                <label className="field-label-bold text-white mb-2 d-block">
                  Current Password (Required to authorize changes) *
                </label>
                <div className="input-with-icon">
                  <span className="input-icon">🛡️</span>
                  <input
                    type={showCurrentPass ? 'text' : 'password'}
                    required
                    placeholder="Enter current password to confirm identity"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowCurrentPass(!showCurrentPass)}
                    tabIndex="-1"
                  >
                    {showCurrentPass ? '👁️' : '🔒'}
                  </button>
                </div>
                <small className="field-hint text-sub">
                  Required to prevent unauthorized modifications to the administrative account.
                </small>
              </div>

              <div className="mt-5 text-right">
                <button
                  type="submit"
                  className="btn-modern btn-primary btn-lg"
                  disabled={credLoading || !currentPassword}
                >
                  {credLoading ? (
                    <>
                      <span className="spinner-sm mr-2" /> Saving Credentials...
                    </>
                  ) : (
                    '💾 Update Admin Credentials'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
        )}

        {/* CARD 2: AUTOMATION & ENGINE PREFERENCES */}
        {(activeTab === 'automation' || activeTab === 'all') && (
        <div className="modern-card settings-card">
          <div className="card-header-styled">
            <div className="header-badge-title">
              <span className="icon-badge">⚡</span>
              <h2>Server Automation Services</h2>
            </div>
            <span className="header-meta">Background daemons</span>
          </div>

          <div className="card-body p-5">
            {/* Auto-Update BDS Service */}
            <div className="setting-toggle-row mb-5 pb-4 border-bottom">
              <div className="setting-toggle-info">
                <div className="d-flex items-center gap-2 mb-1">
                  <span className="setting-icon">🔄</span>
                  <h4 className="setting-title m-0">Auto-Update Bedrock Dedicated Server</h4>
                </div>
                <p className="setting-desc m-0">
                  Automatically queries Mojang's official release CDN on startup and updates BDS to the latest stable build while preserving all your world files, configs, and packs.
                </p>
              </div>
              <label className="modern-switch-wrapper flex-shrink-0">
                <input
                  type="checkbox"
                  checked={autoUpdateServer}
                  onChange={(e) => handleToggleAutoUpdate(e.target.checked)}
                  disabled={!isAdmin}
                />
                <span className="modern-switch-slider"></span>
              </label>
            </div>

            {/* Auto-Backup Worlds Service */}
            <div className="setting-toggle-row mb-4">
              <div className="setting-toggle-info">
                <div className="d-flex items-center gap-2 mb-1">
                  <span className="setting-icon">💾</span>
                  <h4 className="setting-title m-0">Automated World Snapshot Backups</h4>
                </div>
                <p className="setting-desc m-0">
                  Schedules recurring world backups in the background with safe BDS chunk flushing (<code className="code-tag">save hold / resume</code>).
                </p>
              </div>
              <label className="modern-switch-wrapper flex-shrink-0">
                <input
                  type="checkbox"
                  checked={autoBackupEnabled}
                  onChange={(e) => handleToggleAutoBackup(e.target.checked)}
                  disabled={!isAdmin}
                />
                <span className="modern-switch-slider"></span>
              </label>
            </div>

            {/* Backup Frequency Selector */}
            <div className="form-group-modern pl-6 mb-5">
              <label className="field-label-bold">
                Automated Backup Frequency:
              </label>
              <select
                className="input-modern select-modern"
                value={backupFrequency}
                onChange={(e) => handleChangeBackupFrequency(e.target.value)}
                disabled={!autoBackupEnabled || !isAdmin}
              >
                <option value="1">Every 1 Hour (High Activity)</option>
                <option value="2">Every 2 Hours</option>
                <option value="4">Every 4 Hours</option>
                <option value="6">Every 6 Hours (Recommended)</option>
                <option value="12">Every 12 Hours (Twice Daily)</option>
                <option value="24">Every 24 Hours (Daily Snapshot)</option>
              </select>
            </div>

            {/* Storage & Environment Information */}
            <div className="engine-paths-card p-4">
              <h5 className="engine-paths-title mb-3">📁 Filesystem &amp; Process Paths</h5>
              <div className="path-row mb-2">
                <span className="path-label">Server Binary:</span>
                <span className="path-code font-mono">{serverStatus?.exePath || 'bds/bedrock_server.exe'}</span>
              </div>
              <div className="path-row mb-2">
                <span className="path-label">Database:</span>
                <span className="path-code font-mono">data/db/manager.db (WASM SQLite)</span>
              </div>
              <div className="path-row mb-2">
                <span className="path-label">Worlds Directory:</span>
                <span className="path-code font-mono">bds/worlds/</span>
              </div>
              <div className="path-row">
                <span className="path-label">Archives Directory:</span>
                <span className="path-code font-mono">data/backups/</span>
              </div>
            </div>
          </div>
        </div>
        )}

        {/* CARD 3: PLAYER QUICK-START PORTAL */}
        {(activeTab === 'portal' || activeTab === 'all') && (
        <div className={`modern-card settings-card ${activeTab === 'all' ? 'mt-6' : ''}`}>
          <div className="card-header-styled">
            <div className="header-badge-title">
              <span className="icon-badge">🎮</span>
              <h2>Player Quick-Start Portal</h2>
            </div>
            <span className="header-meta">Dedicated Player Control Page</span>
          </div>

          <div className="card-body p-5">
            <p className="text-sub text-sm mb-5">
              Configure a dedicated, streamlined page for players to view server status and power on or reboot the server. Designed specifically for players with zero admin clutter.
            </p>

            {/* Live Link Showcase Banner */}
            <div className="portal-link-showcase p-4 mb-5 rounded bg-darker border" style={{ background: 'rgba(16, 185, 129, 0.05)', borderColor: 'rgba(16, 185, 129, 0.25)' }}>
              <div className="d-flex justify-between items-center flex-wrap gap-3">
                <div>
                  <span className="text-xs text-muted d-block font-semibold mb-1" style={{ letterSpacing: '0.05em' }}>DEDICATED PLAYER LINK</span>
                  <code className="text-primary font-mono text-sm" style={{ color: '#34d399', fontWeight: 700 }}>
                    {window.location.origin}/{(portalSlug || 'server').trim().replace(/^\/+|\/+$/g, '')}
                  </code>
                </div>
                <div className="d-flex gap-2">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleCopyPortalLink}
                  >
                    {copiedLink ? '✓ Copied!' : '📋 Copy Link'}
                  </button>
                  <a
                    href={`/${(portalSlug || 'server').trim().replace(/^\/+|\/+$/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-primary btn-sm"
                  >
                    ↗ Open Portal
                  </a>
                </div>
              </div>
            </div>

            {/* Toggle 1: Enable Portal */}
            <div className="setting-toggle-row mb-5 pb-4 border-bottom">
              <div className="setting-toggle-info">
                <div className="d-flex items-center gap-2 mb-1">
                  <span className="setting-icon">🌐</span>
                  <h4 className="setting-title m-0">Enable Player Quick-Start Portal</h4>
                </div>
                <p className="setting-desc m-0">
                  When enabled, players can visit this dedicated URL to see if the server is offline/online and trigger Start or Restart.
                </p>
              </div>
              <label className="modern-switch-wrapper flex-shrink-0">
                <input
                  type="checkbox"
                  checked={portalEnabled}
                  onChange={(e) => {
                    const val = e.target.checked;
                    setPortalEnabled(val);
                    handleSavePortalSettings({ enabled: val });
                  }}
                  disabled={!isAdmin || portalSaving}
                />
                <span className="modern-switch-slider"></span>
              </label>
            </div>

            {/* Toggle 2: Require Login */}
            <div className="setting-toggle-row mb-5 pb-4 border-bottom">
              <div className="setting-toggle-info">
                <div className="d-flex items-center gap-2 mb-1">
                  <span className="setting-icon">🔒</span>
                  <h4 className="setting-title m-0">Require Account Login for Players</h4>
                </div>
                <p className="setting-desc m-0">
                  <strong>OFF:</strong> Anyone with the link can view status and Start/Restart the server without logging in.<br />
                  <strong>ON:</strong> Players must be registered and signed in to use the portal controls.
                </p>
              </div>
              <label className="modern-switch-wrapper flex-shrink-0">
                <input
                  type="checkbox"
                  checked={portalRequireLogin}
                  onChange={(e) => {
                    const val = e.target.checked;
                    setPortalRequireLogin(val);
                    handleSavePortalSettings({ requireLogin: val });
                  }}
                  disabled={!isAdmin || portalSaving}
                />
                <span className="modern-switch-slider"></span>
              </label>
            </div>

            {/* Toggle 3: Show Xbox Live Relay Bot */}
            <div className="setting-toggle-row mb-5 pb-4 border-bottom">
              <div className="setting-toggle-info">
                <div className="d-flex items-center gap-2 mb-1">
                  <span className="setting-icon">🎮</span>
                  <h4 className="setting-title m-0">Display Xbox Live Bot in Player Portal</h4>
                </div>
                <p className="setting-desc m-0">
                  Displays the Xbox Live Relay Bot profile, Gamertag with 1-click copy, console &amp; mobile join instructions, and bot power buttons directly on the Player Quick-Start Portal.
                </p>
              </div>
              <label className="modern-switch-wrapper flex-shrink-0">
                <input
                  type="checkbox"
                  checked={portalShowXboxBot}
                  onChange={(e) => {
                    const val = e.target.checked;
                    setPortalShowXboxBot(val);
                    handleSavePortalSettings({ showXboxBot: val });
                  }}
                  disabled={!isAdmin || portalSaving}
                />
                <span className="modern-switch-slider"></span>
              </label>
            </div>

            {/* PORTAL SECTION REORDER & LAYOUT CUSTOMIZER */}
            <div className="portal-section-manager-card mb-5 p-4 rounded-xl border">
              <div className="d-flex justify-between items-center mb-3 flex-wrap gap-2">
                <div>
                  <h4 className="setting-title m-0 d-flex items-center gap-2">
                    <span>📐</span>
                    <span>Portal Sections &amp; Layout Customizer</span>
                  </h4>
                  <p className="setting-desc m-0 mt-1">
                    Decide what goes where on the Player Quick-Start Portal. Reorder sections and toggle visibility to organize however you'd like.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  onClick={handleResetSections}
                  disabled={!isAdmin || portalSaving}
                  title="Reset sections to default order"
                >
                  ↺ Reset Order
                </button>
              </div>

              <div className="portal-sections-list">
                {portalSections.map((sec, idx) => (
                  <div
                    key={sec.id}
                    className={`portal-section-reorder-item ${sec.enabled ? 'is-enabled' : 'is-disabled'}`}
                  >
                    <div className="section-reorder-left">
                      <span className="section-index-badge">#{idx + 1}</span>
                      <div className="section-info">
                        <div className="d-flex items-center gap-2">
                          <span className="section-title font-bold text-white">{sec.name}</span>
                          <span className={`badge ${sec.enabled ? 'badge-success' : 'badge-secondary'}`}>
                            {sec.enabled ? '● Visible' : '○ Hidden'}
                          </span>
                        </div>
                        <p className="section-desc text-xs text-sub m-0 mt-0.5">{sec.description}</p>
                      </div>
                    </div>

                    <div className="section-reorder-actions">
                      {/* Toggle visibility */}
                      <button
                        type="button"
                        className={`btn-section-toggle ${sec.enabled ? 'active' : ''}`}
                        onClick={() => handleToggleSection(sec.id)}
                        disabled={!isAdmin || portalSaving}
                        title={sec.enabled ? 'Hide this section from players' : 'Show this section to players'}
                      >
                        {sec.enabled ? '👁️ Shown' : '🚫 Hidden'}
                      </button>

                      {/* Move Up */}
                      <button
                        type="button"
                        className="btn-reorder-arrow"
                        onClick={() => handleMoveSection(idx, -1)}
                        disabled={!isAdmin || portalSaving || idx === 0}
                        title="Move Up"
                      >
                        ▲
                      </button>

                      {/* Move Down */}
                      <button
                        type="button"
                        className="btn-reorder-arrow"
                        onClick={() => handleMoveSection(idx, 1)}
                        disabled={!isAdmin || portalSaving || idx === portalSections.length - 1}
                        title="Move Down"
                      >
                        ▼
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Form Fields: URL Slug, Title, Logo URL, Subtitle */}
            <form onSubmit={(e) => { e.preventDefault(); handleSavePortalSettings(); }}>
              <div className="form-grid-2 mb-4">
                <div className="form-group-modern">
                  <label className="field-label-bold">Portal URL Path / Slug:</label>
                  <div className="input-with-prefix" style={{ display: 'flex', alignItems: 'center' }}>
                    <span className="input-prefix text-muted mr-2" style={{ fontSize: '0.82rem' }}>{window.location.origin}/</span>
                    <input
                      type="text"
                      className="input-modern"
                      value={portalSlug}
                      onChange={(e) => setPortalSlug(e.target.value.replace(/[^a-zA-Z0-9-_]/g, ''))}
                      placeholder="server"
                      disabled={!isAdmin || portalSaving}
                    />
                  </div>
                  <small className="field-hint text-sub mt-1 d-block">
                    The custom URL path where players access the control page (e.g. <code>server</code>, <code>portal</code>, or <code>play</code>).
                  </small>
                </div>

                <div className="form-group-modern">
                  <label className="field-label-bold">Server Name / Text Logo:</label>
                  <input
                    type="text"
                    className="input-modern"
                    value={portalTitle}
                    onChange={(e) => setPortalTitle(e.target.value)}
                    placeholder="Minecraft Bedrock Server"
                    disabled={!isAdmin || portalSaving}
                  />
                  <small className="field-hint text-sub mt-1 d-block">
                    Main server name or title displayed prominently on the player portal.
                  </small>
                </div>
              </div>

              <div className="form-grid-2 mb-4">
                <div className="form-group-modern">
                  <label className="field-label-bold">Custom Server Logo Image URL (Optional):</label>
                  <input
                    type="url"
                    className="input-modern"
                    value={portalLogoUrl}
                    onChange={(e) => setPortalLogoUrl(e.target.value)}
                    placeholder="https://example.com/server-icon.png"
                    disabled={!isAdmin || portalSaving}
                  />
                  <small className="field-hint text-sub mt-1 d-block">
                    Leave empty to display the illuminated Minecraft cube text logo.
                  </small>
                </div>

                <div className="form-group-modern">
                  <label className="field-label-bold">Server Subtitle / Motd:</label>
                  <input
                    type="text"
                    className="input-modern"
                    value={portalSubtitle}
                    onChange={(e) => setPortalSubtitle(e.target.value)}
                    placeholder="Dedicated Bedrock Realm • Direct Player Controls"
                    disabled={!isAdmin || portalSaving}
                  />
                  <small className="field-hint text-sub mt-1 d-block">
                    Displayed directly below the server title (e.g. your server IP, domain, or realm description).
                  </small>
                </div>
              </div>

              {/* Logo Scaling & Sizing Slider */}
              <div className="portal-logo-scale-control mb-4">
                <div className="d-flex items-center justify-between mb-2">
                  <label className="field-label-bold m-0 d-flex items-center gap-2">
                    <span>📏</span>
                    <span>Logo Scaling / Size Slider:</span>
                  </label>
                  <span className="logo-scale-badge">{portalLogoSize}px</span>
                </div>

                <div className="d-flex items-center gap-3">
                  <input
                    type="range"
                    min="50"
                    max="350"
                    step="10"
                    className="logo-scale-slider flex-1"
                    value={portalLogoSize}
                    onChange={(e) => setPortalLogoSize(Number(e.target.value))}
                    disabled={!isAdmin || portalSaving}
                  />
                  <div className="d-flex gap-1.5">
                    {[80, 140, 200, 280].map((sz) => (
                      <button
                        key={sz}
                        type="button"
                        className={`btn-scale-preset ${portalLogoSize === sz ? 'active' : ''}`}
                        onClick={() => setPortalLogoSize(sz)}
                        disabled={!isAdmin || portalSaving}
                      >
                        {sz === 80 && 'Small'}
                        {sz === 140 && 'Medium'}
                        {sz === 200 && 'Large'}
                        {sz === 280 && 'XL'}
                      </button>
                    ))}
                  </div>
                </div>
                <small className="field-hint text-sub mt-1.5 d-block">
                  Adjust how big your custom logo appears on the Player Quick-Start Portal. The logo is displayed fully without square cropping or box restrictions.
                </small>

                {/* Real-time Visual Preview */}
                {portalLogoUrl && (
                  <div className="portal-logo-preview-card mt-3">
                    <span className="preview-label">Live Portal Scale Preview ({portalLogoSize}px):</span>
                    <div className="preview-canvas">
                      <img
                        src={portalLogoUrl}
                        alt="Portal Logo Preview"
                        style={{
                          maxHeight: `${portalLogoSize}px`,
                          maxWidth: '100%',
                          width: 'auto',
                          height: 'auto',
                          objectFit: 'contain',
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4 text-right">
                <button
                  type="submit"
                  className="btn-modern btn-primary"
                  disabled={!isAdmin || portalSaving}
                >
                  {portalSaving ? (
                    <>
                      <span className="spinner-sm mr-2" /> Saving Portal Settings...
                    </>
                  ) : (
                    '💾 Save Portal Settings'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
        )}

        {/* CARD 4: APP VERSION & GITHUB SYNCHRONIZATION */}
        {(activeTab === 'updates' || activeTab === 'all') && (
          <div className="modern-card settings-card">
            <div className="card-header-styled">
              <div className="header-badge-title">
                <span className="icon-badge">🚀</span>
                <h2>App Version &amp; GitHub Updates</h2>
              </div>
              <span className="header-meta">Sync engine with GitHub repository</span>
            </div>

            <div className="card-body p-5">
              {/* Repository info banner */}
              <div className="user-profile-summary-box mb-5">
                <div className="profile-avatar" style={{ background: 'linear-gradient(135deg, #24292e, #0d1117)', border: '1px solid rgba(255, 255, 255, 0.15)' }}>
                  🐙
                </div>
                <div className="profile-info flex-1">
                  <div className="profile-name-row d-flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <span className="profile-name">FatGoats Bedrock Server Manager+</span>
                      <span className="badge badge-primary font-mono text-xs ml-2">
                        #{updateStatus?.currentCommit || 'local'}
                      </span>
                    </div>
                    <a
                      href="https://github.com/tywentghxst/FatGoats-Bedrock-Server-Manager-Plus"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-secondary btn-xs font-mono"
                    >
                      🔗 Open GitHub Repo ↗
                    </a>
                  </div>
                  <span className="profile-sub d-block mt-1">
                    Branch: <strong>main</strong> &bull; Remote: <code>origin</code> &bull; Last Checked: {updateStatus?.lastChecked ? new Date(updateStatus.lastChecked).toLocaleString() : 'Never'}
                  </span>
                </div>
              </div>

              {/* Status Display */}
              <div className="mb-4">
                {updateStatus?.updateAvailable ? (
                  <div className="p-4 rounded-xl mb-4" style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                    <div className="d-flex items-center justify-between flex-wrap gap-2 mb-2">
                      <div className="d-flex items-center gap-2">
                        <span className="text-xl">🚀</span>
                        <strong className="text-white text-base">New Version Available on GitHub!</strong>
                      </div>
                      <span className="badge badge-warning font-bold text-xs">
                        {updateStatus.commitsBehind} New Commit{updateStatus.commitsBehind !== 1 ? 's' : ''}
                      </span>
                    </div>

                    <div className="font-mono text-xs text-sub mb-3 p-2.5 rounded bg-darker">
                      Latest Remote Commit: <strong className="text-emerald">#{updateStatus.remoteCommit}</strong>
                      {updateStatus.remoteCommitDate && <span> ({updateStatus.remoteCommitDate})</span>}
                      <br />
                      <span className="text-white font-sans mt-1 d-block font-medium">
                        "{updateStatus.remoteCommitSubject}"
                      </span>
                    </div>

                    {updateStatus.changelog && updateStatus.changelog.length > 0 && (
                      <div className="mb-3">
                        <span className="text-2xs text-sub uppercase font-semibold mb-1 d-block">Recent Commits:</span>
                        <div className="max-h-36 overflow-y-auto bg-darker p-2.5 rounded text-xs space-y-1 font-mono">
                          {updateStatus.changelog.map((c, idx) => (
                            <div key={idx} className="d-flex items-baseline gap-2">
                              <span className="text-emerald text-2xs">#{c.hash}</span>
                              <span className="text-white font-sans text-xs truncate flex-1">{c.subject}</span>
                              <span className="text-sub text-2xs shrink-0 font-sans">{c.date}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Real-time Update Progress Bar */}
                    {updatingApp && (
                      <div className="update-progress-container mb-4">
                        <div className="update-progress-header">
                          <div>
                            <span className="text-xs uppercase font-bold text-sub d-block">Applying Update</span>
                            <strong className="text-white text-sm">Automated Pipeline in Progress</strong>
                          </div>
                          <span className="update-progress-percentage">{updateProgressData.percent}%</span>
                        </div>

                        <div className="update-progress-track">
                          <div
                            className="update-progress-fill"
                            style={{ width: `${updateProgressData.percent}%` }}
                          />
                        </div>

                        <div className="update-steps-stepper">
                          {[
                            { num: 1, label: 'Safety Backup', icon: '🛡️' },
                            { num: 2, label: 'Pull Commits', icon: '📥' },
                            { num: 3, label: 'Dependencies', icon: '📦' },
                            { num: 4, label: 'Build Client', icon: '⚡' },
                            { num: 5, label: 'Launcher Binary', icon: '🪟' },
                          ].map((s) => {
                            const isDone = updateProgressData.stage > s.num;
                            const isActive = updateProgressData.stage === s.num;
                            return (
                              <div
                                key={s.num}
                                className={`update-step-pill ${isActive ? 'is-active' : ''} ${isDone ? 'is-done' : ''}`}
                              >
                                <span>{isDone ? '✓' : s.icon}</span>
                                <span className="truncate">{s.label}</span>
                              </div>
                            );
                          })}
                        </div>

                        <div className="update-status-live-line">
                          <span className="update-status-dot" />
                          <span className="truncate flex-1">{updateProgressData.progress}</span>
                        </div>
                      </div>
                    )}

                    <div className="d-flex items-center justify-between flex-wrap gap-3">
                      <button
                        type="button"
                        className="btn btn-primary font-bold px-4 py-2"
                        onClick={handleApplyAppUpdate}
                        disabled={updatingApp || !isAdmin}
                      >
                        {updatingApp ? 'Applying Update (zero data loss)...' : '🚀 Update App Now (Zero Data Loss)'}
                      </button>

                      {updateStatus.isIgnored && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-xs"
                          onClick={handleResetIgnored}
                        >
                          Reset Ignored Version
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl mb-4 d-flex items-center justify-between flex-wrap gap-3" style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
                    <div className="d-flex items-center gap-3">
                      <span className="text-2xl">✓</span>
                      <div>
                        <strong className="text-white text-sm d-block">App is Up to Date</strong>
                        <span className="text-sub text-xs">
                          You are currently running the latest commits from the main branch.
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm font-semibold"
                      onClick={handleCheckUpdates}
                      disabled={checkingUpdates}
                    >
                      {checkingUpdates ? 'Checking GitHub...' : '🔄 Check for Updates'}
                    </button>
                  </div>
                )}
              </div>

              {/* Auto-check setting toggle */}
              <div className="automation-setting-row d-flex items-center justify-between p-3 rounded mb-4" style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                <div className="setting-info mr-3">
                  <label className="field-label-bold mb-1 d-block text-sm">
                    Auto-Check GitHub for Updates on App Launch
                  </label>
                  <p className="field-hint text-sub text-xs m-0">
                    Automatically checks GitHub whenever the dashboard is opened and prompts you with options to <strong>Update</strong>, <strong>Ignore</strong>, or <strong>Ask Again Later</strong>.
                  </p>
                </div>
                <label className="switch-toggle shrink-0">
                  <input
                    type="checkbox"
                    checked={autoCheckAppUpdates}
                    onChange={(e) => handleToggleAutoCheck(e.target.checked)}
                    disabled={!isAdmin}
                  />
                  <span className="switch-slider" />
                </label>
              </div>

              {/* Zero Data Loss Guarantee Callout */}
              <div className="p-4 rounded-xl" style={{ background: 'rgba(16, 185, 129, 0.06)', border: '1px solid rgba(16, 185, 129, 0.2)' }}>
                <div className="d-flex items-center gap-2 text-emerald font-bold text-sm mb-1">
                  <span>🛡️</span>
                  <span>Zero Data Loss Guarantee</span>
                </div>
                <p className="text-sub text-xs m-0">
                  App updates pull exclusively source code improvements and web assets. Your SQLite database (<code>manager.db</code>), Minecraft worlds, player stats, world backups, custom addons, and login credentials are permanently preserved and will never be overwritten or deleted.
                </p>
              </div>

              {/* Manual Check Button Bar */}
              <div className="mt-4 d-flex justify-between items-center flex-wrap gap-2">
                <span className="text-sub text-xs">
                  {updateStatus?.lastChecked && `Last checked: ${new Date(updateStatus.lastChecked).toLocaleTimeString()}`}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary font-bold px-4 py-2"
                  onClick={handleCheckUpdates}
                  disabled={checkingUpdates}
                >
                  {checkingUpdates ? 'Connecting to GitHub...' : '🔄 Check for App Updates'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Settings;
