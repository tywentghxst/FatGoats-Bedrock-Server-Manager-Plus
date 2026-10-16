import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { safeCopyToClipboard } from '../utils/clipboard';

export const PlayerSkinAvatar = ({ name, size = 44 }) => {
  const [srcIndex, setSrcIndex] = useState(0);
  const sources = [
    `https://mc-heads.net/avatar/${encodeURIComponent(name)}/${size}`,
    `https://minotar.net/helm/${encodeURIComponent(name)}/${size}`,
    `https://avatar.xboxlive.com/avatar/${encodeURIComponent(name)}/avatarpic-l.png`,
    `https://mc-heads.net/avatar/MHF_Steve/${size}`,
  ];

  return (
    <div className="portal-player-skin-wrap" style={{ width: size, height: size }}>
      <img
        src={sources[srcIndex]}
        alt={name}
        className="portal-player-skin-img"
        onError={() => {
          if (srcIndex < sources.length - 1) {
            setSrcIndex((prev) => prev + 1);
          }
        }}
      />
      <span className="portal-player-skin-dot" title="Online in world" />
    </div>
  );
};

export const PlayerPortal = () => {
  const { user, login, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState(null); // { type: 'success' | 'error', text: '' }
  const [cooldown, setCooldown] = useState(0);
  const [logoError, setLogoError] = useState(false);
  const [botAvatarError, setBotAvatarError] = useState(false);
  const [addonsTileExpanded, setAddonsTileExpanded] = useState(true);

  // Embedded login states (for requireLogin mode)
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const cooldownTimerRef = useRef(null);

  // Fetch status
  const fetchStatus = useCallback(async () => {
    try {
      const data = await api.getPortalStatus();
      if (data) {
        setStatus(data);
        setConnectionError(null);
        if (data.cooldownRemaining) {
          setCooldown((prev) => Math.max(prev, data.cooldownRemaining));
        }
      }
    } catch (err) {
      console.error('Failed to fetch portal status:', err);
      setConnectionError(err.message || 'Unable to connect to server backend.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 2500);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Reset logo error when logoUrl changes
  useEffect(() => {
    setLogoError(false);
  }, [status?.logoUrl]);

  useEffect(() => {
    setBotAvatarError(false);
  }, [status?.xboxBot?.displayPic]);

  // Handle local cooldown tick down
  useEffect(() => {
    if (cooldown > 0) {
      cooldownTimerRef.current = setInterval(() => {
        setCooldown((prev) => {
          if (prev <= 1) {
            clearInterval(cooldownTimerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(cooldownTimerRef.current);
  }, [cooldown]);

  const handleAction = async (actionType) => {
    if (cooldown > 0 || actionLoading) return;

    setActionLoading(true);
    setActionMessage(null);

    try {
      const res = await api.portalAction(actionType);
      setActionMessage({
        type: 'success',
        text: res.message || `Server ${actionType.toUpperCase()} signal sent successfully!`,
      });
      if (res.cooldownRemaining) {
        setCooldown(res.cooldownRemaining);
      }
      await fetchStatus();
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err.message || `Failed to ${actionType} server.`,
      });
      if (err.data?.cooldownRemaining) {
        setCooldown(err.data.cooldownRemaining);
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleEmbeddedLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    setIsLoggingIn(true);
    try {
      await login(loginUser, loginPass);
      setLoginUser('');
      setLoginPass('');
      await fetchStatus();
    } catch (err) {
      setLoginError(err.message || 'Invalid username or password.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  if (loading) {
    return (
      <div className="portal-viewport-center">
        <div className="portal-loading-box">
          <div className="spinner mb-4" />
          <p className="text-muted">Connecting to Minecraft server portal...</p>
        </div>
      </div>
    );
  }

  // If portal is disabled by admin
  if (status && status.enabled === false) {
    return (
      <div className="portal-viewport-center">
        <div className="portal-card text-center p-8">
          <div className="portal-icon-big mb-3">🔒</div>
          <h2 className="portal-title text-xl font-bold mb-2">Portal Unavailable</h2>
          <p className="portal-subtitle text-muted mb-6">
            The player server control portal has been disabled by the server administrator.
          </p>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/login')}>
            Admin Login
          </button>
        </div>
      </div>
    );
  }

  // If requireLogin is true and user is not authenticated
  const requiresAuth = status?.requireLogin && (!status?.authenticated && !isAuthenticated);

  const serverState = status?.state || 'stopped';
  const isRunning = serverState === 'running';
  const isStarting = serverState === 'starting';
  const isRestarting = serverState === 'restarting' || serverState === 'stopping';
  const isStopped = serverState === 'stopped';

  const title = status?.title || 'Minecraft Bedrock Server';
  const subtitle = status?.subtitle || `Dedicated Bedrock Realm • Port ${status?.port || 19132}`;
  const logoUrl = status?.logoUrl;

  return (
    <div className="portal-viewport">
      {/* Background Ambience */}
      <div className="portal-ambient-glow" />

      <main className="portal-card-container">
        <div className="portal-card">
          {/* Logo / Branding Header */}
          <div className="portal-branding-header">
            {logoUrl && !logoError ? (
              <div className="portal-custom-logo-wrap">
                <img
                  src={logoUrl}
                  alt={title}
                  className="portal-custom-logo-img"
                  style={{
                    maxHeight: `${status?.logoSize || 140}px`,
                    maxWidth: '100%',
                    width: 'auto',
                    height: 'auto',
                  }}
                  onError={() => setLogoError(true)}
                />
              </div>
            ) : (
              <div className="portal-text-logo-cube">
                <span className="cube-glyph">⛏️</span>
              </div>
            )}

            <h1 className="portal-server-name">{title}</h1>
            <p className="portal-server-subtitle">{subtitle}</p>
          </div>

          {/* Connection Error Banner */}
          {connectionError && (
            <div className="alert-toast alert-error mb-4">
              <span className="toast-icon">⚠️</span>
              <span className="toast-text">{connectionError}</span>
              <button
                type="button"
                className="btn btn-secondary btn-xs ml-auto"
                onClick={fetchStatus}
              >
                🔄 Retry
              </button>
            </div>
          )}

          {/* Authentication Prompt if Require Login is ON */}
          {requiresAuth ? (
            <div className="portal-auth-prompt mt-6">
              <div className="auth-prompt-badge mb-4">
                <span>🔒 Member Authentication Required</span>
              </div>
              <p className="text-sub text-sm mb-4 text-center">
                The administrator has configured this portal to require sign-in to control server power.
              </p>

              {loginError && (
                <div className="alert-toast alert-error mb-4">
                  <span>⚠️ {loginError}</span>
                </div>
              )}

              <form onSubmit={handleEmbeddedLogin} className="portal-login-form">
                <div className="form-group mb-3">
                  <input
                    type="text"
                    required
                    placeholder="Username"
                    className="input-modern"
                    value={loginUser}
                    onChange={(e) => setLoginUser(e.target.value)}
                    disabled={isLoggingIn}
                  />
                </div>
                <div className="form-group mb-4">
                  <input
                    type="password"
                    required
                    placeholder="Password"
                    className="input-modern"
                    value={loginPass}
                    onChange={(e) => setLoginPass(e.target.value)}
                    disabled={isLoggingIn}
                  />
                </div>
                <button
                  type="submit"
                  className="btn btn-primary w-full btn-lg"
                  disabled={isLoggingIn}
                >
                  {isLoggingIn ? 'Signing in...' : 'Sign In & Access Controls'}
                </button>
              </form>
            </div>
          ) : (
            <>
              {/* Dynamic Modular Sections rendered in user-configured order */}
              {(() => {
                const onlinePlayers = status?.onlinePlayers || status?.players || [];

                let configuredSections = (status?.sections && Array.isArray(status.sections) && status.sections.length > 0)
                  ? [...status.sections]
                  : [
                      { id: 'server_status', enabled: true },
                      { id: 'online_players', enabled: true },
                      { id: 'direct_ip', enabled: true },
                      { id: 'xbox_bot', enabled: true },
                      { id: 'installed_addons', enabled: true },
                    ];

                // Auto-include online_players section if missing from saved config
                if (!configuredSections.some((s) => s.id === 'online_players')) {
                  const sIdx = configuredSections.findIndex((s) => s.id === 'server_status');
                  if (sIdx !== -1) {
                    configuredSections.splice(sIdx + 1, 0, { id: 'online_players', enabled: true });
                  } else {
                    configuredSections.unshift({ id: 'online_players', enabled: true });
                  }
                }

                const renderSection = (id) => {
                  if (id === 'server_status') {
                    return (
                      <div key="server_status" className="portal-section-block mb-4">
                        {/* Server Status Pill */}
                        <div className={`portal-status-pill state-${serverState}`}>
                          <div className="portal-status-dot">
                            <span className="dot-core" />
                            <span className="dot-wave" />
                          </div>
                          <div className="portal-status-text-group">
                            <span className="portal-status-badge">
                              {isRunning && 'ONLINE'}
                              {isStarting && 'STARTING UP...'}
                              {isRestarting && 'RESTARTING...'}
                              {isStopped && 'OFFLINE'}
                            </span>
                            {isRunning && (
                              <span className="portal-player-count">
                                • {onlinePlayers.length || status?.playerCount || 0} / {status?.maxPlayers ?? 10} Players Active
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Live Online Players Strip by Name & Skin Face */}
                        {isRunning && (
                          <div className="portal-status-online-players mt-3">
                            {onlinePlayers.length > 0 ? (
                              <div className="portal-online-players-strip">
                                <div className="portal-online-players-label mb-2 d-flex items-center gap-1.5">
                                  <span className="pulse-dot-green" />
                                  <span className="text-xs font-bold text-white">Online In World ({onlinePlayers.length}):</span>
                                </div>
                                <div className="portal-online-chips-row">
                                  {onlinePlayers.map((player) => (
                                    <div key={player.name} className="portal-player-online-chip" title={`${player.name} is in-game`}>
                                      <PlayerSkinAvatar name={player.name} size={28} />
                                      <span className="portal-chip-name">{player.name}</span>
                                      {player.isOp && <span className="portal-chip-op-crown" title="Operator">👑</span>}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <div className="portal-online-players-empty-strip">
                                <span>👥 0 players currently in world</span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Notification Banner */}
                        {actionMessage && (
                          <div className={`alert-toast alert-${actionMessage.type} my-4`}>
                            <span className="toast-icon">
                              {actionMessage.type === 'success' ? '✓' : '⚠️'}
                            </span>
                            <span className="toast-text">{actionMessage.text}</span>
                            <button className="toast-dismiss" onClick={() => setActionMessage(null)}>✕</button>
                          </div>
                        )}

                        {/* Action Buttons: START, RESTART, START ALL, RESTART ALL */}
                        <div className="portal-action-buttons portal-action-buttons-grid">
                          {/* START SERVER */}
                          <button
                            type="button"
                            className="portal-btn portal-btn-start"
                            onClick={() => handleAction('start')}
                            disabled={actionLoading || isRunning || isStarting || isRestarting || cooldown > 0}
                            title={isRunning ? 'Server is already running' : 'Power on Bedrock Dedicated Server'}
                          >
                            <span className="btn-portal-icon">▶</span>
                            <span className="btn-portal-label">Start Server</span>
                            <span className="btn-portal-sub">
                              {isRunning ? 'Already Online' : isStarting ? 'Starting...' : 'Power On Engine'}
                            </span>
                          </button>

                          {/* RESTART SERVER */}
                          <button
                            type="button"
                            className="portal-btn portal-btn-restart"
                            onClick={() => handleAction('restart')}
                            disabled={actionLoading || isStopped || isStarting || isRestarting || cooldown > 0}
                            title={isStopped ? 'Server must be running to restart' : 'Reboot Bedrock server'}
                          >
                            <span className="btn-portal-icon">🔄</span>
                            <span className="btn-portal-label">Restart Server</span>
                            <span className="btn-portal-sub">
                              {isStopped ? 'Server Offline' : isRestarting ? 'Restarting...' : 'Reboot World'}
                            </span>
                          </button>

                          {/* START ALL */}
                          <button
                            type="button"
                            className="portal-btn portal-btn-start-all"
                            onClick={() => handleAction('start_all')}
                            disabled={actionLoading || cooldown > 0}
                            title="Start Server, Playit Tunnel, and Xbox Bot together"
                          >
                            <span className="btn-portal-icon">⚡</span>
                            <span className="btn-portal-label">Start All</span>
                            <span className="btn-portal-sub">Server + Playit + Bot</span>
                          </button>

                          {/* RESTART ALL */}
                          <button
                            type="button"
                            className="portal-btn portal-btn-restart-all"
                            onClick={() => handleAction('restart_all')}
                            disabled={actionLoading || cooldown > 0}
                            title="Restart Server, Playit Tunnel, and Xbox Bot together"
                          >
                            <span className="btn-portal-icon">🔄⚡</span>
                            <span className="btn-portal-label">Restart All</span>
                            <span className="btn-portal-sub">Reboot All Services</span>
                          </button>
                        </div>
                      </div>
                    );
                  }

                  if (id === 'online_players') {
                    return (
                      <div key="online_players" className="portal-section-block portal-online-players-section mt-4">
                        <div className="portal-tunnel-card portal-online-players-card">
                          <div className="portal-tunnel-header d-flex items-center justify-between">
                            <div className="d-flex items-center gap-2">
                              <span className="portal-tunnel-logo">👥</span>
                              <div>
                                <div className="d-flex items-center gap-2">
                                  <h3 className="portal-tunnel-title m-0">Players Online</h3>
                                  <span className={`portal-badge ${isRunning && onlinePlayers.length > 0 ? 'portal-badge-live' : 'portal-badge-count'}`}>
                                    {isRunning ? `${onlinePlayers.length} Active` : 'Offline'}
                                  </span>
                                </div>
                                <p className="portal-tunnel-desc m-0 mt-0.5">
                                  Live connected players in the active Minecraft Bedrock world
                                </p>
                              </div>
                            </div>

                            {isRunning && onlinePlayers.length > 0 && (
                              <div className="portal-pulse-live-indicator">
                                <span className="pulse-dot-green" />
                                <span className="portal-live-text font-mono font-bold text-emerald text-xs">LIVE IN-GAME</span>
                              </div>
                            )}
                          </div>

                          {!isRunning ? (
                            <div className="portal-no-players-box text-center p-4">
                              <span className="portal-empty-icon">⚪</span>
                              <p className="text-sub text-xs m-0 mt-1">Server is currently offline. Start the server above to view live players.</p>
                            </div>
                          ) : onlinePlayers.length === 0 ? (
                            <div className="portal-no-players-box text-center p-4">
                              <span className="portal-empty-icon">🎮</span>
                              <p className="text-sub text-xs m-0 mt-1">No players currently in world. Jump in and be the first to join!</p>
                            </div>
                          ) : (
                            <div className="portal-online-players-grid mt-3">
                              {onlinePlayers.map((player) => (
                                <div key={player.name} className="portal-online-player-card">
                                  <PlayerSkinAvatar name={player.name} size={48} />
                                  <div className="portal-online-player-info">
                                    <div className="d-flex items-center gap-1.5">
                                      <h4 className="portal-online-player-name" title={player.name}>
                                        {player.name}
                                      </h4>
                                      {player.isOp && (
                                        <span className="portal-op-badge" title="Server Operator">
                                          👑 OP
                                        </span>
                                      )}
                                    </div>
                                    <span className="portal-online-player-status">
                                      <span className="dot-tiny-green" /> Active in World
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }

                  if (id === 'direct_ip') {
                    const hasActiveTunnel = status?.tunnel?.isRunning && status?.tunnel?.publicAddress;
                    return (
                      <div key="direct_ip" className="portal-section-block portal-tunnel-section mt-4">
                        <div className="portal-tunnel-card">
                          <div className="portal-tunnel-header">
                            <div className="d-flex items-center gap-2">
                              <span className="portal-tunnel-logo">🌐</span>
                              <div>
                                <h3 className="portal-tunnel-title m-0">Direct Server IP Connection</h3>
                                <span className="portal-tunnel-subtitle">Direct join with Server IP &amp; Port (PC, Mobile, Consoles via DNS)</span>
                              </div>
                            </div>
                            <span className={`badge ${hasActiveTunnel ? 'badge-success' : 'badge-secondary'}`}>
                              {hasActiveTunnel ? '● Public Online' : '● Tunnel Offline'}
                            </span>
                          </div>

                          {hasActiveTunnel ? (
                            <>
                              <div className="portal-tunnel-address-box">
                                <div className="d-flex items-center justify-between flex-wrap gap-2 mb-2">
                                  <span className="tunnel-label">Server Address:</span>
                                  <button
                                    type="button"
                                    className="btn-portal-copy-tag"
                                    onClick={async () => {
                                      await safeCopyToClipboard(status.tunnel.publicAddress);
                                      setActionMessage({ type: 'success', text: `📋 Copied server address "${status.tunnel.publicAddress}" to clipboard!` });
                                    }}
                                  >
                                    📋 Copy Full Address
                                  </button>
                                </div>

                                <div className="tunnel-address-pill">
                                  <span className="font-mono text-emerald font-bold">{status.tunnel.publicAddress}</span>
                                </div>

                                {status.tunnel.publicHost && status.tunnel.publicPort && (
                                  <div className="d-flex items-center gap-3 mt-2 text-xs text-sub flex-wrap">
                                    <span>Server IP: <strong className="text-white font-mono">{status.tunnel.publicHost}</strong></span>
                                    <span>•</span>
                                    <span>Port: <strong className="text-white font-mono">{status.tunnel.publicPort}</strong></span>
                                  </div>
                                )}
                              </div>

                              <div className="portal-xbox-guide mt-3">
                                <div className="guide-title">📖 How To Join With Server Address:</div>
                                <ol className="portal-guide-steps">
                                  <li>Launch <strong>Minecraft Bedrock</strong> on PC, iPhone, iPad, or Android.</li>
                                  <li>Go to the <strong>Play &gt; Servers</strong> tab and click <strong>Add Server</strong>.</li>
                                  <li>Enter any Server Name, paste Server Address <strong className="font-mono text-white">{status.tunnel.publicHost}</strong> and Port <strong className="font-mono text-white">{status.tunnel.publicPort}</strong>, then click <strong>Play</strong>!</li>
                                </ol>
                              </div>
                            </>
                          ) : (
                            <div className="portal-tunnel-address-box text-center p-4">
                              <p className="text-sub text-xs m-0">
                                Direct server tunnel is currently offline. Use <strong>Start All</strong> or ask an administrator to start the Playit tunnel.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }

                  if (id === 'xbox_bot') {
                    if (status?.showXboxBot === false || !status?.xboxBot) return null;
                    return (
                      <div key="xbox_bot" className="portal-section-block portal-xbox-section mt-4">
                        <div className="portal-xbox-card">
                          <div className="portal-xbox-header">
                            <div className="d-flex items-center gap-2">
                              <span className="portal-xbox-logo">🎮</span>
                              <div>
                                <h3 className="portal-xbox-title m-0">Console &amp; Mobile Quick-Join</h3>
                                <span className="portal-xbox-subtitle">Xbox Live Friend Relay Bot</span>
                              </div>
                            </div>

                            <div className="d-flex items-center gap-2">
                              <span
                                className={`badge ${
                                  status.xboxBot.state === 'running'
                                    ? 'badge-success'
                                    : status.xboxBot.authenticated
                                    ? 'badge-primary'
                                    : 'badge-secondary'
                                }`}
                              >
                                {status.xboxBot.state === 'running'
                                  ? '● Bot Online'
                                  : status.xboxBot.authenticated
                                  ? '● Ready'
                                  : '● Bot Offline'}
                              </span>
                            </div>
                          </div>

                          {status.xboxBot.authenticated && status.xboxBot.gamertag ? (
                            <div className="portal-xbox-profile-strip">
                              <div className="portal-xbox-avatar-wrap">
                                <img
                                  src={
                                    !botAvatarError && status.xboxBot.displayPic
                                      ? status.xboxBot.displayPic
                                      : 'https://images.placeholders.dev/?width=64&height=64&text=Xbox'
                                  }
                                  alt={status.xboxBot.gamertag}
                                  className="portal-xbox-avatar"
                                  onError={() => setBotAvatarError(true)}
                                />
                              </div>

                              <div className="portal-xbox-profile-info">
                                <span className="text-xs text-sub text-uppercase font-bold">
                                  Friend this Bot on Xbox Live:
                                </span>
                                <div className="portal-gamertag-row">
                                  <span className="portal-gamertag-text font-mono font-black">
                                    {status.xboxBot.gamertag}
                                  </span>
                                  <button
                                    type="button"
                                    className="btn-portal-copy-tag"
                                    onClick={async () => {
                                      await safeCopyToClipboard(status.xboxBot.gamertag);
                                      setActionMessage({
                                        type: 'success',
                                        text: `📋 Copied Gamertag "${status.xboxBot.gamertag}" to clipboard!`,
                                      });
                                    }}
                                    title="Copy Gamertag to clipboard"
                                  >
                                    📋 Copy Tag
                                  </button>
                                </div>
                              </div>
                            </div>
                          ) : status.xboxBot?.pendingLogin ? (
                            <div className="portal-xbox-unlinked-notice" style={{ background: 'rgba(234, 179, 8, 0.1)', borderColor: 'rgba(234, 179, 8, 0.3)' }}>
                              <p className="text-yellow font-bold text-xs m-0 mb-1">
                                ⚠️ Microsoft Device Authentication In Progress:
                              </p>
                              <p className="text-xs text-sub m-0">
                                To link this bot, visit <a href={status.xboxBot.pendingLogin.verificationUri} target="_blank" rel="noreferrer" className="text-primary font-bold">{status.xboxBot.pendingLogin.verificationUri}</a> and enter code <strong className="text-white font-mono">{status.xboxBot.pendingLogin.userCode}</strong>.
                              </p>
                            </div>
                          ) : (
                            <div className="portal-xbox-unlinked-notice">
                              <p className="text-sub text-xs m-0">
                                Xbox account is not yet connected by admin. Sign in to the Admin Dashboard (Xbox Live tab) to link your Microsoft account with 1 click.
                              </p>
                            </div>
                          )}

                          {/* Quick Step-by-Step Instructions */}
                          <div className="portal-xbox-guide">
                            <div className="guide-title">
                              <span>🚀 How to join from Xbox, PlayStation, Switch &amp; Mobile:</span>
                            </div>
                            <ol className="portal-guide-steps">
                              <li>
                                Search &amp; add <strong>{status.xboxBot.gamertag || 'the bot gamertag'}</strong> as a friend on Xbox Live.
                              </li>
                              <li>
                                Wait for the bot to auto-accept your friend request.
                              </li>
                              <li>
                                Open <strong>Minecraft Bedrock</strong> &gt; click the <strong>Friends</strong> tab &gt; join <strong>{status.xboxBot.gamertag || 'the bot'}</strong>'s game.
                              </li>
                              <li>
                                You will be seamlessly transferred directly into this server!
                              </li>
                            </ol>
                          </div>

                          {/* Bot Power Controls for Players / Operators in Portal */}
                          {status.xboxBot.authenticated && (
                            <div className="portal-xbox-actions">
                              <span className="text-xs text-sub font-semibold">Bot Controls:</span>
                              <div className="d-flex gap-2 flex-wrap">
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-xs"
                                  onClick={() => handleAction('start_bot')}
                                  disabled={
                                    actionLoading ||
                                    status.xboxBot.state === 'running' ||
                                    cooldown > 0
                                  }
                                  title={
                                    status.xboxBot.state === 'running'
                                      ? 'Bot is already broadcasting'
                                      : 'Start Xbox Live Friend Relay Bot'
                                  }
                                >
                                  ▶ {status.xboxBot.state === 'running' ? 'Bot Online' : 'Start Relay Bot'}
                                </button>

                                <button
                                  type="button"
                                  className="btn btn-secondary btn-xs"
                                  onClick={() => handleAction('restart_bot')}
                                  disabled={actionLoading || cooldown > 0}
                                  title="Restart Xbox Live Relay Bot"
                                >
                                  🔄 Restart Relay Bot
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }

                  if (id === 'installed_addons') {
                    const addons = status?.addons || [];
                    return (
                      <div key="installed_addons" className="portal-section-block portal-addons-section mt-4">
                        <div className="portal-tunnel-card portal-addons-card">
                          <div
                            className="portal-tunnel-header d-flex items-center justify-between cursor-pointer select-none"
                            onClick={() => setAddonsTileExpanded(!addonsTileExpanded)}
                            title="Click to toggle addons list"
                            style={{ cursor: 'pointer' }}
                          >
                            <div className="d-flex items-center gap-2">
                              <span className="portal-tunnel-logo">🧩</span>
                              <div>
                                <div className="d-flex items-center gap-2">
                                  <h3 className="portal-tunnel-title m-0">Active Server Addons</h3>
                                  <span className="portal-badge portal-badge-count">
                                    {addons.length} {addons.length === 1 ? 'Addon' : 'Addons'}
                                  </span>
                                </div>
                                <p className="portal-tunnel-desc m-0 mt-0.5">
                                  Installed and active custom addons for this world
                                </p>
                              </div>
                            </div>

                            <div className="d-flex items-center gap-2">
                              <button
                                type="button"
                                className="btn btn-secondary btn-xs portal-toggle-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAddonsTileExpanded(!addonsTileExpanded);
                                }}
                                title={addonsTileExpanded ? 'Collapse addons list' : 'Expand addons list'}
                              >
                                {addonsTileExpanded ? '▲ Collapse' : '▼ View Addons'}
                              </button>
                            </div>
                          </div>

                          {/* When collapsed, show compact summary chips preview */}
                          {!addonsTileExpanded && addons.length > 0 && (
                            <div
                              className="portal-addons-collapsed-preview pt-2 mt-2 border-top d-flex items-center gap-1.5 flex-wrap cursor-pointer"
                              onClick={() => setAddonsTileExpanded(true)}
                              title="Click to expand full details"
                            >
                              <span className="text-xs text-sub font-semibold">Active:</span>
                              {addons.map((a) => (
                                <span key={a.id} className="portal-addon-chip">
                                  {a.name} {a.version ? `(v${a.version})` : ''}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Full expanded list */}
                          {addonsTileExpanded && (
                            <>
                              {addons.length === 0 ? (
                                <div className="portal-addons-empty">
                                  <span className="portal-empty-icon">📦</span>
                                  <p className="text-sub text-sm m-0">No custom addons currently active on this world.</p>
                                </div>
                              ) : (
                                <div className="portal-addons-grid mt-3">
                                  {addons.map((addon) => (
                                    <div key={addon.id} className="portal-addon-card">
                                      <div className="portal-addon-icon-wrap">
                                        {addon.hasIcon && addon.iconUuid ? (
                                          <img
                                            src={`/api/addons/${addon.iconUuid}/icon`}
                                            alt={addon.name}
                                            className="portal-addon-icon-img"
                                            onError={(e) => {
                                              e.target.style.display = 'none';
                                              const fallback = e.target.parentElement.querySelector('.portal-addon-icon-fallback');
                                              if (fallback) fallback.style.display = 'flex';
                                            }}
                                          />
                                        ) : null}
                                        <div
                                          className="portal-addon-icon-fallback"
                                          style={{ display: addon.hasIcon && addon.iconUuid ? 'none' : 'flex' }}
                                        >
                                          🧩
                                        </div>
                                      </div>
                                      <div className="portal-addon-info">
                                        <div className="portal-addon-header-line">
                                          <h4 className="portal-addon-name" title={addon.name}>
                                            {addon.name}
                                          </h4>
                                          {addon.version && (
                                            <span className="portal-addon-version">v{addon.version}</span>
                                          )}
                                        </div>
                                        {addon.description ? (
                                          <p className="portal-addon-desc">{addon.description}</p>
                                        ) : (
                                          <p className="portal-addon-desc text-muted">Active world addon</p>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  }

                  return null;
                };

                return configuredSections
                  .filter((sec) => sec.enabled !== false)
                  .map((sec) => renderSection(sec.id));
              })()}

              {/* Cooldown Counter */}
              {cooldown > 0 && (
                <div className="portal-cooldown-notice">
                  <span className="cooldown-timer-icon">⏳</span>
                  <span>Anti-spam protection: Please wait <strong>{cooldown}s</strong> before issuing another request.</span>
                </div>
              )}

              {/* Authenticated user pill if logged in */}
              {user && (
                <div className="portal-auth-strip mt-6 pt-4 border-top">
                  <span className="text-xs text-muted">
                    Logged in as <strong className="text-white">{user.username}</strong> ({user.role})
                  </span>
                  {user.role === 'admin' && (
                    <button
                      className="btn-text-link text-xs ml-3"
                      onClick={() => navigate('/')}
                    >
                      Admin Dashboard →
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default PlayerPortal;
