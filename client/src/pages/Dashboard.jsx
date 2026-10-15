import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api';
import { safeCopyToClipboard } from '../utils/clipboard';

export const Dashboard = () => {
  const { isAdmin, canControlServer } = useAuth();
  const navigate = useNavigate();

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [isInstallingBds, setIsInstallingBds] = useState(false);
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [updatingSettings, setUpdatingSettings] = useState(false);
  const [actionMessage, setActionMessage] = useState(null); // { type: 'success' | 'error' | 'info', text: '' }

  // Remote Access & Crossplay Indicators
  const [tunnelStatus, setTunnelStatus] = useState(null);
  const [xboxStatus, setXboxStatus] = useState(null);
  const [copyToast, setCopyToast] = useState(null);

  const formatUptime = (seconds) => {
    if (!seconds || seconds <= 0 || isNaN(seconds)) return '0s';
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0 || d > 0) parts.push(`${h}h`);
    if (m > 0 || h > 0 || d > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);

    return parts.join(' ');
  };

  const fetchStatus = useCallback(async () => {
    try {
      const data = await api.getStatus();
      setStatus(data);
      if (data && data.autoUpdate !== undefined) {
        setAutoUpdate(Boolean(data.autoUpdate));
      }
    } catch (err) {
      setStatus((prev) => (prev ? { ...prev, state: 'stopped' } : { state: 'stopped', installed: false }));
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch version settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const s = await api.Versions.getSettings();
        if (s && s.autoUpdate !== undefined) {
          setAutoUpdate(Boolean(s.autoUpdate));
        }
      } catch (_) {}
    };
    loadSettings();
  }, []);

  const fetchTunnelStatus = useCallback(async () => {
    try {
      const data = await api.Tunnel.getStatus();
      setTunnelStatus(data);
    } catch (_) {}
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 1500);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  useEffect(() => {
    fetchTunnelStatus();
    const interval = setInterval(fetchTunnelStatus, 3000);
    return () => clearInterval(interval);
  }, [fetchTunnelStatus]);

  const fetchXboxStatus = useCallback(async () => {
    try {
      const data = await api.Xbox.getStatus();
      setXboxStatus(data);
    } catch (_) {}
  }, []);

  useEffect(() => {
    fetchXboxStatus();
    const interval = setInterval(fetchXboxStatus, 3000);
    return () => clearInterval(interval);
  }, [fetchXboxStatus]);

  const handleCopyAddress = async (text) => {
    if (!text) return;
    await safeCopyToClipboard(text);
    setCopyToast(`Copied "${text}" to clipboard!`);
    setTimeout(() => setCopyToast(null), 3000);
  };

  const handleInstallLatest = async () => {
    if (!window.confirm('Download and install the latest official Minecraft Bedrock Dedicated Server build from Mojang? All your worlds, server.properties, and packs will be preserved.')) {
      return;
    }

    setIsInstallingBds(true);
    setActionMessage({
      type: 'info',
      text: 'Connecting to Mojang CDN, downloading official Bedrock Dedicated Server package, and preserving your configurations...',
    });

    try {
      const res = await api.Versions.installLatest();
      setActionMessage({
        type: 'success',
        text: `✓ ${res.message || 'Bedrock server binaries installed and verified successfully!'}`,
      });
      await fetchStatus();
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err.message || 'Failed to download and install Bedrock server.',
      });
    } finally {
      setIsInstallingBds(false);
    }
  };

  const handleToggleAutoUpdate = async (e) => {
    const newVal = e.target.checked;
    setAutoUpdate(newVal);
    setUpdatingSettings(true);
    try {
      await api.Versions.updateSettings(newVal);
      setActionMessage({
        type: 'success',
        text: `Auto-Update ${newVal ? 'Enabled' : 'Disabled'}. The server will check and install the latest BDS build without overwriting your data.`,
      });
      await fetchStatus();
    } catch (err) {
      setAutoUpdate(!newVal);
      setActionMessage({
        type: 'error',
        text: 'Failed to update auto-update setting.',
      });
    } finally {
      setUpdatingSettings(false);
    }
  };

  const handleAction = async (actionType, actionFn) => {
    // If user clicked start but the binary is missing, offer instant install
    if (actionType === 'start' && status?.installed === false) {
      if (window.confirm('Bedrock Server binary is not installed yet. Would you like to automatically download and install the official build now (preserves all maps and configs)?')) {
        await handleInstallLatest();
      }
      return;
    }

    if (!window.confirm(`Are you sure you want to ${actionType.toUpperCase()} the Bedrock Dedicated Server?`)) {
      return;
    }

    setActionLoading(true);
    setActionMessage(null);

    try {
      await actionFn();
      setActionMessage({
        type: 'success',
        text: `Server command [${actionType.toUpperCase()}] executed successfully.`,
      });
      await fetchStatus();
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err.message || `Failed to ${actionType} server.`,
      });
    } finally {
      setActionLoading(false);
    }
  };

  const serverState = status?.state || (status?.running ? 'running' : 'stopped');
  const isInstalled = status?.installed !== false;
  const playersCount = status?.players?.length ?? status?.playerCount ?? status?.onlinePlayers ?? 0;
  const maxPlayers = status?.maxPlayers ?? status?.properties?.['max-players'] ?? 10;
  const playerPercent = Math.min(100, Math.round((playersCount / (maxPlayers || 10)) * 100));

  const cpuUsageNum = status?.cpu != null ? Number(status.cpu) : (status?.stats?.cpu != null ? Number(status.stats.cpu) : 0);
  const memoryMb = status?.memory != null ? Number(status.memory) : (status?.stats?.memory != null ? Number(status.stats.memory) : (status?.memoryUsage?.rss ? Math.round(status.memoryUsage.rss / 1024 / 1024) : 0));
  const allocatedRamMb = Number(status?.allocatedRam || 4096);
  const ramPercent = Math.min(100, Math.round((memoryMb / allocatedRamMb) * 100));
  const hostTotalGb = status?.systemMemory?.totalMb ? (status.systemMemory.totalMb / 1024).toFixed(1) : null;
  const hostFreeGb = status?.systemMemory?.freeMb ? (status.systemMemory.freeMb / 1024).toFixed(1) : null;
  const tpsVal = status?.tps != null ? Number(status.tps).toFixed(1) : (status?.stats?.tps != null ? Number(status.stats.tps).toFixed(1) : '20.0');
  const version = status?.version && status.version !== 'Unknown' ? status.version : (isInstalled ? 'BDS Detected' : 'Not Installed');
  const uptimeSeconds = status?.uptimeSeconds ?? status?.uptime ?? 0;
  const activeWorldName = status?.activeWorld || status?.levelName || 'Bedrock level';

  return (
    <div className="dashboard-page">
      {/* Page Title & Subtitle */}
      <div className="page-header-row">
        <div>
          <h1 className="page-main-title">Server Overview</h1>
          <p className="page-sub-title">Live system status, performance telemetry, and instant power controls</p>
        </div>
        <div className="header-meta-actions">
          {/* Auto-update Toggle Switch */}
          {isAdmin && (
            <label className="auto-update-toggle-card" title="Automatically keep Bedrock server updated with Mojang's official build without modifying your worlds or settings">
              <span className="toggle-badge-icon">🔄</span>
              <span className="toggle-label-text">Auto-Update Server:</span>
              <input
                type="checkbox"
                className="toggle-real-input"
                checked={autoUpdate}
                onChange={handleToggleAutoUpdate}
                disabled={updatingSettings}
              />
              <span className={`toggle-custom-pill ${autoUpdate ? 'on' : 'off'}`}>
                {autoUpdate ? 'ON' : 'OFF'}
              </span>
            </label>
          )}

          <div className="live-pulse-badge" title="Real-time process telemetry actively updating (1.5s refresh)">
            <span className="pulse-dot"></span>
            <span>LIVE TELEMETRY</span>
          </div>

          <button
            className="btn btn-secondary btn-sm"
            onClick={fetchStatus}
            disabled={loading}
            title="Refresh Server Telemetry"
          >
            <span className={`refresh-glyph ${loading ? 'spinning' : ''}`}>↻</span> Sync Stats
          </button>
        </div>
      </div>

      {/* Notifications */}
      {actionMessage && (
        <div className={`alert-toast alert-${actionMessage.type}`}>
          <span className="toast-icon">
            {actionMessage.type === 'success' && '✓'}
            {actionMessage.type === 'error' && '⚠️'}
            {actionMessage.type === 'info' && 'ℹ️'}
          </span>
          <span className="toast-text">{actionMessage.text}</span>
          <button className="toast-dismiss" onClick={() => setActionMessage(null)}>✕</button>
        </div>
      )}

      {/* Installation Prompt Banner if BDS is not installed */}
      {!isInstalled && (
        <div className="install-prompt-banner">
          <div className="prompt-content-flex">
            <span className="prompt-big-icon">📦</span>
            <div className="prompt-text-group">
              <h3 className="prompt-heading">Official Bedrock Dedicated Server Binary Not Found</h3>
              <p className="prompt-subtext">
                The BDS executable (<code>bedrock_server.exe</code>) has not been downloaded yet. You can automatically pull and extract Mojang's official Bedrock server package with 1 click. All existing worlds, properties, and packs are 100% preserved.
              </p>
            </div>
          </div>
          {isAdmin && (
            <button
              className="btn btn-primary btn-install-now"
              onClick={handleInstallLatest}
              disabled={isInstallingBds}
            >
              {isInstallingBds ? (
                <>
                  <span className="refresh-glyph spinning mr-2">↻</span> Installing BDS...
                </>
              ) : (
                <>
                  <span className="btn-icon">⬇️</span> Download & Install Latest BDS
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Hero Power & Status Card */}
      <div className={`hero-status-panel state-${serverState.toLowerCase()}`}>
        <div className="hero-top-bar">
          <div className="hero-status-identity">
            <div className="radar-status-dot">
              <span className="radar-core" />
              <span className="radar-wave" />
            </div>
            <div>
              <div className="hero-state-title">
                Server Status:{' '}
                <span className="state-badge-text">
                  {!isInstalled ? 'NOT INSTALLED' : serverState.toUpperCase()}
                </span>
              </div>
              <div className="hero-engine-desc">
                <span>{version}</span>
                <span className="bullet-sep">•</span>
                <span>Port {status?.port || 19132} (UDP)</span>
                <span className="bullet-sep">•</span>
                <span>Active World: <strong>{activeWorldName}</strong></span>
              </div>
            </div>
          </div>

          {/* Power Controls */}
          {canControlServer && (
            <div className="hero-control-buttons">
              <button
                className="btn-power btn-power-start"
                onClick={() => handleAction('start', api.start)}
                disabled={actionLoading || isInstallingBds || serverState === 'running' || serverState === 'starting'}
                title={!isInstalled ? 'Download and start Bedrock server' : 'Spin up Bedrock server process'}
              >
                <span className="btn-icon">▶</span>
                <span>Start</span>
              </button>

              <button
                className="btn-power btn-power-restart"
                onClick={() => handleAction('restart', api.restart)}
                disabled={actionLoading || isInstallingBds || serverState === 'stopped' || !isInstalled}
                title="Gracefully restart server"
              >
                <span className="btn-icon">🔄</span>
                <span>Restart</span>
              </button>

              <button
                className="btn-power btn-power-stop"
                onClick={() => handleAction('stop', api.stop)}
                disabled={actionLoading || isInstallingBds || serverState === 'stopped' || serverState === 'stopping'}
                title="Write 'stop' to BDS stdin to prevent world corruption"
              >
                <span className="btn-icon">⏹</span>
                <span>Stop</span>
              </button>

              {/* 1-Click Master Control: Start All & Restart All */}
              <button
                className="btn-power btn-power-start-all"
                onClick={() => handleAction('start all services (Server, Playit, and Xbox Bot)', api.Server.startAll)}
                disabled={actionLoading || isInstallingBds}
                title="Start Bedrock server, Playit internet tunnel, and Xbox Bot relay all at once"
              >
                <span className="btn-icon">⚡</span>
                <span>Start All</span>
              </button>

              <button
                className="btn-power btn-power-restart-all"
                onClick={() => handleAction('restart all services (Server, Playit, and Xbox Bot)', api.Server.restartAll)}
                disabled={actionLoading || isInstallingBds}
                title="Restart Bedrock server, Playit internet tunnel, and Xbox Bot relay all at once"
              >
                <span className="btn-icon">🔄</span>
                <span>Restart All</span>
              </button>

              {/* 1-Click Update Server Button (Admin only) */}
              {isAdmin && (
                <button
                  className="btn-power btn-power-update"
                  onClick={handleInstallLatest}
                  disabled={actionLoading || isInstallingBds}
                  title="Fetch latest official Bedrock server build from Mojang while preserving all worlds and settings"
                >
                  <span className="btn-icon">{isInstallingBds ? '⏳' : '⬆️'}</span>
                  <span>{isInstallingBds ? 'Updating...' : 'Update Server'}</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Hero Metadata Strip */}
        <div className="hero-meta-strip">
          <div className="meta-pill">
            <span className="meta-icon">⏱️</span>
            <div className="meta-info">
              <span className="meta-title">Uptime</span>
              <span className="meta-highlight">{formatUptime(uptimeSeconds)}</span>
            </div>
          </div>
          <div className="meta-pill">
            <span className="meta-icon">🌐</span>
            <div className="meta-info">
              <span className="meta-title">Network Bind</span>
              <span className="meta-highlight">0.0.0.0:{status?.port || 19132}</span>
            </div>
          </div>
          <div className="meta-pill">
            <span className="meta-icon">🌍</span>
            <div className="meta-info">
              <span className="meta-title">Active World</span>
              <span className="meta-highlight">{activeWorldName}</span>
            </div>
          </div>
          <div className="meta-pill">
            <span className="meta-icon">📦</span>
            <div className="meta-info">
              <span className="meta-title">Binary Status</span>
              <span className={`meta-highlight ${isInstalled ? 'text-primary' : 'text-danger'}`}>
                {isInstalled ? 'Installed ✓' : 'Missing'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* CONSOLE & PUBLIC ACCESS QUICK STATUS BAR */}
      <div className="modern-card remote-access-summary-card mb-6">
        <div className="d-flex items-center justify-between flex-wrap gap-3 p-4">
          <div className="d-flex items-center gap-3">
            <div className="icon-badge-box">🌐</div>
            <div>
              <div className="d-flex items-center gap-2">
                <h3 className="m-0 text-sm font-bold text-white">Console & Public Access</h3>
                <span className="badge badge-primary text-xs">Crossplay</span>
              </div>
              <p className="m-0 text-xs text-sub mt-0.5">
                Playit.gg Zero-Port Tunnel & Xbox Live Console Friend Relay
              </p>
            </div>
          </div>

          <div className="d-flex items-center gap-3 flex-wrap">
            {/* Playit Tunnel Status Pill */}
            <div className="remote-status-chip">
              <span className="text-xs text-sub font-semibold">Public Tunnel:</span>
              {tunnelStatus?.isRunning && tunnelStatus?.publicAddress ? (
                <div className="d-flex items-center gap-1.5">
                  <span className="channel-pill-online font-mono text-xs font-bold text-emerald">
                    🟢 {tunnelStatus.publicAddress}
                  </span>
                  <button
                    type="button"
                    className="btn btn-xs btn-outline"
                    title="Copy Public Minecraft Address"
                    onClick={() => handleCopyAddress(tunnelStatus.publicAddress)}
                  >
                    📋 Copy
                  </button>
                </div>
              ) : tunnelStatus?.claimUrl || tunnelStatus?.state === 'awaiting_claim' ? (
                <span className="badge badge-warning text-xs">🟡 Setup Required</span>
              ) : tunnelStatus?.isRunning ? (
                <span className="badge badge-info text-xs">🔵 Connected</span>
              ) : (
                <span className="badge badge-secondary text-xs">⚪ Offline</span>
              )}
            </div>

            {/* Xbox Live Bot Relay Pill */}
            <div className="remote-status-chip">
              <span className="text-xs text-sub font-semibold">Console Bot Relay:</span>
              {xboxStatus?.state === 'running' ? (
                <span className="badge badge-success text-xs" style={{ textTransform: 'none' }}>
                  🟢 Online {xboxStatus?.account?.gamertag ? `(${xboxStatus.account.gamertag})` : ''}
                </span>
              ) : xboxStatus?.state === 'starting' ? (
                <span className="badge badge-warning text-xs" style={{ textTransform: 'none' }}>🔄 Starting...</span>
              ) : xboxStatus?.account?.authenticated ? (
                <span className="badge badge-secondary text-xs" style={{ textTransform: 'none' }}>
                  ⚪ Offline {xboxStatus?.account?.gamertag ? `(${xboxStatus.account.gamertag})` : ''}
                </span>
              ) : (
                <span className="badge badge-secondary text-xs" style={{ textTransform: 'none' }}>⚪ Not Linked</span>
              )}
            </div>

            <Link
              to="/xbox"
              className="btn btn-secondary btn-sm d-flex items-center gap-1.5"
            >
              <span>Manage Access</span>
              <span className="text-xs">→</span>
            </Link>
          </div>
        </div>

        {copyToast && (
          <div className="px-4 pb-3">
            <div className="alert-toast alert-success py-1.5 px-3 text-xs m-0">
              <span>✓ {copyToast}</span>
            </div>
          </div>
        )}
      </div>



      {/* Telemetry Stats Grid */}
      <div className="telemetry-grid">
        {/* Players Card */}
        <div className="telemetry-card">
          <div className="card-header-flex">
            <span className="telemetry-label">PLAYERS ONLINE</span>
            <span className="telemetry-icon-badge">👥</span>
          </div>
          <div className="telemetry-main-metric">
            <span className="metric-number">{playersCount}</span>
            <span className="metric-denom">/ {maxPlayers}</span>
          </div>
          <div className="telemetry-meter-bar">
            <div className="meter-fill fill-green" style={{ width: `${Math.max(5, playerPercent)}%` }} />
          </div>
          <div className="telemetry-footer-text">
            <span>{playerPercent}% Server Capacity</span>
          </div>
        </div>

        {/* TPS Card */}
        <div className="telemetry-card">
          <div className="card-header-flex">
            <span className="telemetry-label">ENGINE TICK RATE</span>
            <span className="telemetry-icon-badge">⚡</span>
          </div>
          <div className="telemetry-main-metric">
            <span className="metric-number">{tpsVal}</span>
            <span className="metric-denom">TPS</span>
          </div>
          <div className="telemetry-meter-bar">
            <div className="meter-fill fill-emerald" style={{ width: `${(Number(tpsVal) / 20) * 100}%` }} />
          </div>
          <div className="telemetry-footer-text">
            <span className="metric-status-good">● 100% Target Simulation Speed</span>
          </div>
        </div>

        {/* CPU Card */}
        <div className="telemetry-card">
          <div className="card-header-flex">
            <span className="telemetry-label">CPU UTILIZATION</span>
            <span className="telemetry-icon-badge">📈</span>
          </div>
          <div className="telemetry-main-metric">
            <span className="metric-number">{cpuUsageNum}</span>
            <span className="metric-denom">%</span>
          </div>
          <div className="telemetry-meter-bar">
            <div className="meter-fill fill-cyan" style={{ width: `${Math.min(100, Math.max(3, cpuUsageNum))}%` }} />
          </div>
          <div className="telemetry-footer-text">
            <span>{status?.pid ? `PID #${status.pid} • bedrock_server.exe` : 'Engine Idle / Process Stopped'}</span>
          </div>
        </div>

        {/* RAM Card */}
        <div className="telemetry-card">
          <div className="card-header-flex">
            <span className="telemetry-label">MEMORY ALLOCATION</span>
            <span className="telemetry-icon-badge">💾</span>
          </div>
          <div className="telemetry-main-metric">
            <span className="metric-number">{memoryMb >= 1024 ? (memoryMb / 1024).toFixed(2) : memoryMb}</span>
            <span className="metric-denom">
              {memoryMb >= 1024 ? 'GB' : 'MB'} / {allocatedRamMb >= 1024 ? `${(allocatedRamMb / 1024).toFixed(0)} GB Limit` : `${allocatedRamMb} MB Limit`}
            </span>
          </div>
          <div className="telemetry-meter-bar">
            <div className="meter-fill fill-purple" style={{ width: `${Math.min(100, Math.max(4, ramPercent))}%` }} />
          </div>
          <div className="telemetry-footer-text">
            <span>
              {ramPercent}% of allocated limit{hostTotalGb ? ` • Host: ${hostFreeGb} GB free` : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Quick Action Hub */}
      <div className="quick-hub-section">
        <div className="hub-section-header">
          <h2 className="hub-title">Administrative Actions</h2>
          <span className="hub-subtitle">Quick shortcuts to core server management modules</span>
        </div>

        <div className="quick-hub-grid">
          <div className="hub-tile" onClick={() => navigate('/players')}>
            <div className="tile-icon-box">🎮</div>
            <div className="tile-content">
              <h3 className="tile-heading">Players & Operators</h3>
              <p className="tile-description">Live connected roster, historical offline players, and OP/DEOP permissions.</p>
            </div>
            <span className="tile-arrow">→</span>
          </div>

          <div className="hub-tile" onClick={() => navigate('/console')}>
            <div className="tile-icon-box">🖥️</div>
            <div className="tile-content">
              <h3 className="tile-heading">Live Interactive Console</h3>
              <p className="tile-description">Send BDS stdin commands, monitor sanitized logs, and track player activity.</p>
            </div>
            <span className="tile-arrow">→</span>
          </div>

          <div className="hub-tile" onClick={() => navigate('/properties')}>
            <div className="tile-icon-box">⚙️</div>
            <div className="tile-content">
              <h3 className="tile-heading">Server Properties</h3>
              <p className="tile-description">Configure gamemodes, render distance, allowlists, and auto-sanitized offline mode.</p>
            </div>
            <span className="tile-arrow">→</span>
          </div>

          <div className="hub-tile" onClick={() => navigate('/backups')}>
            <div className="tile-icon-box">💾</div>
            <div className="tile-content">
              <h3 className="tile-heading">Snapshots & Backups</h3>
              <p className="tile-description">Create compressed `.zip` archives of active worlds with auto-backup scheduling.</p>
            </div>
            <span className="tile-arrow">→</span>
          </div>
        </div>
      </div>

      {/* IN-GAME WORLD & TIME OF DAY CONTROLS */}
      {isAdmin && (
        <div className="gameplay-controls-card">
          <div className="gameplay-header">
            <div className="gameplay-title-group">
              <span className="gameplay-icon">⏱️</span>
              <div>
                <h3 className="gameplay-heading">In-Game World & Time of Day Controls</h3>
                <p className="gameplay-desc">
                  Instantly change the in-game sun/moon cycle and weather without typing console commands.
                </p>
              </div>
            </div>
            <div className="gameplay-status-pill">
              <span className={`dot ${serverState === 'running' ? 'dot-active' : 'dot-idle'}`}></span>
              <span>{serverState === 'running' ? 'Live World Connected' : 'Server Must Be Running'}</span>
            </div>
          </div>

          <div className="gameplay-grid">
            {/* Primary Time of Day Toggle */}
            <div className="gameplay-subcard">
              <div className="subcard-title-row">
                <span className="subcard-icon">☀️ / 🌙</span>
                <span className="subcard-title">Quick Time of Day Switch</span>
              </div>
              <p className="subcard-hint">One-click toggle between Day and Night in the active world.</p>
              
              <div className="time-toggle-actions">
                <button
                  className="btn-time-quick btn-time-day"
                  disabled={serverState !== 'running' || actionLoading}
                  onClick={async () => {
                    try {
                      await api.Server.setTime('day');
                      setActionMessage({ type: 'success', text: '☀️ In-game time set to Day (1000 ticks)!' });
                    } catch (e) {
                      setActionMessage({ type: 'error', text: e.message || 'Failed to change time' });
                    }
                  }}
                >
                  <span className="btn-glyph">☀️</span>
                  <span className="btn-label-bold">Set Day</span>
                  <span className="btn-label-sub">Sunrise (1000)</span>
                </button>

                <button
                  className="btn-time-quick btn-time-night"
                  disabled={serverState !== 'running' || actionLoading}
                  onClick={async () => {
                    try {
                      await api.Server.setTime('night');
                      setActionMessage({ type: 'success', text: '🌙 In-game time set to Night (13000 ticks)!' });
                    } catch (e) {
                      setActionMessage({ type: 'error', text: e.message || 'Failed to change time' });
                    }
                  }}
                >
                  <span className="btn-glyph">🌙</span>
                  <span className="btn-label-bold">Set Night</span>
                  <span className="btn-label-sub">Sunset (13000)</span>
                </button>
              </div>

              {/* Specific time presets */}
              <div className="time-presets-strip">
                <button
                  className="preset-pill"
                  disabled={serverState !== 'running'}
                  onClick={() => api.Server.setTime('noon').then(() => setActionMessage({ type: 'success', text: '☀️ Time set to Noon!' }))}
                >
                  ☀️ Noon
                </button>
                <button
                  className="preset-pill"
                  disabled={serverState !== 'running'}
                  onClick={() => api.Server.setTime('sunset').then(() => setActionMessage({ type: 'success', text: '🌇 Time set to Sunset!' }))}
                >
                  🌇 Sunset
                </button>
                <button
                  className="preset-pill"
                  disabled={serverState !== 'running'}
                  onClick={() => api.Server.setTime('midnight').then(() => setActionMessage({ type: 'success', text: '🌌 Time set to Midnight!' }))}
                >
                  🌌 Midnight
                </button>
                <button
                  className="preset-pill preset-lock"
                  disabled={serverState !== 'running'}
                  title="Freeze time and lock daylight cycle"
                  onClick={() => {
                    api.Server.setDaylightCycle(false)
                      .then(() => api.Server.setTime('day'))
                      .then(() => setActionMessage({ type: 'success', text: '🔒 Daylight cycle locked to permanent Day!' }));
                  }}
                >
                  🔒 Lock Day (Always Day)
                </button>
                <button
                  className="preset-pill"
                  disabled={serverState !== 'running'}
                  title="Enable natural cycle"
                  onClick={() => {
                    api.Server.setDaylightCycle(true)
                      .then(() => setActionMessage({ type: 'success', text: '🔄 Natural Daylight cycle restored!' }));
                  }}
                >
                  🔄 Normal Cycle
                </button>
              </div>
            </div>

            {/* Weather Controls */}
            <div className="gameplay-subcard">
              <div className="subcard-title-row">
                <span className="subcard-icon">🌧️</span>
                <span className="subcard-title">Atmosphere & Weather</span>
              </div>
              <p className="subcard-hint">Change weather conditions in real-time across all biomes.</p>
              
              <div className="weather-btn-grid">
                <button
                  className="btn-weather btn-clear"
                  disabled={serverState !== 'running'}
                  onClick={async () => {
                    try {
                      await api.Server.setWeather('clear');
                      setActionMessage({ type: 'success', text: '☀️ Weather cleared! Blue skies ahead.' });
                    } catch (e) {
                      setActionMessage({ type: 'error', text: e.message || 'Failed to set weather' });
                    }
                  }}
                >
                  <span className="weather-glyph">🌤️</span>
                  <span>Clear Skies</span>
                </button>

                <button
                  className="btn-weather btn-rain"
                  disabled={serverState !== 'running'}
                  onClick={async () => {
                    try {
                      await api.Server.setWeather('rain');
                      setActionMessage({ type: 'success', text: '🌧️ Rain storm activated!' });
                    } catch (e) {
                      setActionMessage({ type: 'error', text: e.message || 'Failed to set weather' });
                    }
                  }}
                >
                  <span className="weather-glyph">🌧️</span>
                  <span>Rain</span>
                </button>

                <button
                  className="btn-weather btn-thunder"
                  disabled={serverState !== 'running'}
                  onClick={async () => {
                    try {
                      await api.Server.setWeather('thunder');
                      setActionMessage({ type: 'success', text: '⚡ Thunderstorm summoned!' });
                    } catch (e) {
                      setActionMessage({ type: 'error', text: e.message || 'Failed to set weather' });
                    }
                  }}
                >
                  <span className="weather-glyph">⚡</span>
                  <span>Thunderstorm</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
