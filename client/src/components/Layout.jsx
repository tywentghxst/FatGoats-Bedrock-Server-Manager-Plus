import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api';

export const Layout = () => {
  const { user, logout, isAdmin } = useAuth();
  const canControl = isAdmin || user?.role === 'operator';
  const [serverStatus, setServerStatus] = useState({ state: 'stopped', serverName: 'Bedrock Dedicated Server' });
  const [xboxStatus, setXboxStatus] = useState(null);
  const [tunnelStatus, setTunnelStatus] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(null); // 'start-all' | 'restart-all' | 'stop-all'
  const [actionToast, setActionToast] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();

  const fetchStatus = async () => {
    try {
      const [serverData, xData, tData] = await Promise.allSettled([
        api.getStatus(),
        api.Xbox.getStatus(),
        api.Tunnel.getStatus(),
      ]);

      if (serverData.status === 'fulfilled' && serverData.value) {
        const data = serverData.value;
        setServerStatus({
          state: data.state || (data.running ? 'running' : 'stopped'),
          serverName: data.serverName || data.name || 'Bedrock Server',
        });
      }

      if (xData.status === 'fulfilled' && xData.value) {
        setXboxStatus(xData.value);
      }

      if (tData.status === 'fulfilled' && tData.value) {
        setTunnelStatus(tData.value);
      }
    } catch (err) {
      setServerStatus((prev) => ({ ...prev, state: 'stopped' }));
    }
  };

  useEffect(() => {
    let isMounted = true;
    fetchStatus();
    const interval = setInterval(() => {
      if (isMounted) fetchStatus();
    }, 3000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const handleStartAll = async () => {
    setActionLoading('start-all');
    try {
      const res = await api.Server.startAll();
      setActionToast({ type: 'success', text: res?.message || 'Started all services (Server, Playit, and Xbox Bot)!' });
      setTimeout(() => setActionToast(null), 4500);
      await fetchStatus();
    } catch (err) {
      setActionToast({ type: 'error', text: err?.message || 'Failed to start all services.' });
      setTimeout(() => setActionToast(null), 4500);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRestartAll = async () => {
    if (!window.confirm('Restart all services (Minecraft Server, Playit Tunnel, and Xbox Bot)?')) return;
    setActionLoading('restart-all');
    try {
      const res = await api.Server.restartAll();
      setActionToast({ type: 'success', text: res?.message || 'Restarted all services (Server, Playit, and Xbox Bot)!' });
      setTimeout(() => setActionToast(null), 4500);
      await fetchStatus();
    } catch (err) {
      setActionToast({ type: 'error', text: err?.message || 'Failed to restart all services.' });
      setTimeout(() => setActionToast(null), 4500);
    } finally {
      setActionLoading(null);
    }
  };

  const handleStopAll = async () => {
    if (!window.confirm('Stop all services (Minecraft Server, Playit Tunnel, and Xbox Bot)?')) return;
    setActionLoading('stop-all');
    try {
      const res = await api.Server.stopAll();
      setActionToast({ type: 'success', text: res?.message || 'Stopped all services (Server, Playit, and Xbox Bot).' });
      setTimeout(() => setActionToast(null), 4500);
      await fetchStatus();
    } catch (err) {
      setActionToast({ type: 'error', text: err?.message || 'Failed to stop all services.' });
      setTimeout(() => setActionToast(null), 4500);
    } finally {
      setActionLoading(null);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  const closeSidebarOnNav = () => {
    if (window.innerWidth <= 1024) {
      setSidebarOpen(false);
    }
  };

  const getPageTitle = () => {
    const path = location.pathname;
    if (path === '/') return 'Dashboard';
    if (path.startsWith('/players')) return 'Players & Permissions';
    if (path.startsWith('/console')) return 'Live Console';
    if (path.startsWith('/properties')) return 'Server Properties';
    if (path.startsWith('/worlds')) return 'Worlds & Saves';
    if (path.startsWith('/backups')) return 'Backup Archives';
    if (path.startsWith('/addons')) return 'Add-ons & Mods';
    if (path.startsWith('/users')) return 'Access Vault & Users';
    if (path.startsWith('/settings')) return 'Settings & Login Credentials';
    if (path.startsWith('/versions')) return 'Version Management';
    if (path.startsWith('/audit')) return 'Security Audit Log';
    if (path.startsWith('/xbox')) return 'Console & Public Access';
    return 'Server Manager';
  };

  return (
    <div className="app-layout">
      {/* Mobile backdrop */}
      {sidebarOpen && <div className="sidebar-backdrop" onClick={toggleSidebar} />}

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-logo-cube">
            <span className="cube-face">⛏️</span>
          </div>
          <div className="brand-text">
            <span className="brand-title">Bedrock Panel</span>
            <span className="brand-badge">BDS Manager</span>
          </div>
          <button className="sidebar-close-btn" onClick={toggleSidebar} aria-label="Close menu">
            ✕
          </button>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-group-label">OVERVIEW & MONITORING</div>
          <NavLink
            to="/"
            end
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            onClick={closeSidebarOnNav}
          >
            <span className="nav-icon">⚡</span>
            <span className="nav-text">Dashboard</span>
          </NavLink>

          <NavLink
            to="/players"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            onClick={closeSidebarOnNav}
          >
            <span className="nav-icon">🎮</span>
            <span className="nav-text">Players & OPs</span>
          </NavLink>

          <NavLink
            to="/console"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            onClick={closeSidebarOnNav}
          >
            <span className="nav-icon">🖥️</span>
            <span className="nav-text">Interactive Console</span>
          </NavLink>

          <NavLink
            to="/xbox"
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            onClick={closeSidebarOnNav}
          >
            <span className="nav-icon">🌐</span>
            <span className="nav-text">Console & Public Access</span>
            <span className="nav-badge-pill" style={{ background: '#107c10', color: '#fff' }}>Crossplay</span>
          </NavLink>

          {isAdmin && (
            <>
              <div className="nav-group-label">CONFIGURATION & WORLDS</div>
              <NavLink
                to="/properties"
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                onClick={closeSidebarOnNav}
              >
                <span className="nav-icon">⚙️</span>
                <span className="nav-text">Server Properties</span>
              </NavLink>

              <NavLink
                to="/worlds"
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                onClick={closeSidebarOnNav}
              >
                <span className="nav-icon">🌍</span>
                <span className="nav-text">Worlds & Levels</span>
              </NavLink>

              <NavLink
                to="/backups"
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                onClick={closeSidebarOnNav}
              >
                <span className="nav-icon">💾</span>
                <span className="nav-text">Backup Archives</span>
              </NavLink>

              <NavLink
                to="/addons"
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                onClick={closeSidebarOnNav}
              >
                <span className="nav-icon">🧩</span>
                <span className="nav-text">Addons & Packs</span>
                <span className="nav-badge-pill">BP/RP</span>
              </NavLink>
            </>
          )}

          {isAdmin && (
            <>
              <div className="nav-group-label">SECURITY & ENGINE</div>
              <NavLink
                to="/users"
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                onClick={closeSidebarOnNav}
              >
                <span className="nav-icon">👥</span>
                <span className="nav-text">Users & Invites</span>
              </NavLink>

              <NavLink
                to="/settings"
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                onClick={closeSidebarOnNav}
              >
                <span className="nav-icon">⚙️</span>
                <span className="nav-text">Settings</span>
              </NavLink>

              <NavLink
                to="/versions"
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                onClick={closeSidebarOnNav}
              >
                <span className="nav-icon">📦</span>
                <span className="nav-text">BDS Versions</span>
              </NavLink>

              <NavLink
                to="/audit"
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                onClick={closeSidebarOnNav}
              >
                <span className="nav-icon">📋</span>
                <span className="nav-text">Audit Trail</span>
              </NavLink>
            </>
          )}
        </nav>

        {/* Sidebar Footer User Info (Clickable shortcut to Settings) */}
        <div
          className="sidebar-user-card clickable-user-card"
          onClick={() => {
            closeSidebarOnNav();
            navigate('/settings');
          }}
          title="Click to manage admin login & settings"
        >
          <div className="user-avatar-badge">
            {user?.username?.[0]?.toUpperCase() || 'A'}
          </div>
          <div className="user-details-group">
            <span className="user-display-name">{user?.username || 'admin'}</span>
            <span className={`user-role-tag ${user?.role === 'admin' ? 'role-admin' : 'role-viewer'}`}>
              {user?.role === 'admin' ? '🛡️ Administrator' : '👁️ Viewer'}
            </span>
          </div>
          <span className="user-settings-gear" title="Admin Settings">⚙️</span>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="main-wrapper">
        {/* Top Floating Glass Header */}
        <header className="top-header">
          <div className="header-left">
            <button className="mobile-toggle-btn" onClick={toggleSidebar} aria-label="Toggle navigation">
              ☰
            </button>
            <div className="header-breadcrumbs">
              <span className="crumb-app">Minecraft BDS</span>
              <span className="crumb-sep">/</span>
              <span className="crumb-current">{getPageTitle()}</span>
            </div>
          </div>

          <div className="header-center">
            {/* Live Server Status Indicator Pill */}
            <div className={`server-status-pill status-${serverStatus.state?.toLowerCase()}`}>
              <span className="pulse-indicator-dot" />
              <span className="status-pill-text">
                {serverStatus.state === 'running' && 'Server Online'}
                {serverStatus.state === 'starting' && 'Starting Up...'}
                {serverStatus.state === 'stopping' && 'Halting...'}
                {serverStatus.state === 'stopped' && 'Server Offline'}
              </span>
            </div>

            {/* Xbox Live Bot Global Status Notifier Pill */}
            <div
              className={`xbox-status-pill ${
                xboxStatus?.state === 'running'
                  ? 'status-online'
                  : xboxStatus?.pendingLogin
                  ? 'status-pending'
                  : xboxStatus?.account?.authenticated
                  ? 'status-idle'
                  : 'status-offline'
              }`}
              onClick={() => navigate('/xbox')}
              title="Xbox Live Bot Connection Status (Click to open tab)"
            >
              <span className="xbox-pill-logo">🎮</span>
              <span className="xbox-pill-dot" />
              <span className="xbox-pill-text">
                {xboxStatus?.state === 'running'
                  ? `Xbox: ${xboxStatus?.account?.gamertag || 'Relay Active'}`
                  : xboxStatus?.pendingLogin
                  ? 'Xbox: Login Code Ready'
                  : xboxStatus?.account?.authenticated
                  ? `Xbox: ${xboxStatus?.account?.gamertag} (Ready)`
                  : 'Xbox: Disconnected'}
              </span>
            </div>

            {/* Global Master Power Controls (Start All / Restart All / Stop All) */}
            {canControl && (
              <div className="header-master-controls">
                <button
                  type="button"
                  className="btn-header-power btn-start-all"
                  onClick={handleStartAll}
                  disabled={actionLoading !== null || (serverStatus.state === 'running' && tunnelStatus?.isRunning && xboxStatus?.state === 'running')}
                  title="Start Bedrock Server, Playit Tunnel, and Xbox Bot Relay all at once"
                >
                  <span className="header-btn-icon">{actionLoading === 'start-all' ? '⏳' : '▶'}</span>
                  <span>{actionLoading === 'start-all' ? 'Starting...' : 'Start All'}</span>
                </button>

                <button
                  type="button"
                  className="btn-header-power btn-restart-all"
                  onClick={handleRestartAll}
                  disabled={actionLoading !== null}
                  title="Restart Bedrock Server, Playit Tunnel, and Xbox Bot Relay all at once"
                >
                  <span className="header-btn-icon">{actionLoading === 'restart-all' ? '⏳' : '🔄'}</span>
                  <span>{actionLoading === 'restart-all' ? 'Restarting...' : 'Restart All'}</span>
                </button>

                {(serverStatus.state === 'running' || tunnelStatus?.isRunning || xboxStatus?.state === 'running') && (
                  <button
                    type="button"
                    className="btn-header-power btn-stop-all"
                    onClick={handleStopAll}
                    disabled={actionLoading !== null}
                    title="Stop Bedrock Server, Playit Tunnel, and Xbox Bot Relay"
                  >
                    <span className="header-btn-icon">{actionLoading === 'stop-all' ? '⏳' : '⏹'}</span>
                    <span>{actionLoading === 'stop-all' ? 'Stopping...' : 'Stop All'}</span>
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="header-right">
            <div className="header-user-actions">
              <span className="user-pill-chip">
                <span className="chip-avatar">{user?.username?.[0]?.toUpperCase() || 'A'}</span>
                <span className="chip-name">{user?.username}</span>
              </span>
              <button onClick={handleLogout} className="btn-logout" title="Sign Out of Panel">
                <span className="logout-icon">🚪</span>
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </header>

        {actionToast && (
          <div className={`header-action-toast toast-${actionToast.type}`}>
            <span>{actionToast.type === 'success' ? '✓' : '⚠️'}</span>
            <span>{actionToast.text}</span>
            <button
              onClick={() => setActionToast(null)}
              style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', marginLeft: '0.4rem' }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Page Content Container */}
        <main className="content-container">
          <Outlet />
        </main>

        {/* Modern Mobile App Bottom Navigation Bar */}
        <nav className="mobile-bottom-nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}
            onClick={closeSidebarOnNav}
          >
            <span className="mobile-nav-icon">⚡</span>
            <span className="mobile-nav-label">Dashboard</span>
          </NavLink>

          <NavLink
            to="/xbox"
            className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}
            onClick={closeSidebarOnNav}
          >
            <div className="mobile-nav-icon-wrap">
              <span className="mobile-nav-icon">🎮</span>
              {xboxStatus?.account?.authenticated && (
                <span className={`mobile-nav-badge-dot ${xboxStatus?.state === 'running' ? 'live' : 'ready'}`} />
              )}
            </div>
            <span className="mobile-nav-label">Xbox Bot</span>
          </NavLink>

          <NavLink
            to="/console"
            className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}
            onClick={closeSidebarOnNav}
          >
            <span className="mobile-nav-icon">🖥️</span>
            <span className="mobile-nav-label">Console</span>
          </NavLink>

          <NavLink
            to="/players"
            className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}
            onClick={closeSidebarOnNav}
          >
            <span className="mobile-nav-icon">👥</span>
            <span className="mobile-nav-label">Players</span>
          </NavLink>

          <button
            type="button"
            className={`mobile-nav-item mobile-nav-menu-btn ${sidebarOpen ? 'active' : ''}`}
            onClick={toggleSidebar}
            aria-label="Open full menu drawer"
          >
            <span className="mobile-nav-icon">☰</span>
            <span className="mobile-nav-label">Menu</span>
          </button>
        </nav>
      </div>
    </div>
  );
};

export default Layout;
