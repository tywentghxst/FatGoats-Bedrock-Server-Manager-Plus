import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';

export const Players = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [playersData, setPlayersData] = useState({
    online: [],
    offline: [],
    totalCount: 0,
    onlineCount: 0,
    opCount: 0,
    allowlistCount: 0,
  });
  const [serverState, setServerState] = useState('stopped');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('all'); // 'all' | 'online' | 'ops' | 'allowlist' | 'offline'
  const [actionLoading, setActionLoading] = useState(null); // player name being acted on
  const [toast, setToast] = useState(null); // { type: 'success' | 'error' | 'info', text: '' }

  // Modal: Add / Pre-register player
  const [showAddModal, setShowAddModal] = useState(false);
  const [newGamertag, setNewGamertag] = useState('');
  const [newXuid, setNewXuid] = useState('');
  const [newPermission, setNewPermission] = useState('member');
  const [newIsAllowlisted, setNewIsAllowlisted] = useState(false);

  // Modal: Kick player
  const [kickModalPlayer, setKickModalPlayer] = useState(null);
  const [kickReason, setKickReason] = useState('Kicked by administrator');

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
      showToast('success', res.message || `Player ${kickModalPlayer.name} kicked`);
      setKickModalPlayer(null);
      setKickReason('Kicked by administrator');
      await fetchPlayers();
    } catch (err) {
      showToast('error', err.message || 'Failed to kick player');
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
      showToast('success', `Added player ${newGamertag} to server directory!`);
      setShowAddModal(false);
      setNewGamertag('');
      setNewXuid('');
      setNewPermission('member');
      setNewIsAllowlisted(false);
      await fetchPlayers();
    } catch (err) {
      showToast('error', err.message || 'Failed to add player');
    } finally {
      setActionLoading(null);
    }
  };

  const copyToClipboard = (text, label) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
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

  const totalOps = allList.filter((p) => p.isOp).length;
  const totalAllowlisted = allList.filter((p) => p.isAllowlisted).length;

  // Filter based on active filter and search query
  const applyFilter = (list) => {
    return list.filter((p) => {
      const matchesSearch =
        !searchQuery ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.xuid && p.xuid.includes(searchQuery));

      if (!matchesSearch) return false;

      if (activeFilter === 'online') return p.isOnline;
      if (activeFilter === 'offline') return !p.isOnline;
      if (activeFilter === 'ops') return p.isOp;
      if (activeFilter === 'allowlist') return p.isAllowlisted;

      return true;
    });
  };

  const filteredOnline = applyFilter(onlineList);
  const filteredOffline = applyFilter(offlineList);
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
            Real-time telemetry of live Bedrock players, permission tiers (OP, Member, Visitor), and BDS Allowlist synchronization.
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
            placeholder="Search players by Xbox Gamertag or XUID..."
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
          className={`player-filter-tab ${activeFilter === 'offline' ? 'active' : ''}`}
          onClick={() => setActiveFilter('offline')}
        >
          <span>⚪</span> Offline Roster ({offlineList.length})
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
                                onClick={() => setKickModalPlayer(player)}
                                title="Kick player from server"
                              >
                                👢 Kick
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

      {/* SECTION 2: ROSTER / OFFLINE PLAYERS (Shown when filter is not 'online') */}
      {activeFilter !== 'online' && (
        <div className="card player-section-card">
          <div className="card-header-styled">
            <div className="header-badge-title">
              <span className="offline-indicator"></span>
              <h2>
                {activeFilter === 'ops'
                  ? `Server Operators (${filteredAll.length})`
                  : activeFilter === 'allowlist'
                  ? `Allowlisted Players (${filteredAll.length})`
                  : `Server Directory & Historical Roster (${filteredOffline.length})`}
              </h2>
            </div>
            <span className="header-meta">
              Synchronized with permissions.json & allowlist.json
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
                            <span className={`player-status-badge ${player.isOnline ? 'online-pill' : 'offline-pill'}`}>
                              {player.isOnline ? 'ONLINE' : 'OFFLINE'}
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
                  >
                    <option value="member">🛡️ Member (Standard survival gameplay)</option>
                    <option value="operator">👑 Operator (Full admin commands / cheats / teleport)</option>
                    <option value="visitor">👁️ Visitor (Read-only / spectator view)</option>
                  </select>
                </div>

                <div className="form-group mb-2">
                  <label className="d-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newIsAllowlisted}
                      onChange={(e) => setNewIsAllowlisted(e.target.checked)}
                    />
                    <span className="text-sm text-white">
                      🛡️ Add directly to Bedrock <code>allowlist.json</code>
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
                <div className="form-group">
                  <label className="form-label">Kick Reason (Shown to player on disconnect screen)</label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    value={kickReason}
                    onChange={(e) => setKickReason(e.target.value)}
                  />
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
    </div>
  );
};

export default Players;
