import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';

export const XboxLive = () => {
  const { canControlServer } = useAuth();

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState(null); // { type: 'success' | 'error' | 'info', text: '' }

  // Config form state
  const [targetIp, setTargetIp] = useState('127.0.0.1');
  const [targetPort, setTargetPort] = useState(19132);
  const [listenPort, setListenPort] = useState(19133);
  const [autoAccept, setAutoAccept] = useState(true);
  const [autoSyncPlayit, setAutoSyncPlayit] = useState(true);
  const [showInPortal, setShowInPortal] = useState(true);
  const [serverName, setServerName] = useState('Bedrock Dedicated Realm');
  const [configSaving, setConfigSaving] = useState(false);

  // Manual token modal
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualTokenInput, setManualTokenInput] = useState('');
  const [manualTokenLoading, setManualTokenLoading] = useState(false);

  // Friends & Requests state
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [activeFriendTab, setActiveFriendTab] = useState('friends'); // 'friends' | 'requests'
  const [friendSearch, setFriendSearch] = useState('');
  const [acceptingXuid, setAcceptingXuid] = useState(null);
  const [avatarError, setAvatarError] = useState(false);
  const configLoadedRef = useRef(false);

  // Console & Public Access Channel Switcher ('all' | 'tunnel' | 'console')
  const [accessTab, setAccessTab] = useState('all');

  // Playit Tunnel state
  const [tunnelStatus, setTunnelStatus] = useState(null);
  const [tunnelLoading, setTunnelLoading] = useState(false);
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [secretInput, setSecretInput] = useState('');
  const [copyToast, setCopyToast] = useState(null);

  const fetchTunnelStatus = useCallback(async () => {
    try {
      const data = await api.Tunnel.getStatus();
      setTunnelStatus(data);
    } catch (_) {}
  }, []);

  const handleStartTunnel = async () => {
    setTunnelLoading(true);
    setToast(null);
    try {
      const res = await api.Tunnel.start();
      setTunnelStatus((prev) => ({ ...prev, ...res }));
      if (res.state === 'awaiting_claim' || res.claimUrl) {
        setToast({
          type: 'info',
          text: 'Playit claim link generated! Click the link below to link your agent.',
        });
      } else {
        setToast({
          type: 'success',
          text: '✓ Playit internet tunnel started successfully!',
        });
      }
      await fetchTunnelStatus();
    } catch (err) {
      setToast({
        type: 'error',
        text: err.message || 'Failed to start Playit internet tunnel.',
      });
    } finally {
      setTunnelLoading(false);
    }
  };

  const handleRegenerateClaim = async () => {
    setTunnelLoading(true);
    setToast(null);
    try {
      const res = await api.Tunnel.startClaim();
      setTunnelStatus((prev) => ({ ...prev, ...res }));
      setToast({
        type: 'info',
        text: '✓ Generated a fresh Playit.gg claim link! Click the link below to link your agent.',
      });
      await fetchTunnelStatus();
    } catch (err) {
      setToast({
        type: 'error',
        text: err.message || 'Failed to generate new claim link.',
      });
    } finally {
      setTunnelLoading(false);
    }
  };

  const handleStopTunnel = async () => {
    setTunnelLoading(true);
    setToast(null);
    try {
      await api.Tunnel.stop();
      setToast({
        type: 'info',
        text: 'Playit internet tunnel stopped.',
      });
      await fetchTunnelStatus();
    } catch (err) {
      setToast({
        type: 'error',
        text: err.message || 'Failed to stop tunnel.',
      });
    } finally {
      setTunnelLoading(false);
    }
  };

  const handleRestartTunnel = async () => {
    setTunnelLoading(true);
    setToast(null);
    try {
      await api.Tunnel.restart();
      setToast({
        type: 'success',
        text: '✓ Playit tunnel restarted.',
      });
      await fetchTunnelStatus();
    } catch (err) {
      setToast({
        type: 'error',
        text: err.message || 'Failed to restart tunnel.',
      });
    } finally {
      setTunnelLoading(false);
    }
  };

  const handleResetTunnel = async () => {
    if (!window.confirm('Reset Playit agent configuration? This will clear the agent token and let you generate a new claim link or paste a new secret.')) {
      return;
    }
    setTunnelLoading(true);
    try {
      await api.Tunnel.reset();
      setToast({
        type: 'info',
        text: 'Agent configuration reset. Generated new claim code.',
      });
      await fetchTunnelStatus();
    } catch (err) {
      setToast({
        type: 'error',
        text: err.message || 'Failed to reset tunnel agent.',
      });
    } finally {
      setTunnelLoading(false);
    }
  };

  const handleSaveSecret = async (e) => {
    e.preventDefault();
    if (!secretInput.trim()) return;
    setTunnelLoading(true);
    try {
      await api.Tunnel.submitSecret(secretInput.trim());
      setShowSecretModal(false);
      setSecretInput('');
      setToast({
        type: 'success',
        text: '✓ Secret key saved and Playit tunnel initialized!',
      });
      await fetchTunnelStatus();
    } catch (err) {
      setToast({
        type: 'error',
        text: err.message || 'Failed to save secret key.',
      });
    } finally {
      setTunnelLoading(false);
    }
  };

  const handleToggleTunnelAutoStart = async (e) => {
    const val = e.target.checked;
    try {
      await api.Tunnel.updateConfig({ autoStart: val });
      setTunnelStatus((prev) => prev ? {
        ...prev,
        config: { ...prev.config, autoStart: val }
      } : prev);
    } catch (_) {}
  };

  const handleToggleTunnelPortal = async (e) => {
    const val = e.target.checked;
    try {
      await api.Tunnel.updateConfig({ showInPortal: val });
      setTunnelStatus((prev) => prev ? {
        ...prev,
        config: { ...prev.config, showInPortal: val }
      } : prev);
    } catch (_) {}
  };

  const handleCopyAddress = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopyToast(`Copied "${text}" to clipboard!`);
    setTimeout(() => setCopyToast(null), 3000);
  };

  const fetchStatus = useCallback(async () => {
    try {
      const data = await api.Xbox.getStatus();
      setStatus(data);
      // ONLY initialize form input values on initial load so background polling NEVER overwrites user typing
      if (data && data.config && !configLoadedRef.current) {
        configLoadedRef.current = true;
        setTargetIp(data.config.targetIp || '127.0.0.1');
        setTargetPort(data.config.targetPort || 19132);
        setListenPort(data.config.listenPort || 19133);
        setAutoAccept(Boolean(data.config.autoAcceptFriends));
        if (data.config.autoSyncPlayit !== undefined) {
          setAutoSyncPlayit(Boolean(data.config.autoSyncPlayit));
        }
        if (data.config.showInPortal !== undefined) {
          setShowInPortal(Boolean(data.config.showInPortal));
        }
        setServerName(data.config.serverName || 'Bedrock Dedicated Realm');
      }
    } catch (err) {
      console.error('Failed to load Xbox bot status:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchFriends = useCallback(async (isManual = false) => {
    setFriendsLoading(true);
    try {
      const data = isManual ? await api.Xbox.syncFriends() : await api.Xbox.getFriends();
      if (data) {
        if (Array.isArray(data.friends)) setFriends(data.friends);
        if (Array.isArray(data.requests)) setRequests(data.requests);
      }
    } catch (err) {
      console.error('Failed to load friends roster:', err);
    } finally {
      setFriendsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchTunnelStatus();
    const interval = setInterval(() => {
      fetchStatus();
      fetchTunnelStatus();
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchTunnelStatus]);

  useEffect(() => {
    if (status?.account?.authenticated) {
      fetchFriends();
    }
  }, [status?.account?.authenticated, fetchFriends]);

  const handleStartLogin = async () => {
    setActionLoading(true);
    setToast(null);
    try {
      const res = await api.Xbox.startLogin();
      if (res && res.pendingLogin) {
        setStatus((prev) => ({
          ...prev,
          pendingLogin: res.pendingLogin,
        }));
        setToast({ type: 'info', text: `🔑 Device code [${res.pendingLogin.userCode}] generated! Click below to sign in.` });
      } else if (res && res.authenticated) {
        setToast({ type: 'success', text: `✓ Signed in as ${res.account?.gamertag || 'Xbox Bot'}!` });
      } else {
        setToast({ type: 'info', text: res?.message || 'Device code generated! Follow the instructions below to sign in.' });
      }
      await fetchStatus();
    } catch (err) {
      setToast({ type: 'error', text: err.message || 'Failed to start Microsoft login.' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelLogin = async () => {
    try {
      await api.Xbox.cancelLogin();
      setToast({ type: 'info', text: 'Device login cancelled.' });
      await fetchStatus();
    } catch (err) {
      setToast({ type: 'error', text: err.message });
    }
  };

  const handleManualTokenSubmit = async (e) => {
    e.preventDefault();
    setManualTokenLoading(true);
    try {
      await api.Xbox.setToken(manualTokenInput.trim());
      setToast({ type: 'success', text: '✓ Xbox Live account linked via manual token!' });
      setShowManualModal(false);
      setManualTokenInput('');
      await fetchStatus();
    } catch (err) {
      setToast({ type: 'error', text: err.message || 'Failed to apply manual token.' });
    } finally {
      setManualTokenLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!window.confirm('Are you sure you want to unlink the Microsoft account? The bot will stop.')) {
      return;
    }
    setActionLoading(true);
    try {
      await api.Xbox.logout();
      setToast({ type: 'success', text: 'Microsoft account unlinked successfully.' });
      setFriends([]);
      setRequests([]);
      await fetchStatus();
    } catch (err) {
      setToast({ type: 'error', text: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveConfig = async (e) => {
    if (e) e.preventDefault();
    setConfigSaving(true);
    try {
      const cleanIp = targetIp.trim();
      const cleanPort = parseInt(targetPort, 10) || 19132;
      const cleanListen = parseInt(listenPort, 10) || 19133;
      const cleanName = serverName.trim() || 'Bedrock Dedicated Realm';

      const res = await api.Xbox.updateConfig({
        targetIp: cleanIp,
        targetPort: cleanPort,
        listenPort: cleanListen,
        autoAcceptFriends: autoAccept,
        autoSyncPlayit: autoSyncPlayit,
        showInPortal: showInPortal,
        serverName: cleanName,
      });

      if (res && res.config) {
        setTargetIp(res.config.targetIp || cleanIp);
        setTargetPort(res.config.targetPort || cleanPort);
        setListenPort(res.config.listenPort || cleanListen);
        setAutoAccept(Boolean(res.config.autoAcceptFriends));
        if (res.config.autoSyncPlayit !== undefined) {
          setAutoSyncPlayit(Boolean(res.config.autoSyncPlayit));
        }
        if (res.config.showInPortal !== undefined) {
          setShowInPortal(Boolean(res.config.showInPortal));
        }
        setServerName(res.config.serverName || cleanName);
      }

      setToast({
        type: 'success',
        text: res?.message || `✓ Destination & Redirection Engine saved! Redirecting friends to ${cleanIp}:${cleanPort}.`,
      });

      setStatus((prev) => prev ? {
        ...prev,
        config: res?.config || {
          ...prev.config,
          targetIp: cleanIp,
          targetPort: cleanPort,
          listenPort: cleanListen,
          serverName: cleanName,
          autoAcceptFriends: autoAccept,
          showInPortal: showInPortal,
        }
      } : prev);
    } catch (err) {
      setToast({ type: 'error', text: err.message || 'Failed to save configuration.' });
    } finally {
      setConfigSaving(false);
    }
  };

  const handleSetDefaults = () => {
    setTargetIp('127.0.0.1');
    setTargetPort(19132);
    setListenPort(19133);
    setToast({
      type: 'info',
      text: 'Filled local Bedrock Server defaults (127.0.0.1:19132). Click "Save Settings" to apply.',
    });
  };

  const handleBotAction = async (actionType) => {
    setActionLoading(true);
    setToast(null);
    try {
      let res;
      if (actionType === 'start') res = await api.Xbox.start();
      if (actionType === 'stop') res = await api.Xbox.stop();
      if (actionType === 'restart') res = await api.Xbox.restart();
      setToast({ type: 'success', text: res?.message || `Bot ${actionType.toUpperCase()} executed successfully.` });
      await fetchStatus();
      if (actionType === 'start' || actionType === 'restart') {
        fetchFriends();
      }
    } catch (err) {
      setToast({ type: 'error', text: err.message || `Failed to ${actionType} bot.` });
    } finally {
      setActionLoading(false);
    }
  };

  const handleSyncFriends = async () => {
    setFriendsLoading(true);
    try {
      await fetchFriends(true);
      setToast({
        type: 'success',
        text: `✓ Friends synced with Xbox Live! Total: ${friends.length} friends, ${requests.length} requests.`,
      });
    } catch (err) {
      setToast({ type: 'error', text: err.message || 'Failed to sync friends' });
    } finally {
      setFriendsLoading(false);
    }
  };

  const handleAcceptRequest = async (xuid, gamertag) => {
    setAcceptingXuid(xuid);
    try {
      const res = await api.Xbox.acceptFriend(xuid);
      setToast({ type: 'success', text: `✓ Accepted friend request from ${gamertag || 'player'}!` });
      if (res) {
        if (Array.isArray(res.friends)) setFriends(res.friends);
        if (Array.isArray(res.requests)) setRequests(res.requests);
      }
    } catch (err) {
      setToast({ type: 'error', text: err.message || 'Failed to accept friend request.' });
    } finally {
      setAcceptingXuid(null);
    }
  };

  const copyDeviceCode = () => {
    const codeObj = status?.pendingLogin;
    if (codeObj?.userCode) {
      navigator.clipboard.writeText(codeObj.userCode);
      const uri = codeObj.verificationUri || `https://www.microsoft.com/link?otc=${codeObj.userCode}`;
      setToast({
        type: 'success',
        text: `📋 Copied code [${codeObj.userCode}] to clipboard! Opening Microsoft login...`,
      });
      window.open(uri, '_blank');
    }
  };

  const botState = status?.state || 'offline';
  const isRunning = botState === 'running';
  const isAuth = Boolean(status?.account?.authenticated);
  const pendingLogin = status?.pendingLogin;

  // Filtered lists
  const filteredFriends = friends.filter((f) => {
    if (!friendSearch) return true;
    const term = friendSearch.toLowerCase();
    return (f.gamertag && f.gamertag.toLowerCase().includes(term)) ||
           (f.displayName && f.displayName.toLowerCase().includes(term)) ||
           (f.xuid && f.xuid.includes(term));
  });

  const filteredRequests = requests.filter((r) => {
    if (!friendSearch) return true;
    const term = friendSearch.toLowerCase();
    return (r.gamertag && r.gamertag.toLowerCase().includes(term)) ||
           (r.displayName && r.displayName.toLowerCase().includes(term)) ||
           (r.xuid && r.xuid.includes(term));
  });

  if (loading) {
    return (
      <div className="loading-container py-16">
        <div className="spinner"></div>
        <p className="loading-text mt-3">Connecting to Xbox Live Bot Service...</p>
      </div>
    );
  }

  return (
    <div className="page-container xbox-live-page">
      {/* Page Header */}
      <div className="page-header-row mb-6">
        <div>
          <div className="d-flex items-center gap-3">
            <span className="xbox-sphere-icon">🌐</span>
            <div>
              <h1 className="page-main-title m-0">Console &amp; Public Access</h1>
              <p className="page-sub-title m-0">
                Console Crossplay via Xbox Live Friend Relay Bot &amp; Zero-Port-Forward Public Internet Tunnels (Playit.gg)
              </p>
            </div>
          </div>
        </div>

        {/* Top Power Controls */}
        <div className="header-meta-actions">
          {canControlServer && (
            <div className="d-flex items-center gap-2">
              <button
                type="button"
                className="btn btn-success btn-sm"
                onClick={() => handleBotAction('start')}
                disabled={actionLoading || isRunning || !isAuth}
                title={!isAuth ? 'Connect Microsoft account first' : 'Start redirector bot'}
              >
                <span>▶ Start Bot</span>
              </button>
              <button
                type="button"
                className="btn btn-warning btn-sm"
                onClick={() => handleBotAction('restart')}
                disabled={actionLoading || !isRunning}
                title="Restart bot"
              >
                <span>🔄 Restart Bot</span>
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => handleBotAction('stop')}
                disabled={actionLoading || !isRunning}
                title="Stop bot"
              >
                <span>⏹ Stop Bot</span>
              </button>
            </div>
          )}

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => { fetchStatus(); fetchTunnelStatus(); }}
            disabled={actionLoading || tunnelLoading}
            title="Refresh status"
          >
            <span className={`refresh-glyph ${actionLoading || tunnelLoading ? 'spinning' : ''}`}>↻</span> Sync
          </button>
        </div>
      </div>

      {/* Notifications */}
      {toast && (
        <div className={`alert-toast alert-${toast.type} mb-5`}>
          <span className="toast-icon">
            {toast.type === 'success' && '✓'}
            {toast.type === 'error' && '⚠️'}
            {toast.type === 'info' && 'ℹ️'}
          </span>
          <span className="toast-text">{toast.text}</span>
          <button className="toast-dismiss" onClick={() => setToast(null)}>✕</button>
        </div>
      )}

      {copyToast && (
        <div className="alert-toast alert-success mb-5">
          <span className="toast-icon">✓</span>
          <span className="toast-text">{copyToast}</span>
          <button className="toast-dismiss" onClick={() => setCopyToast(null)}>✕</button>
        </div>
      )}

      {/* ACCESS CHANNELS SWITCHER TABS */}
      <div className="access-channel-switcher mb-6">
        <div className="channel-tab-group">
          <button
            type="button"
            className={`channel-tab-btn ${accessTab === 'all' ? 'active' : ''}`}
            onClick={() => setAccessTab('all')}
          >
            <span>🌐</span> All Access Channels
          </button>
          <button
            type="button"
            className={`channel-tab-btn ${accessTab === 'tunnel' ? 'active' : ''}`}
            onClick={() => setAccessTab('tunnel')}
          >
            <span>📡</span> Public Internet Tunnel (Playit.gg)
            {tunnelStatus?.isRunning && tunnelStatus?.publicAddress && (
              <span className="channel-pill-online">Online</span>
            )}
          </button>
          <button
            type="button"
            className={`channel-tab-btn ${accessTab === 'console' ? 'active' : ''}`}
            onClick={() => setAccessTab('console')}
          >
            <span>🎮</span> Console Friend Relay (Xbox Bot)
            {isRunning && (
              <span className="channel-pill-online">Online</span>
            )}
          </button>
        </div>
      </div>

      {/* SECTION 1: PUBLIC INTERNET TUNNEL (PLAYIT.GG ZERO-PORT-FORWARD TUNNEL) */}
      {(accessTab === 'all' || accessTab === 'tunnel') && (
        <div className={`modern-card tunnel-hero-card mb-6 ${tunnelStatus?.isRunning ? 'tunnel-online' : ''}`}>
          <div className="card-header-styled">
            <div className="header-badge-title">
              <span className="icon-badge">🌐</span>
              <div>
                <h2 className="m-0 text-base font-bold text-white">Public Internet Access (Zero Port Forwarding)</h2>
                <span className="text-xs text-sub">
                  Powered by Playit.gg • Bypasses router port forwarding, firewalls, and CGNAT
                </span>
              </div>
            </div>
            <div className="d-flex items-center gap-2">
              <span className={`badge ${
                tunnelStatus?.isRunning && tunnelStatus?.publicAddress
                  ? 'badge-success'
                  : tunnelStatus?.claimUrl || tunnelStatus?.state === 'awaiting_claim'
                  ? 'badge-warning'
                  : tunnelStatus?.isRunning && tunnelStatus?.isClaimed
                  ? 'badge-info'
                  : tunnelStatus?.state === 'starting'
                  ? 'badge-info'
                  : 'badge-secondary'
              } text-xs`}>
                {tunnelStatus?.isRunning && tunnelStatus?.publicAddress
                  ? '🟢 Tunnel Online'
                  : tunnelStatus?.claimUrl || tunnelStatus?.state === 'awaiting_claim'
                  ? '🟡 Setup: Claim Agent'
                  : tunnelStatus?.isRunning && tunnelStatus?.isClaimed
                  ? '🔵 Agent Connected'
                  : tunnelStatus?.state === 'starting'
                  ? '🔄 Initializing...'
                  : '⚪ Tunnel Offline'}
              </span>
            </div>
          </div>

          <div className="card-body p-5">
            {/* CASE 1A: TUNNEL IS ONLINE & BROADCASTING PUBLIC ADDRESS */}
            {tunnelStatus?.isRunning && tunnelStatus?.publicAddress ? (
              <div className="tunnel-active-display">
                <div className="tunnel-address-banner p-4 rounded mb-3">
                  <div className="d-flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <span className="text-xs text-sub uppercase tracking-wider font-bold d-block mb-1">
                        ⚡ Public Minecraft Bedrock Address (Share With Players):
                      </span>
                      <span className="tunnel-address-text font-mono text-xl font-bold text-emerald">
                        {tunnelStatus.publicAddress}
                      </span>
                    </div>
                    {tunnelStatus.publicAddress && (
                      <button
                        type="button"
                        className="btn btn-primary btn-tunnel-copy"
                        onClick={() => handleCopyAddress(tunnelStatus.publicAddress)}
                        title="Copy public address to clipboard"
                      >
                        📋 Copy Server Address
                      </button>
                    )}
                  </div>

                  {tunnelStatus.publicHost && tunnelStatus.publicPort && (
                    <div className="d-flex items-center gap-3 mt-3 pt-3 border-top flex-wrap text-xs text-sub">
                      <span>
                        Server IP / Domain: <strong className="text-white font-mono">{tunnelStatus.publicHost}</strong>
                      </span>
                      <span>•</span>
                      <span>
                        Port (UDP): <strong className="text-white font-mono">{tunnelStatus.publicPort}</strong>
                      </span>
                    </div>
                  )}
                </div>

                <p className="text-xs text-sub mb-4">
                  ✓ <strong>Any player in the world</strong> can now join your Bedrock server from Windows PC, iOS, or Android by entering this address into their in-game <strong>Servers</strong> tab. No router setup required.
                </p>

                {canControlServer && (
                  <div className="d-flex items-center justify-between flex-wrap gap-2 pt-2 border-top">
                    <div className="d-flex items-center gap-2">
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={handleStopTunnel}
                        disabled={tunnelLoading}
                      >
                        ⏹ Stop Tunnel
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={handleRestartTunnel}
                        disabled={tunnelLoading}
                      >
                        🔄 Restart Tunnel
                      </button>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs text-muted"
                      onClick={handleResetTunnel}
                      disabled={tunnelLoading}
                      title="Clear current Playit agent token and re-claim"
                    >
                      Reset Agent
                    </button>
                  </div>
                )}
              </div>
            ) : tunnelStatus?.claimUrl || tunnelStatus?.state === 'awaiting_claim' ? (
              /* CASE 2: AWAITING 1-CLICK CLAIM */
              <div className="tunnel-claim-box p-4 rounded mb-2">
                <div className="d-flex items-center gap-2 mb-2">
                  <span className="spinner-sm" />
                  <h4 className="m-0 text-white font-bold text-sm">Step 1: Link Agent with Playit.gg</h4>
                </div>
                <p className="text-xs text-sub mb-3">
                  Your local Playit agent is running and waiting for you to link it to your Playit.gg account. Click the button below, confirm in your browser, and the tunnel will connect!
                </p>

                <div className="d-flex items-center gap-3 flex-wrap mb-3">
                  <a
                    href={tunnelStatus.claimUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-primary py-2 px-4"
                  >
                    🔗 Open Playit.gg Claim Link ↗
                  </a>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleRegenerateClaim}
                    disabled={tunnelLoading}
                    title="Generate a fresh claim link and code"
                  >
                    🔄 Regenerate Link
                  </button>
                  <span className="text-xs font-mono text-muted">
                    Code: <strong className="text-white font-bold">{tunnelStatus.claimCode}</strong>
                  </span>
                </div>

                <div className="d-flex items-center justify-between flex-wrap gap-2 pt-2 border-top text-xs text-muted">
                  <span>Waiting for claim approval... Automatically connects once approved.</span>
                  <button
                    type="button"
                    className="btn-link text-xs text-emerald"
                    onClick={() => setShowSecretModal(true)}
                  >
                    Already have a Secret Key? Enter manually
                  </button>
                </div>
              </div>
            ) : tunnelStatus?.isRunning && !tunnelStatus?.publicAddress ? (
              /* CASE 1B: AGENT CONNECTED BUT WAITING FOR BEDROCK TUNNEL ON PLAYIT */
              <div className="tunnel-claim-box p-4 rounded mb-2">
                <div className="d-flex items-center justify-between flex-wrap gap-2 mb-2">
                  <div className="d-flex items-center gap-2">
                    <span className="badge badge-success text-xs">🟢 Agent Connected</span>
                    <h4 className="m-0 text-white font-bold text-sm">Add Bedrock Tunnel on Playit.gg</h4>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-xs"
                    onClick={handleRestartTunnel}
                    disabled={tunnelLoading}
                  >
                    🔄 Sync Tunnels
                  </button>
                </div>
                <p className="text-xs text-sub mb-3">
                  Your Playit agent is connected and online! To give players a public connection address, open your Playit.gg dashboard, click <strong>"Add Tunnel"</strong>, select <strong>Minecraft Bedrock</strong> (UDP port 19132), and your address will appear here automatically.
                </p>
                <div className="d-flex items-center gap-3 flex-wrap mb-2">
                  <a
                    href="https://playit.gg/manage/tunnels"
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-primary py-2 px-4"
                  >
                    🌐 Open Playit.gg Tunnels Dashboard ↗
                  </a>
                  {canControlServer && (
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={handleStopTunnel}
                      disabled={tunnelLoading}
                    >
                      ⏹ Stop Tunnel
                    </button>
                  )}
                  {canControlServer && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs text-muted"
                      onClick={handleResetTunnel}
                      disabled={tunnelLoading}
                    >
                      Reset Agent
                    </button>
                  )}
                </div>
              </div>
            ) : (
              /* CASE 3: TUNNEL IS OFFLINE */
              <div className="tunnel-offline-box">
                <p className="text-sm text-sub mb-4">
                  Want friends outside your home Wi-Fi to join your Minecraft server without touching router port forwarding, firewalls, or ISP CGNAT? Open an encrypted outbound tunnel with 1 click.
                </p>

                <div className="d-flex items-center justify-between flex-wrap gap-3">
                  {canControlServer && (
                    <button
                      type="button"
                      className="btn btn-primary py-3 px-5"
                      onClick={handleStartTunnel}
                      disabled={tunnelLoading}
                    >
                      {tunnelLoading ? (
                        <>
                          <span className="spinner-sm mr-2" /> Connecting Playit Tunnel...
                        </>
                      ) : (
                        <>
                          <span className="mr-2">🌐</span> Open Server to Internet (Start Tunnel)
                        </>
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setShowSecretModal(true)}
                    title="Manually paste a Playit Secret Key"
                  >
                    🔑 Enter Secret Key Manually
                  </button>
                </div>
              </div>
            )}

            {/* Quick Settings Bar */}
            <div className="tunnel-footer-settings mt-4 pt-3 border-top d-flex items-center justify-between flex-wrap gap-3 text-xs text-sub">
              <label className="d-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={tunnelStatus?.config?.autoStart ?? true}
                  onChange={handleToggleTunnelAutoStart}
                  disabled={!canControlServer}
                />
                <span>Auto-open tunnel when Bedrock server starts</span>
              </label>

              <label className="d-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={tunnelStatus?.config?.showInPortal ?? true}
                  onChange={handleToggleTunnelPortal}
                  disabled={!canControlServer}
                />
                <span>Show public address on Player Quick-Start Portal (/server)</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 2: CONSOLE FRIEND RELAY (XBOX LIVE BOT) */}
      {(accessTab === 'all' || accessTab === 'console') && (
        <>
          {/* Status Hero Bar */}
          <div className={`hero-status-panel mb-6 state-${botState}`}>
            <div className="hero-top-bar d-flex items-center justify-between flex-wrap gap-4">
              <div className="hero-status-identity">
                <div className="radar-status-dot">
                  <span className="radar-core" />
                  <span className="radar-wave" />
                </div>
                <div>
                  <div className="hero-state-title">
                    Bot Status:{' '}
                    <span className="state-badge-text">
                      {isRunning ? 'ONLINE & BROADCASTING' : botState === 'awaiting_login' ? 'WAITING FOR SIGN-IN' : botState.toUpperCase()}
                    </span>
                  </div>
                  <div className="hero-engine-desc">
                    <span>Account: {isAuth ? (<strong>{status.account.gamertag}</strong>) : 'Not Linked'}</span>
                    <span className="bullet-sep">•</span>
                    <span>Listen Port: UDP {status?.config?.listenPort || 19133}</span>
                    <span className="bullet-sep">•</span>
                    <span>Destination: <strong>{status?.config?.targetIp || '127.0.0.1'}:{status?.config?.targetPort || 19132}</strong></span>
                  </div>
                </div>
              </div>

              {/* Bot Power Controls directly in Status Hero Panel */}
              <div className="d-flex items-center gap-3 flex-wrap">
                {canControlServer && isAuth && (
                  <div className="hero-bot-controls d-flex items-center gap-2">
                    {!isRunning ? (
                      <button
                        type="button"
                        className="btn btn-success btn-sm font-bold d-flex items-center gap-1.5"
                        onClick={() => handleBotAction('start')}
                        disabled={actionLoading}
                      >
                        <span>▶ Start Bot</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-danger btn-sm font-bold d-flex items-center gap-1.5"
                        onClick={() => handleBotAction('stop')}
                        disabled={actionLoading}
                      >
                        <span>⏹ Stop Bot</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-warning btn-sm d-flex items-center gap-1.5"
                      onClick={() => handleBotAction('restart')}
                      disabled={actionLoading || !isRunning}
                      title="Restart bot"
                    >
                      <span>🔄 Restart</span>
                    </button>
                  </div>
                )}

                <div className="hero-meta-strip p-0 m-0 border-0 bg-transparent">
                  <div className="meta-pill">
                    <span className="meta-icon">👥</span>
                    <div className="meta-info">
                      <span className="meta-title">Redirects</span>
                      <span className="meta-highlight">{status?.stats?.totalRedirects || 0}</span>
                    </div>
                  </div>
                  <div className="meta-pill">
                    <span className="meta-icon">🎮</span>
                    <div className="meta-info">
                      <span className="meta-title">Friends</span>
                      <span className="meta-highlight">{friends.length || status?.stats?.friendsCount || 0}</span>
                    </div>
                  </div>
                  {requests.length > 0 && (
                    <div className="meta-pill" style={{ borderColor: 'rgba(234, 179, 8, 0.4)' }}>
                      <span className="meta-icon">🔔</span>
                      <div className="meta-info">
                        <span className="meta-title">Requests</span>
                        <span className="meta-highlight" style={{ color: '#fbbf24' }}>{requests.length}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

      {/* CARD 1: MICROSOFT ACCOUNT PROFILE (FULL-WIDTH HERO BANNER) */}
      <div className="modern-card xbox-account-banner mb-6">
        <div className="card-header-styled">
          <div className="header-badge-title">
            <span className="icon-badge">🟢</span>
            <h2>Microsoft Xbox Live Account</h2>
          </div>
          <div className="d-flex items-center gap-2">
            <span className={`badge ${isAuth ? 'badge-success' : 'badge-warning'} text-xs`}>
              {isAuth ? 'Linked ✓' : 'Disconnected'}
            </span>
            {isAuth && canControlServer && (
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={handleLogout}
                disabled={actionLoading}
              >
                Disconnect
              </button>
            )}
          </div>
        </div>

        <div className="card-body p-5">
          {isAuth ? (
            /* Authenticated Account Profile Card */
            <div className="xbox-profile-display-box">
              <div className="profile-avatar-row">
                <div className="xbox-gamerpic-container">
                  <img
                    src={
                      !avatarError && status.account.displayPic
                        ? status.account.displayPic
                        : 'https://images.placeholders.dev/?width=80&height=80&text=Xbox'
                    }
                    alt={status.account.gamertag}
                    className="xbox-gamerpic-avatar"
                    onError={() => setAvatarError(true)}
                  />
                  <span className="xbox-gamerpic-badge" title="Online on Xbox Live" />
                </div>

                <div className="profile-info">
                  <div className="profile-gamertag-wrap">
                    <span className="profile-gamertag">
                      {status.account.gamertag}
                    </span>
                    <button
                      type="button"
                      className="btn-code-copy"
                      onClick={() => {
                        navigator.clipboard.writeText(status.account.gamertag);
                        setToast({ type: 'success', text: `📋 Copied Gamertag "${status.account.gamertag}" to clipboard!` });
                      }}
                      title="Copy Gamertag to share with players"
                    >
                      📋 Copy Gamertag
                    </button>
                  </div>

                  <div className="profile-meta-row">
                    <span className="profile-xuid-tag">XUID: {status.account.xuid}</span>
                    {status.account.gamerscore && status.account.gamerscore !== '0' && (
                      <span className="profile-gamerscore-tag">🏆 {status.account.gamerscore} G</span>
                    )}
                    <span className="badge badge-success text-xs">NetherNet Live</span>
                  </div>
                </div>

                {/* Bot Controls Toolbar inside Bot Profile Info Area */}
                <div className="profile-actions-toolbar ml-auto d-flex items-center gap-2 flex-wrap">
                  {canControlServer && (
                    <>
                      {!isRunning ? (
                        <button
                          type="button"
                          className="btn btn-success btn-sm font-bold d-flex items-center gap-1.5"
                          onClick={() => handleBotAction('start')}
                          disabled={actionLoading}
                        >
                          <span>▶</span>
                          <span>Start Bot</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-danger btn-sm font-bold d-flex items-center gap-1.5"
                          onClick={() => handleBotAction('stop')}
                          disabled={actionLoading}
                        >
                          <span>⏹</span>
                          <span>Stop Bot</span>
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-warning btn-sm d-flex items-center gap-1.5"
                        onClick={() => handleBotAction('restart')}
                        disabled={actionLoading || !isRunning}
                        title="Restart bot"
                      >
                        <span>🔄</span>
                        <span>Restart</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Player Connection Instructions Callout */}
              <div className="xbox-banner-guide">
                <div className="d-flex items-center gap-2 mb-2">
                  <span className="text-emerald font-bold text-xs uppercase tracking-wide">📖 How Players Connect</span>
                </div>
                <div className="xbox-steps-grid">
                  <div className="xbox-step-pill">
                    <span className="step-num">1</span>
                    <span className="step-txt">Add <strong className="text-white font-mono">{status.account.gamertag}</strong> on Xbox Live</span>
                  </div>
                  <div className="xbox-step-pill">
                    <span className="step-num">2</span>
                    <span className="step-txt">Bot auto-accepts friend request</span>
                  </div>
                  <div className="xbox-step-pill">
                    <span className="step-num">3</span>
                    <span className="step-txt">Open Bedrock &gt; <strong>Friends Tab</strong></span>
                  </div>
                  <div className="xbox-step-pill">
                    <span className="step-num">4</span>
                    <span className="step-txt">Click join &gt; auto-redirected to server!</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Disconnected - Device Code flow or manual token */
            <div>
              <p className="text-sub text-sm mb-4">
                Connect an Xbox Live Microsoft account. Once connected, the bot signs in to Xbox Live and announces your Bedrock server to all of its friends.
              </p>

              {pendingLogin ? (
                /* Active Device Code Prompt */
                <div className="xbox-device-code-box p-5 rounded mb-4" style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                  <div className="d-flex items-center gap-2 mb-3">
                    <span className="spinner-sm" />
                    <h4 className="m-0 text-white font-bold">Waiting for Microsoft Sign-In</h4>
                  </div>
                  <p className="text-xs text-sub mb-3">
                    Visit <a href={pendingLogin.verificationUri} target="_blank" rel="noreferrer" className="text-primary font-bold">{pendingLogin.verificationUri}</a> and enter this 8-character code:
                  </p>

                  <div className="device-code-display mb-4">
                    <span className="code-text font-mono" style={{ fontSize: '2rem', letterSpacing: '0.2em' }}>{pendingLogin.userCode}</span>
                  </div>

                  <div className="d-flex gap-3 flex-wrap">
                    <button
                      type="button"
                      className="btn btn-primary btn-lg flex-1"
                      onClick={copyDeviceCode}
                    >
                      📋 Copy Code &amp; Open Microsoft Login ↗
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleCancelLogin}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                /* Connect Buttons */
                <div className="d-flex gap-3 flex-wrap">
                  <button
                    type="button"
                    className="btn btn-primary flex-1 py-3 font-bold d-flex items-center justify-center gap-2"
                    onClick={handleStartLogin}
                    disabled={actionLoading}
                  >
                    {actionLoading ? (
                      <>
                        <span className="spinner-sm" />
                        <span>Generating Microsoft Device Code (1-Click Link)...</span>
                      </>
                    ) : (
                      <>
                        <span className="icon">🔑</span>
                        <span>Connect Microsoft Account (1-Click Link)</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* BALANCED 2-COLUMN CONTENT GRID */}
      <div className="xbox-content-grid">
        {/* LEFT COLUMN: DESTINATION & REDIRECTION ENGINE */}
        <div className="modern-card">
          <div className="card-header-styled">
            <div className="header-badge-title">
              <span className="icon-badge">🎯</span>
              <h2>Destination &amp; Redirection Engine</h2>
            </div>
            <button
              type="button"
              className="btn-preset-pill"
              onClick={handleSetDefaults}
              title="Use Bedrock local server defaults"
            >
              ⚙️ Use BDS Defaults
            </button>
          </div>

          <div className="card-body p-5">
            <p className="text-sub text-xs mb-4">
              Configure where the bot transfers players when they click "Join" on its Xbox profile. Saving automatically updates and reloads the broadcaster.
            </p>

            {status?.config?.isPlayitSynced && (
              <div className="alert-toast alert-success mb-4 p-3 d-flex items-center justify-between flex-wrap gap-2">
                <div className="d-flex items-center gap-2">
                  <span className="text-base">⚡</span>
                  <div>
                    <span className="font-bold d-block text-white text-xs">
                      Auto-Synced with Playit.gg Internet Tunnel
                    </span>
                    <span className="text-sub text-xs">
                      Directing console friends to: <strong className="text-emerald font-mono">{status.config.playitAddress}</strong>
                      {status.config.playitIp && ` (${status.config.playitIp}:${status.config.effectivePort})`}
                    </span>
                  </div>
                </div>
                <span className="badge badge-success text-xs font-mono">🟢 Live Synced</span>
              </div>
            )}

            <form onSubmit={handleSaveConfig}>
              {/* Toggle: Auto-Sync with Playit.gg Tunnel */}
              <div className="setting-toggle-row py-3 border-top border-bottom mb-4">
                <div className="setting-toggle-info">
                  <div className="d-flex items-center gap-2 mb-1">
                    <span className="setting-icon">🌐</span>
                    <h4 className="setting-title m-0">Auto-Sync with Playit.gg Tunnel</h4>
                    <span className="badge badge-primary text-xs">Recommended</span>
                  </div>
                  <p className="setting-desc m-0">
                    When the Playit tunnel is running, automatically pull its public Bedrock address ({tunnelStatus?.publicAddress || 'Playit Tunnel'}) and use it as the bot's destination so friends are automatically routed to your server without port forwarding.
                  </p>
                </div>
                <label className="modern-switch-wrapper flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={autoSyncPlayit}
                    onChange={(e) => setAutoSyncPlayit(e.target.checked)}
                  />
                  <span className="modern-switch-slider"></span>
                </label>
              </div>

              <div className="form-grid-2 mb-4">
                <div className="form-group-modern">
                  <label className="field-label-bold d-flex items-center justify-between">
                    <span>Target Server IP / Hostname:</span>
                    {autoSyncPlayit && status?.config?.isPlayitSynced && (
                      <span className="badge badge-success text-xs font-mono">⚡ Playit Synced</span>
                    )}
                  </label>
                  <input
                    type="text"
                    required
                    className="input-modern"
                    placeholder="127.0.0.1 or domain"
                    value={targetIp}
                    onChange={(e) => setTargetIp(e.target.value)}
                  />
                  <small className="field-hint text-sub mt-1 d-block">
                    {autoSyncPlayit && status?.config?.isPlayitSynced ? (
                      <span>Active Playit target: <strong className="text-emerald font-mono">{status.config.effectiveIp}</strong> (Saved fallback: {targetIp})</span>
                    ) : (
                      'The IP address where your real Minecraft server is hosted.'
                    )}
                  </small>
                </div>

                <div className="form-group-modern">
                  <label className="field-label-bold d-flex items-center justify-between">
                    <span>Target Server Port (UDP):</span>
                    {autoSyncPlayit && status?.config?.isPlayitSynced && (
                      <span className="badge badge-success text-xs font-mono">⚡ {status.config.effectivePort}</span>
                    )}
                  </label>
                  <input
                    type="number"
                    required
                    className="input-modern"
                    placeholder="19132"
                    value={targetPort}
                    onChange={(e) => setTargetPort(e.target.value)}
                  />
                  <small className="field-hint text-sub mt-1 d-block">
                    {autoSyncPlayit && status?.config?.isPlayitSynced ? (
                      <span>Active Playit port: <strong className="text-emerald font-mono">{status.config.effectivePort}</strong> (Saved fallback: {targetPort})</span>
                    ) : (
                      'Standard Bedrock Dedicated Server port (default: 19132).'
                    )}
                  </small>
                </div>
              </div>

              <div className="form-grid-2 mb-4">
                <div className="form-group-modern">
                  <label className="field-label-bold">Bot Listener UDP Port:</label>
                  <input
                    type="number"
                    required
                    className="input-modern"
                    placeholder="19133"
                    value={listenPort}
                    onChange={(e) => setListenPort(e.target.value)}
                  />
                  <small className="field-hint text-sub mt-1 d-block">
                    Local port where the relay bot listens for incoming friend joins (default: 19133).
                  </small>
                </div>

                <div className="form-group-modern">
                  <label className="field-label-bold">Server Name (Friends List Title):</label>
                  <input
                    type="text"
                    required
                    className="input-modern"
                    placeholder="Bedrock Dedicated Realm"
                    value={serverName}
                    onChange={(e) => setServerName(e.target.value)}
                  />
                  <small className="field-hint text-sub mt-1 d-block">
                    Title visible in friends' Minecraft multiplayer tabs.
                  </small>
                </div>
              </div>

              {/* Toggle: Auto Accept Friends */}
              <div className="setting-toggle-row py-3 border-top border-bottom mb-4">
                <div className="setting-toggle-info">
                  <div className="d-flex items-center gap-2 mb-1">
                    <span className="setting-icon">🤝</span>
                    <h4 className="setting-title m-0">Auto-Accept Friend Requests</h4>
                  </div>
                  <p className="setting-desc m-0">
                    When enabled, the bot automatically accepts and adds back anyone who adds it on Xbox Live, making the server instantly appear in their in-game Friends list.
                  </p>
                </div>
                <label className="modern-switch-wrapper flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={autoAccept}
                    onChange={(e) => setAutoAccept(e.target.checked)}
                  />
                  <span className="modern-switch-slider"></span>
                </label>
              </div>

              {/* Toggle: Show in Player Quick-Start Portal */}
              <div className="setting-toggle-row py-3 border-bottom mb-5">
                <div className="setting-toggle-info">
                  <div className="d-flex items-center gap-2 mb-1">
                    <span className="setting-icon">🌐</span>
                    <h4 className="setting-title m-0">Show Bot in Player Quick-Start Portal</h4>
                  </div>
                  <p className="setting-desc m-0">
                    Display this bot's Gamertag, copy button, join instructions, and power controls on the dedicated player portal (<code className="code-tag">/server</code>).
                  </p>
                </div>
                <label className="modern-switch-wrapper flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={showInPortal}
                    onChange={(e) => setShowInPortal(e.target.checked)}
                  />
                  <span className="modern-switch-slider"></span>
                </label>
              </div>

              <div className="text-right">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={configSaving}
                >
                  {configSaving ? 'Applying Settings...' : '💾 Save Settings'}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* RIGHT COLUMN: FRIENDS ROSTER & LIVE ACTIVITY LOGS */}
        <div className="d-flex flex-column gap-6">
          {/* CARD 3: XBOX LIVE FRIENDS & REQUESTS */}
          <div className="modern-card">
            <div className="card-header-styled">
              <div className="header-badge-title">
                <span className="icon-badge">👥</span>
                <h2>Xbox Social Roster ({friends.length + requests.length})</h2>
              </div>
              {isAuth && (
                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  onClick={handleSyncFriends}
                  disabled={friendsLoading}
                  title="Force refresh friends list from Xbox Live"
                >
                  <span className={`refresh-glyph ${friendsLoading ? 'spinning' : ''}`}>↻</span> Sync Roster
                </button>
              )}
            </div>

            <div className="card-body p-4">
              {!isAuth ? (
                <div className="text-center py-6 text-muted text-sm">
                  Connect Microsoft account to view and manage Xbox Live friends and requests.
                </div>
              ) : (
                <>
                  {/* Tabs & Search Controls */}
                  <div className="xbox-tabs-container">
                    <div className="xbox-tab-group">
                      <button
                        type="button"
                        className={`xbox-tab-btn ${activeFriendTab === 'friends' ? 'active' : ''}`}
                        onClick={() => setActiveFriendTab('friends')}
                      >
                        <span>Friends</span>
                        <span className="xbox-tab-counter">{friends.length}</span>
                      </button>
                      <button
                        type="button"
                        className={`xbox-tab-btn ${activeFriendTab === 'requests' ? 'active' : ''}`}
                        onClick={() => setActiveFriendTab('requests')}
                      >
                        <span>Requests</span>
                        <span className="xbox-tab-counter" style={{ background: requests.length > 0 ? '#fbbf24' : undefined, color: requests.length > 0 ? '#000' : undefined }}>
                          {requests.length}
                        </span>
                      </button>
                    </div>

                    <div className="xbox-search-input-wrap">
                      <span className="xbox-search-icon">🔍</span>
                      <input
                        type="text"
                        className="xbox-search-input"
                        placeholder="Search gamertag..."
                        value={friendSearch}
                        onChange={(e) => setFriendSearch(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Friends Tab Content */}
                  {activeFriendTab === 'friends' && (
                    <div className="xbox-friends-scroll-list">
                      {filteredFriends.length === 0 ? (
                        <div className="text-center py-6 text-muted text-xs">
                          {friends.length === 0
                            ? `No friends added yet. Tell players to add ${status.account.gamertag} on Xbox Live!`
                            : 'No friends match your search.'}
                        </div>
                      ) : (
                        filteredFriends.map((f) => (
                          <div key={f.xuid} className="xbox-friend-item">
                            <div className="friend-item-info">
                              <div className="friend-avatar-thumb-wrap">
                                <img
                                  src={f.displayPic || 'https://images.placeholders.dev/?width=38&height=38&text=Xbox'}
                                  alt={f.gamertag}
                                  className="friend-avatar-thumb"
                                  onError={(e) => {
                                    e.target.src = 'https://images.placeholders.dev/?width=38&height=38&text=Xbox';
                                  }}
                                />
                                <span
                                  className={`friend-presence-dot ${f.presence === 'Online' ? 'online' : 'offline'}`}
                                  title={f.presenceText || f.presence}
                                />
                              </div>

                              <div className="friend-name-col">
                                <span className="friend-name">{f.gamertag}</span>
                                <span className={`friend-presence-text ${f.presence === 'Online' ? 'online' : ''}`}>
                                  {f.presence === 'Online' ? '🟢 Online' : f.presenceText || 'Offline'}
                                </span>
                              </div>
                            </div>

                            <div className="friend-actions-col">
                              {f.gamerScore && f.gamerScore !== '0' && (
                                <span className="text-muted text-xs font-mono">🏆 {f.gamerScore}</span>
                              )}
                              <span className="badge-mutual">✓ Friend</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {/* Requests Tab Content */}
                  {activeFriendTab === 'requests' && (
                    <div className="xbox-friends-scroll-list">
                      {filteredRequests.length === 0 ? (
                        <div className="text-center py-6 text-muted text-xs">
                          {requests.length === 0
                            ? 'No pending friend requests. Any incoming followers will appear here.'
                            : 'No requests match your search.'}
                        </div>
                      ) : (
                        filteredRequests.map((r) => (
                          <div key={r.xuid} className="xbox-friend-item">
                            <div className="friend-item-info">
                              <div className="friend-avatar-thumb-wrap">
                                <img
                                  src={r.displayPic || 'https://images.placeholders.dev/?width=38&height=38&text=Xbox'}
                                  alt={r.gamertag}
                                  className="friend-avatar-thumb"
                                  onError={(e) => {
                                    e.target.src = 'https://images.placeholders.dev/?width=38&height=38&text=Xbox';
                                  }}
                                />
                                <span className="friend-presence-dot online" />
                              </div>

                              <div className="friend-name-col">
                                <span className="friend-name">{r.gamertag}</span>
                                <span className="friend-presence-text online">
                                  Follower (Added your bot)
                                </span>
                              </div>
                            </div>

                            <div className="friend-actions-col">
                              <button
                                type="button"
                                className="btn-accept-request"
                                onClick={() => handleAcceptRequest(r.xuid, r.gamertag)}
                                disabled={acceptingXuid === r.xuid}
                              >
                                {acceptingXuid === r.xuid ? 'Adding...' : '✓ Add Back'}
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* CARD 4: LIVE ACTIVITY & REDIRECT LOGS */}
          <div className="modern-card">
            <div className="card-header-styled">
              <div className="header-badge-title">
                <span className="icon-badge">📋</span>
                <h2>Live Player Redirects &amp; Activity</h2>
              </div>
              <span className="badge badge-success text-xs">
                {status?.stats?.totalRedirects || 0} Redirects Handled
              </span>
            </div>

            <div className="card-body p-0">
              <div className="activity-logs-container p-4">
                {status?.recentLogs?.length === 0 ? (
                  <p className="text-muted text-xs text-center py-6 m-0">
                    No redirect activity recorded yet. Start the bot and invite friends to test!
                  </p>
                ) : (
                  <div className="log-entries-stream">
                    {status?.recentLogs?.map((log) => (
                      <div key={log.id} className={`log-entry-row log-type-${log.type?.toLowerCase()}`}>
                        <span className="log-timestamp font-mono text-xs text-muted">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                        <span className={`log-badge log-badge-${log.type?.toLowerCase()}`}>
                          {log.type}
                        </span>
                        <span className="log-message text-xs text-white">
                          {log.message}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      </>
      )}

      {/* Playit Secret Key Input Modal */}
      {showSecretModal && (
        <div className="modal-backdrop">
          <div className="modal-dialog max-w-md">
            <div className="modal-header">
              <h3 className="modal-title font-bold text-white flex items-center gap-2">
                <span>🔑</span> Enter Playit.gg Secret Key
              </h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowSecretModal(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveSecret}>
              <div className="modal-body p-4">
                <p className="text-xs text-sub mb-3">
                  If you already created an agent in your <a href="https://playit.gg/manage/agents" target="_blank" rel="noreferrer" className="text-emerald font-bold">Playit.gg Dashboard ↗</a>, copy its Secret Key and paste it below:
                </p>
                <div className="form-group mb-2">
                  <input
                    type="password"
                    required
                    placeholder="Paste secret key here..."
                    className="input-modern w-full font-mono text-xs"
                    value={secretInput}
                    onChange={(e) => setSecretInput(e.target.value)}
                    autoFocus
                  />
                </div>
                <small className="text-sub text-xs d-block">
                  This key will be saved securely to <code>data/tools/playit/playit.toml</code>.
                </small>
              </div>
              <div className="modal-footer d-flex justify-end gap-2 p-4 border-top">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowSecretModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!secretInput.trim() || tunnelLoading}
                >
                  {tunnelLoading ? 'Connecting...' : 'Save & Connect Tunnel'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default XboxLive;
