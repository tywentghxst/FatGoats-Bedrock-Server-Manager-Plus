import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { safeCopyToClipboard } from '../utils/clipboard';

const KICK_REASON_PRESETS = [
  'AFK / Inactive too long',
  'Rule Warning / Disruption',
  'Excessive Ping / Lagging Server',
  'Server Restart / Maintenance',
  'Spamming Chat',
];

const BAN_REASON_PRESETS = [
  'Griefing / Destroying Builds',
  'Hacking / Movement Cheats / X-Ray',
  'Toxic Behavior / Harassment',
  'Spam / Advertising / Phishing',
  'Exploiting Duplication Glitches',
  'Permanent Server Ban',
];

export const Players = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [playersData, setPlayersData] = useState({
    online: [],
    offline: [],
    banned: [],
    totalCount: 0,
    onlineCount: 0,
    opCount: 0,
    allowlistCount: 0,
    bannedCount: 0,
  });
  const [serverState, setServerState] = useState('stopped');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('all'); // 'all' | 'online' | 'ops' | 'allowlist' | 'banned' | 'offline'
  const [actionLoading, setActionLoading] = useState(null); // player name being acted on
  const [toast, setToast] = useState(null); // { type: 'success' | 'error' | 'info', text: '' }

  // Modal: Add / Pre-register player
  const [showAddModal, setShowAddModal] = useState(false);
  const [newGamertag, setNewGamertag] = useState('');
  const [newXuid, setNewXuid] = useState('');
  const [newPermission, setNewPermission] = useState('member');
  const [newIsAllowlisted, setNewIsAllowlisted] = useState(false);
  const [newIsBanned, setNewIsBanned] = useState(false);

  // Modal: Kick player
  const [kickModalPlayer, setKickModalPlayer] = useState(null);
  const [kickReason, setKickReason] = useState('Kicked by administrator');

  // Modal: Ban player
  const [banModalPlayer, setBanModalPlayer] = useState(null);
  const [banReason, setBanReason] = useState('Banned by administrator');

  const showToast = (type, text) => {
    setToast({ type, text });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  const fetchPlayers = useCallback(async () => {
    try {
      const [pRes, sRes] = await Promise.allSettled([
        api.Players.list(),
        api.Server.getStatus(),
      ]);

      if (pRes.status === 'fulfilled' && pRes.value) {
        setPlayersData(pRes.value);
      }
      if (sRes.status === 'fulfilled') {
        setServerState(sRes.value?.state || 'stopped');
      }
    } catch (err) {
      console.error('Failed to fetch player directory:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlayers();
    const interval = setInterval(fetchPlayers, 4000);
    return () => clearInterval(interval);
  }, [fetchPlayers]);

  // Instant Healing
  const handleHealPlayer = async (player) => {
    if (!isAdmin) return;
    if (serverState !== 'running') {
      showToast('error', 'Bedrock server must be running to heal players.');
      return;
    }

    setActionLoading(`${player.name}-heal`);
    try {
      const res = await api.Players.heal(player.name);
      showToast('success', res.message || `💖 Instantly healed ${player.name} to full health!`);
    } catch (err) {
      showToast('error', err.message || `Failed to heal ${player.name}`);
    } finally {
      setActionLoading(null);
    }
  };

  // Instant Food Heal
  const handleFeedPlayer = async (player) => {
    if (!isAdmin) return;
    if (serverState !== 'running') {
      showToast('error', 'Bedrock server must be running to feed players.');
      return;
    }

    setActionLoading(`${player.name}-feed`);
    try {
      const res = await api.Players.feed(player.name);
      showToast('success', res.message || `🍖 Instantly filled food & saturation for ${player.name}!`);
    } catch (err) {
      showToast('error', err.message || `Failed to feed ${player.name}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleOp = async (player) => {
    if (!isAdmin) return;
    const targetOp = !player.isOp;
    const actionLabel = targetOp ? 'Grant OP privileges' : 'Revoke OP privileges';

    if (!window.confirm(`Are you sure you want to ${actionLabel} for "${player.name}"?`)) {
      return;
    }

    setActionLoading(player.name);
    try {
      const res = await api.Players.setOp(player.name, targetOp);
      showToast('success', res.message || `Updated OP status for ${player.name}`);
      await fetchPlayers();
    } catch (err) {
      showToast('error', err.message || `Failed to update OP for ${player.name}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handlePermissionChange = async (player, newPerm) => {
    if (!isAdmin || player.permission === newPerm) return;

    setActionLoading(player.name);
    try {
      const res = await api.Players.setPermission(player.name, newPerm);
      showToast('success', res.message || `Changed permission for ${player.name} to ${newPerm.toUpperCase()}`);
      await fetchPlayers();
    } catch (err) {
      showToast('error', err.message || `Failed to change permission for ${player.name}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleAllowlist = async (player) => {
    if (!isAdmin) return;
    const targetAllowlist = !player.isAllowlisted;

    setActionLoading(player.name);
    try {
      const res = await api.Players.setAllowlist(player.name, targetAllowlist, player.xuid);
      showToast('success', res.message || `Updated allowlist for ${player.name}`);
      await fetchPlayers();
    } catch (err) {
      showToast('error', err.message || `Failed to update allowlist for ${player.name}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleKickConfirm = async (e) => {
    e.preventDefault();
    if (!kickModalPlayer) return;

    setActionLoading(kickModalPlayer.name);
    try {
      const res = await api.Players.kick(kickModalPlayer.name, kickReason);
      showToast('success', res.message || `👢 Player ${kickModalPlayer.name} kicked`);
      setKickModalPlayer(null);
      setKickReason('Kicked by administrator');
      await fetchPlayers();
    } catch (err) {
      showToast('error', err.message || 'Failed to kick player');
    } finally {
      setActionLoading(null);
    }
  };

  const handleBanConfirm = async (e) => {
    e.preventDefault();
    if (!banModalPlayer) return;

    setActionLoading(banModalPlayer.name);
    try {
      const res = await api.Players.ban(banModalPlayer.name, banReason);
      showToast('success', res.message || `🚫 Player ${banModalPlayer.name} has been banned!`);
      setBanModalPlayer(null);
      setBanReason('Banned by administrator');
      await fetchPlayers();
    } catch (err) {
      showToast('error', err.message || 'Failed to ban player');
    } finally {
      setActionLoading(null);
    }
  };

  const handleUnbanPlayer = async (player) => {
    if (!isAdmin) return;
    if (!window.confirm(`Unban player "${player.name}" and allow them to join the server again?`)) {
      return;
    }

    setActionLoading(player.name);
    try {
      const res = await api.Players.unban(player.name);
      showToast('success', res.message || `🔓 Unbanned player ${player.name}`);
      await fetchPlayers();
    } catch (err) {
      showToast('error', err.message || `Failed to unban ${player.name}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeletePlayer = async (player) => {
    if (!isAdmin) return;
    if (!window.confirm(`Remove offline player "${player.name}" from server directory and config files?`)) {
      return;
    }

    setActionLoading(player.name);
    try {
      await api.Players.delete(player.name);
      showToast('success', `Removed ${player.name} from directory`);
      await fetchPlayers();
    } catch (err) {
      showToast('error', err.message || 'Failed to remove player');
    } finally {
      setActionLoading(null);
    }
  };

  const handleAddPlayer = async (e) => {
    e.preventDefault();
    if (!newGamertag.trim()) return;

    setActionLoading('adding');
    try {
      const isOp = newPermission === 'operator';
      await api.Players.add(
        newGamertag.trim(),
        newXuid.trim() || null,
        isOp,
        newPermission,
        newIsAllowlisted
      );

      if (newIsBanned) {
        await api.Players.ban(newGamertag.trim(), 'Pre-banned upon registration');
      }

      showToast('success', `Added player ${newGamertag} to server directory!`);
      setShowAddModal(false);
      setNewGamertag('');
      setNewXuid('');
      setNewPermission('member');
      setNewIsAllowlisted(false);
      setNewIsBanned(false);
      await fetchPlayers();
    } catch (err) {
      showToast('error', err.message || 'Failed to add player');
    } finally {
      setActionLoading(null);
    }
  };

  const copyToClipboard = async (text, label) => {
    if (!text) return;
    await safeCopyToClipboard(text);
    showToast('info', `📋 Copied ${label} (${text}) to clipboard!`);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Never';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const onlineList = playersData.online || [];
  const offlineList = playersData.offline || [];
  const allList = [...onlineList, ...offlineList];
  const bannedList = playersData.banned || allList.filter((p) => p.isBanned);

  const totalOps = allList.filter((p) => p.isOp).length;
  const totalAllowlisted = allList.filter((p) => p.isAllowlisted).length;
  const totalBanned = bannedList.length;

  // Filter based on active filter and search query
  const applyFilter = (list) => {
    return list.filter((p) => {
      const matchesSearch =
        !searchQuery ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.xuid && p.xuid.includes(searchQuery)) ||
        (p.banReason && p.banReason.toLowerCase().includes(searchQuery.toLowerCase()));

      if (!matchesSearch) return false;

      if (activeFilter === 'online') return p.isOnline;
      if (activeFilter === 'offline') return !p.isOnline && !p.isBanned;
      if (activeFilter === 'ops') return p.isOp;
      if (activeFilter === 'allowlist') return p.isAllowlisted;
      if (activeFilter === 'banned') return p.isBanned;

      return true;
    });
  };

  const filteredOnline = applyFilter(onlineList);
  const filteredOffline = applyFilter(offlineList.filter((p) => !p.isBanned));
  const filteredBanned = applyFilter(bannedList);
  const filteredAll = applyFilter(allList);

  return (
    <div className="page-container">
      {/* Toast alert */}
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

      {/* Header with Title & Action */}
      <div className="section-header">
        <div>
          <h1 className="page-title">Players & Operators</h1>
          <p className="page-subtitle">
            Real-time telemetry of live Bedrock players, permission tiers (OP, Member, Visitor), instant healing, instant food, kicking, and ban management.
          </p>
        </div>
        <div className="header-meta-actions">
          {isAdmin && (
            <button
              type="button"
              className="btn btn-primary btn-sm d-flex items-center gap-1.5"
              onClick={() => setShowAddModal(true)}
            >
              <span>➕ Add / Pre-OP Gamertag</span>
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-sm d-flex items-center gap-1.5"
            onClick={fetchPlayers}
            disabled={actionLoading !== null}
            title="Refresh status"
          >
            <span>🔄</span> Refresh
          </button>
        </div>
      </div>

      {/* Quick Stats Bar */}
      <div className="player-stats-grid">
        <div
          className={`player-stat-card card-online ${activeFilter === 'online' ? 'border-emerald' : ''}`}
          onClick={() => setActiveFilter(activeFilter === 'online' ? 'all' : 'online')}
          style={{ cursor: 'pointer' }}
        >
          <div className="stat-icon-wrapper">🟢</div>
          <div className="stat-content">
            <span className="stat-label">Online Players</span>
            <span className="stat-number">{onlineList.length}</span>
            <span className="stat-sub">
              {serverState === 'running' ? 'Active in Minecraft BDS' : 'Server is offline'}
            </span>
          </div>
        </div>

        <div
          className={`player-stat-card card-ops ${activeFilter === 'ops' ? 'border-amber' : ''}`}
          onClick={() => setActiveFilter(activeFilter === 'ops' ? 'all' : 'ops')}
          style={{ cursor: 'pointer' }}
        >
          <div className="stat-icon-wrapper">👑</div>
          <div className="stat-content">
            <span className="stat-label">Operators (OPs)</span>
            <span className="stat-number">{totalOps}</span>
            <span className="stat-sub">Admin permissions in BDS</span>
          </div>
        </div>

        <div
          className={`player-stat-card card-allowlist ${activeFilter === 'allowlist' ? 'border-blue' : ''}`}
          onClick={() => setActiveFilter(activeFilter === 'allowlist' ? 'all' : 'allowlist')}
          style={{ cursor: 'pointer' }}
        >
          <div className="stat-icon-wrapper">🛡️</div>
          <div className="stat-content">
            <span className="stat-label">Allowlisted Players</span>
            <span className="stat-number">{totalAllowlisted}</span>
            <span className="stat-sub">Synced with allowlist.json</span>
          </div>
        </div>

        <div
          className={`player-stat-card card-banned ${activeFilter === 'banned' ? 'border-red' : ''}`}
          onClick={() => setActiveFilter(activeFilter === 'banned' ? 'all' : 'banned')}
          style={{ cursor: 'pointer' }}
        >
          <div className="stat-icon-wrapper">🚫</div>
          <div className="stat-content">
            <span className="stat-label">Banned Players</span>
            <span className="stat-number">{totalBanned}</span>
            <span className="stat-sub">Blocked from connecting</span>
          </div>
        </div>

        <div
          className={`player-stat-card card-total ${activeFilter === 'all' ? 'border-primary' : ''}`}
          onClick={() => setActiveFilter('all')}
          style={{ cursor: 'pointer' }}
        >
          <div className="stat-icon-wrapper">👥</div>
          <div className="stat-content">
            <span className="stat-label">Total Unique Players</span>
            <span className="stat-number">{allList.length}</span>
            <span className="stat-sub">Recorded across all sessions</span>
          </div>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="player-search-bar-wrap">
        <div className="search-input-pill">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="Search players by Xbox Gamertag, XUID, or Ban reason..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="search-clear-btn" onClick={() => setSearchQuery('')}>✕</button>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="player-filter-tabs">
        <button
          type="button"
          className={`player-filter-tab ${activeFilter === 'all' ? 'active' : ''}`}
          onClick={() => setActiveFilter('all')}
        >
          <span>🌐</span> All Players ({allList.length})
        </button>
        <button
          type="button"
          className={`player-filter-tab ${activeFilter === 'online' ? 'active' : ''}`}
          onClick={() => setActiveFilter('online')}
        >
          <span>🟢</span> Online ({onlineList.length})
        </button>
        <button
          type="button"
          className={`player-filter-tab ${activeFilter === 'ops' ? 'active' : ''}`}
          onClick={() => setActiveFilter('ops')}
        >
          <span>👑</span> Operators ({totalOps})
        </button>
        <button
          type="button"
          className={`player-filter-tab ${activeFilter === 'allowlist' ? 'active' : ''}`}
          onClick={() => setActiveFilter('allowlist')}
        >
          <span>🛡️</span> Allowlisted ({totalAllowlisted})
        </button>
        <button
          type="button"
          className={`player-filter-tab ${activeFilter === 'banned' ? 'active' : ''}`}
          onClick={() => setActiveFilter('banned')}
        >
          <span>🚫</span> Banned ({totalBanned})
        </button>
        <button
          type="button"
          className={`player-filter-tab ${activeFilter === 'offline' ? 'active' : ''}`}
          onClick={() => setActiveFilter('offline')}
        >
          <span>⚪</span> Offline Roster ({filteredOffline.length})
        </button>
      </div>

      {/* SECTION 1: LIVE ONLINE PLAYERS (Shown when filter is 'all' or 'online') */}
      {(activeFilter === 'all' || activeFilter === 'online') && (
        <div className="card player-section-card mb-6">
          <div className="card-header-styled">
            <div className="header-badge-title">
              <span className="pulse-indicator"></span>
              <h2>Live Players Online ({filteredOnline.length})</h2>
            </div>
            <span className="header-meta">
              {serverState === 'running' ? 'Connected to Bedrock Dedicated Server' : 'Server is Stopped'}
            </span>
          </div>

          {filteredOnline.length === 0 ? (
            <div className="empty-players-state">
              <div className="empty-icon">🎮</div>
              <h3>No Players Currently Online</h3>
              <p>
                {serverState === 'running'
                  ? 'When players join via Minecraft Bedrock on Xbox, PlayStation, Switch, PC, iOS, or Android, their live session will stream here.'
                  : 'Start the Minecraft Bedrock server from the Dashboard to let players connect.'}
              </p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th>Player Gamertag</th>
                    <th>Permission Level</th>
                    <th>Allowlist</th>
                    <th>XUID</th>
                    <th>Connected Since</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOnline.map((player) => (
                    <tr key={player.name} className="player-row-online">
                      <td>
                        <div className="player-name-cell">
                          <div className="player-avatar">
                            <span>{player.name.charAt(0).toUpperCase()}</span>
                            <span className="avatar-online-dot"></span>
                          </div>
                          <div className="player-name-meta">
                            <span
                              className="player-gamertag"
                              style={{ cursor: 'pointer' }}
                              title="Click to copy Gamertag"
                              onClick={() => copyToClipboard(player.name, 'Gamertag')}
                            >
                              {player.name}
                            </span>
                            <span className="player-status-badge online-pill">LIVE NOW</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        {isAdmin ? (
                          <select
                            className="role-select"
                            value={player.permission || (player.isOp ? 'operator' : 'member')}
                            onChange={(e) => handlePermissionChange(player, e.target.value)}
                            disabled={actionLoading === player.name}
                          >
                            <option value="operator">👑 Operator (OP)</option>
                            <option value="member">🛡️ Member</option>
                            <option value="visitor">👁️ Visitor</option>
                          </select>
                        ) : player.isOp ? (
                          <span className="role-pill op-pill">👑 Operator</span>
                        ) : player.permission === 'visitor' ? (
                          <span className="role-pill visitor-pill">👁️ Visitor</span>
                        ) : (
                          <span className="role-pill member-pill">🛡️ Member</span>
                        )}
                      </td>
                      <td>
                        {player.isAllowlisted ? (
                          <span className="allowlist-pill">✓ Allowed</span>
                        ) : (
                          <span className="not-allowlist-pill">✕ None</span>
                        )}
                      </td>
                      <td>
                        <span
                          className="xuid-code"
                          style={{ cursor: player.xuid ? 'pointer' : 'default' }}
                          title={player.xuid ? 'Click to copy XUID' : ''}
                          onClick={() => player.xuid && copyToClipboard(player.xuid, 'XUID')}
                        >
                          {player.xuid || 'Auto-registered'}
                        </span>
                      </td>
                      <td>
                        <span className="time-sub">{formatDate(player.lastSeen)}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="table-actions-row">
                          {isAdmin && (
                            <>
                              <button
                                type="button"
                                className="btn-action-small btn-heal"
                                disabled={actionLoading === `${player.name}-heal`}
                                onClick={() => handleHealPlayer(player)}
                                title="Instantly heal player to full 20 HP health"
                              >
                                {actionLoading === `${player.name}-heal` ? '...' : '💖 Heal'}
                              </button>
                              <button
                                type="button"
                                className="btn-action-small btn-feed"
                                disabled={actionLoading === `${player.name}-feed`}
                                onClick={() => handleFeedPlayer(player)}
                                title="Instantly fill hunger and saturation meters to full"
                              >
                                {actionLoading === `${player.name}-feed` ? '...' : '🍖 Feed'}
                              </button>
                              <button
                                type="button"
                                className={`btn-action-small ${player.isOp ? 'btn-deop' : 'btn-op'}`}
                                disabled={actionLoading === player.name}
                                onClick={() => handleToggleOp(player)}
                                title={player.isOp ? 'Revoke Operator privileges' : 'Grant Operator privileges'}
                              >
                                {player.isOp ? 'De-OP' : '👑 Make OP'}
                              </button>
                              <button
                                type="button"
                                className={`btn-action-small ${player.isAllowlisted ? 'btn-allowlist-remove' : 'btn-allowlist'}`}
                                disabled={actionLoading === player.name}
                                onClick={() => handleToggleAllowlist(player)}
                                title={player.isAllowlisted ? 'Remove from allowlist' : 'Add to allowlist'}
                              >
                                {player.isAllowlisted ? '✕ Unallow' : '✓ Allow'}
                              </button>
                              <button
                                type="button"
                                className="btn-action-small btn-kick"
                                disabled={actionLoading === player.name}
                                onClick={() => {
                                  setKickModalPlayer(player);
                                  setKickReason('Kicked by administrator');
                                }}
                                title="Kick player from server"
                              >
                                👢 Kick
                              </button>
                              <button
                                type="button"
                                className="btn-action-small btn-ban"
                                disabled={actionLoading === player.name}
                                onClick={() => {
                                  setBanModalPlayer(player);
                                  setBanReason('Banned by administrator');
                                }}
                                title="Ban player from server (ejects and blocks reconnection)"
                              >
                                🚫 Ban
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* SECTION 2: BANNED PLAYERS (Shown when filter is 'banned' or 'all' with banned players) */}
      {(activeFilter === 'banned' || (activeFilter === 'all' && filteredBanned.length > 0)) && (
        <div className="card player-section-card mb-6" style={{ borderLeft: '4px solid #ef4444' }}>
          <div className="card-header-styled">
            <div className="header-badge-title">
              <span className="offline-indicator" style={{ background: '#ef4444' }}></span>
              <h2 style={{ color: '#fca5a5' }}>
                Banned Players ({filteredBanned.length})
              </h2>
            </div>
            <span className="header-meta">
              Blocked from joining • Automatically kicked upon connection attempt
            </span>
          </div>

          {filteredBanned.length === 0 ? (
            <div className="empty-players-state">
              <div className="empty-icon">🛡️</div>
              <h3>No Banned Players</h3>
              <p>No players are currently banned from the server.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th>Banned Player</th>
                    <th>Ban Reason</th>
                    <th>Banned Date</th>
                    <th>Banned By</th>
                    <th>XUID</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBanned.map((player) => (
                    <tr key={player.name} className="player-row-offline">
                      <td>
                        <div className="player-name-cell">
                          <div className="player-avatar" style={{ background: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.5)' }}>
                            <span style={{ color: '#fca5a5' }}>{player.name.charAt(0).toUpperCase()}</span>
                          </div>
                          <div className="player-name-meta">
                            <span
                              className="player-gamertag font-bold text-white"
                              style={{ cursor: 'pointer' }}
                              title="Click to copy Gamertag"
                              onClick={() => copyToClipboard(player.name, 'Gamertag')}
                            >
                              {player.name}
                            </span>
                            <span className="banned-pill">BANNED</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="text-sm font-semibold text-danger">
                          {player.banReason || 'Banned by administrator'}
                        </span>
                      </td>
                      <td>
                        <span className="time-sub">{formatDate(player.bannedAt || player.lastSeen)}</span>
                      </td>
                      <td>
                        <span className="badge badge-subtle">{player.bannedBy || 'admin'}</span>
                      </td>
                      <td>
                        <span
                          className="xuid-code"
                          style={{ cursor: player.xuid ? 'pointer' : 'default' }}
                          title={player.xuid ? 'Click to copy XUID' : ''}
                          onClick={() => player.xuid && copyToClipboard(player.xuid, 'XUID')}
                        >
                          {player.xuid || 'None recorded'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="table-actions-row">
                          {isAdmin && (
                            <>
                              <button
                                type="button"
                                className="btn-action-small btn-unban"
                                disabled={actionLoading === player.name}
                                onClick={() => handleUnbanPlayer(player)}
                                title="Unban player and allow them to join"
                              >
                                🔓 Unban Player
                              </button>
                              <button
                                type="button"
                                className="btn-action-small btn-delete"
                                disabled={actionLoading === player.name}
                                onClick={() => handleDeletePlayer(player)}
                                title="Delete record from database"
                              >
                                🗑️ Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* SECTION 3: ROSTER / OFFLINE PLAYERS (Shown when filter is not 'online' and not 'banned') */}
      {activeFilter !== 'online' && activeFilter !== 'banned' && (
        <div className="card player-section-card">
          <div className="card-header-styled">
            <div className="header-badge-title">
              <span className="offline-indicator"></span>
              <h2>
                {activeFilter === 'ops'
                  ? `Server Operators (${filteredAll.filter((p) => p.isOp).length})`
                  : activeFilter === 'allowlist'
                  ? `Allowlisted Players (${filteredAll.filter((p) => p.isAllowlisted).length})`
                  : `Server Directory & Offline Roster (${filteredOffline.length})`}
              </h2>
            </div>
            <span className="header-meta">
              Synchronized with permissions.json, allowlist.json & banned-players.json
            </span>
          </div>

          {(activeFilter === 'ops' || activeFilter === 'allowlist' ? filteredAll : filteredOffline).length === 0 ? (
            <div className="empty-players-state">
              <div className="empty-icon">📁</div>
              <h3>No Players Matching Filter</h3>
              <p>
                {activeFilter === 'ops'
                  ? 'No operators configured. Click "+ Add / Pre-OP Gamertag" above to grant operator privileges.'
                  : activeFilter === 'allowlist'
                  ? 'No allowlisted players found. Click "+ Add / Pre-OP Gamertag" to add players to the whitelist.'
                  : 'No offline player records found in database history.'}
              </p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th>Player Gamertag</th>
                    <th>Permission Level</th>
                    <th>Allowlist</th>
                    <th>XUID</th>
                    <th>First Seen</th>
                    <th>Last Seen</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(activeFilter === 'ops' || activeFilter === 'allowlist' ? filteredAll : filteredOffline).map((player) => (
                    <tr key={player.name} className="player-row-offline">
                      <td>
                        <div className="player-name-cell">
                          <div className={`player-avatar ${player.isOnline ? '' : 'avatar-offline'}`}>
                            <span>{player.name.charAt(0).toUpperCase()}</span>
                            {player.isOnline && <span className="avatar-online-dot"></span>}
                          </div>
                          <div className="player-name-meta">
                            <span
                              className="player-gamertag"
                              style={{ cursor: 'pointer' }}
                              title="Click to copy Gamertag"
                              onClick={() => copyToClipboard(player.name, 'Gamertag')}
                            >
                              {player.name}
                            </span>
                            <span className={`player-status-badge ${player.isBanned ? 'banned-pill' : (player.isOnline ? 'online-pill' : 'offline-pill')}`}>
                              {player.isBanned ? 'BANNED' : (player.isOnline ? 'ONLINE' : 'OFFLINE')}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td>
                        {isAdmin ? (
                          <select
                            className="role-select"
                            value={player.permission || (player.isOp ? 'operator' : 'member')}
                            onChange={(e) => handlePermissionChange(player, e.target.value)}
                            disabled={actionLoading === player.name}
                          >
                            <option value="operator">👑 Operator (OP)</option>
                            <option value="member">🛡️ Member</option>
                            <option value="visitor">👁️ Visitor</option>
                          </select>
                        ) : player.isOp ? (
                          <span className="role-pill op-pill">👑 Operator</span>
                        ) : player.permission === 'visitor' ? (
                          <span className="role-pill visitor-pill">👁️ Visitor</span>
                        ) : (
                          <span className="role-pill member-pill">🛡️ Member</span>
                        )}
                      </td>
                      <td>
                        {player.isAllowlisted ? (
                          <span className="allowlist-pill">✓ Allowed</span>
                        ) : (
                          <span className="not-allowlist-pill">✕ None</span>
                        )}
                      </td>
                      <td>
                        <span
                          className="xuid-code"
                          style={{ cursor: player.xuid ? 'pointer' : 'default' }}
                          title={player.xuid ? 'Click to copy XUID' : ''}
                          onClick={() => player.xuid && copyToClipboard(player.xuid, 'XUID')}
                        >
                          {player.xuid || 'None recorded'}
                        </span>
                      </td>
                      <td>
                        <span className="time-sub">{formatDate(player.firstSeen)}</span>
                      </td>
                      <td>
                        <span className="time-sub">{formatDate(player.lastSeen)}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="table-actions-row">
                          {isAdmin && (
                            <>
                              {player.isBanned ? (
                                <button
                                  type="button"
                                  className="btn-action-small btn-unban"
                                  disabled={actionLoading === player.name}
                                  onClick={() => handleUnbanPlayer(player)}
                                  title="Unban player"
                                >
                                  🔓 Unban
                                </button>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    className={`btn-action-small ${player.isOp ? 'btn-deop' : 'btn-op'}`}
                                    disabled={actionLoading === player.name}
                                    onClick={() => handleToggleOp(player)}
                                    title={player.isOp ? 'Revoke Operator privileges' : 'Grant Operator privileges'}
                                  >
                                    {player.isOp ? 'De-OP' : '👑 Make OP'}
                                  </button>
                                  <button
                                    type="button"
                                    className={`btn-action-small ${player.isAllowlisted ? 'btn-allowlist-remove' : 'btn-allowlist'}`}
                                    disabled={actionLoading === player.name}
                                    onClick={() => handleToggleAllowlist(player)}
                                    title={player.isAllowlisted ? 'Remove from allowlist' : 'Add to allowlist'}
                                  >
                                    {player.isAllowlisted ? '✕ Unallow' : '✓ Allow'}
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-action-small btn-ban"
                                    disabled={actionLoading === player.name}
                                    onClick={() => {
                                      setBanModalPlayer(player);
                                      setBanReason('Banned by administrator');
                                    }}
                                    title="Ban player from server"
                                  >
                                    🚫 Ban
                                  </button>
                                </>
                              )}
                              <button
                                type="button"
                                className="btn-action-small btn-delete"
                                disabled={actionLoading === player.name}
                                onClick={() => handleDeletePlayer(player)}
                                title="Remove player from database and configs"
                              >
                                🗑️ Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* MODAL: ADD / PRE-REGISTER PLAYER */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3 className="modal-title">➕ Add / Pre-register Gamertag</h3>
              <button className="modal-close-btn" onClick={() => setShowAddModal(false)}>✕</button>
            </div>
            <form onSubmit={handleAddPlayer}>
              <div className="modal-body">
                <p className="text-sub mb-4 text-xs">
                  Pre-register a player gamertag before they connect to assign permissions, Operator privileges, or BDS Allowlist access.
                </p>

                <div className="form-group mb-4">
                  <label className="form-label">Xbox Gamertag / Bedrock Player Name *</label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    placeholder="e.g. AlexGamer"
                    value={newGamertag}
                    onChange={(e) => setNewGamertag(e.target.value)}
                    autoFocus
                  />
                </div>

                <div className="form-group mb-4">
                  <label className="form-label">Xbox User ID / XUID (Optional)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. 2533274892084003"
                    value={newXuid}
                    onChange={(e) => setNewXuid(e.target.value)}
                  />
                  <small className="text-muted text-xs">
                    Leave blank if unknown; BDS will link the player's XUID upon connection.
                  </small>
                </div>

                <div className="form-group mb-4">
                  <label className="form-label">Permission Role</label>
                  <select
                    className="form-input"
                    value={newPermission}
                    onChange={(e) => setNewPermission(e.target.value)}
                    disabled={newIsBanned}
                  >
                    <option value="member">🛡️ Member (Standard survival gameplay)</option>
                    <option value="operator">👑 Operator (Full admin commands / cheats / teleport)</option>
                    <option value="visitor">👁️ Visitor (Read-only / spectator view)</option>
                  </select>
                </div>

                <div className="form-group mb-3">
                  <label className="d-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newIsAllowlisted}
                      disabled={newIsBanned}
                      onChange={(e) => setNewIsAllowlisted(e.target.checked)}
                    />
                    <span className="text-sm text-white">
                      🛡️ Add directly to Bedrock <code>allowlist.json</code>
                    </span>
                  </label>
                </div>

                <div className="form-group mb-2">
                  <label className="d-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newIsBanned}
                      onChange={(e) => {
                        setNewIsBanned(e.target.checked);
                        if (e.target.checked) setNewIsAllowlisted(false);
                      }}
                    />
                    <span className="text-sm text-danger font-semibold">
                      🚫 Pre-ban this gamertag immediately (block connection attempts)
                    </span>
                  </label>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={actionLoading === 'adding' || !newGamertag.trim()}
                >
                  {actionLoading === 'adding' ? 'Saving...' : 'Add Player'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: KICK PLAYER */}
      {kickModalPlayer && (
        <div className="modal-overlay" onClick={() => setKickModalPlayer(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3 className="modal-title">👢 Kick Player</h3>
              <button className="modal-close-btn" onClick={() => setKickModalPlayer(null)}>✕</button>
            </div>
            <form onSubmit={handleKickConfirm}>
              <div className="modal-body">
                <p className="text-sub mb-3 text-sm">
                  Are you sure you want to kick <strong>{kickModalPlayer.name}</strong> from the server?
                </p>
                <div className="form-group mb-3">
                  <label className="form-label">Kick Reason (Shown to player on disconnect screen)</label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    value={kickReason}
                    onChange={(e) => setKickReason(e.target.value)}
                  />
                  <div className="reason-chips-row">
                    {KICK_REASON_PRESETS.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        className={`reason-chip ${kickReason === chip ? 'active' : ''}`}
                        onClick={() => setKickReason(chip)}
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setKickModalPlayer(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-danger"
                  disabled={actionLoading === kickModalPlayer.name}
                >
                  {actionLoading === kickModalPlayer.name ? 'Kicking...' : 'Confirm Kick'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: BAN PLAYER */}
      {banModalPlayer && (
        <div className="modal-overlay" onClick={() => setBanModalPlayer(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3 className="modal-title" style={{ color: '#f87171' }}>🚫 Ban Player</h3>
              <button className="modal-close-btn" onClick={() => setBanModalPlayer(null)}>✕</button>
            </div>
            <form onSubmit={handleBanConfirm}>
              <div className="modal-body">
                <div className="alert-toast alert-error mb-4" style={{ borderRadius: 'var(--radius-md)' }}>
                  <span className="toast-icon">⚠️</span>
                  <span className="toast-text text-xs">
                    Banning <strong>{banModalPlayer.name}</strong> will immediately eject them if online, remove them from the allowlist, and automatically kick them upon any future connection attempt.
                  </span>
                </div>

                <div className="form-group mb-3">
                  <label className="form-label">Ban Reason (Recorded in audit log & shown on disconnect)</label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    value={banReason}
                    onChange={(e) => setBanReason(e.target.value)}
                  />
                  <div className="reason-chips-row">
                    {BAN_REASON_PRESETS.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        className={`reason-chip ${banReason === chip ? 'active' : ''}`}
                        onClick={() => setBanReason(chip)}
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setBanModalPlayer(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-danger"
                  style={{ background: '#dc2626' }}
                  disabled={actionLoading === banModalPlayer.name}
                >
                  {actionLoading === banModalPlayer.name ? 'Banning...' : 'Confirm & Ban Player'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Players;
