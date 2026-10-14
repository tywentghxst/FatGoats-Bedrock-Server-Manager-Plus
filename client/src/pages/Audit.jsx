import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';

export const Audit = () => {
  const { user } = useAuth();

  const [logs, setLogs] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  // Pagination & Filtering
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [selectedFilter, setSelectedFilter] = useState('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  // Selected entry modal for full details
  const [detailEntry, setDetailEntry] = useState(null);

  const fetchLogs = useCallback(async (currentOffset, append = false) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const data = await api.Audit.getLogs(limit, currentOffset);
      let logList = [];
      let total = 0;

      if (Array.isArray(data)) {
        logList = data;
        total = data.length;
      } else if (data && typeof data === 'object') {
        logList = data.logs || data.items || data.rows || [];
        total = data.total || data.count || logList.length;
      }

      if (append) {
        setLogs((prev) => [...prev, ...logList]);
      } else {
        setLogs(logList);
      }

      setTotalCount(total);
      setHasMore(logList.length === limit);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
      setError(err.message || 'Failed to retrieve audit log history.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [limit]);

  useEffect(() => {
    fetchLogs(0, false);
  }, [fetchLogs]);

  const handleLoadMore = () => {
    const nextOffset = offset + limit;
    setOffset(nextOffset);
    fetchLogs(nextOffset, true);
  };

  const handleRefresh = () => {
    setOffset(0);
    fetchLogs(0, false);
  };

  // Color-coded action formatting
  const getActionBadge = (actionStr) => {
    const action = String(actionStr || '').toUpperCase();

    if (action.includes('START')) {
      return { className: 'badge badge-success', icon: '▶', text: actionStr };
    }
    if (action.includes('STOP') || action.includes('KILL')) {
      return { className: 'badge badge-error', icon: '⏹', text: actionStr };
    }
    if (action.includes('RESTART')) {
      return { className: 'badge badge-warning', icon: '↻', text: actionStr };
    }
    if (action.includes('BACKUP')) {
      return { className: 'badge badge-info', icon: '📦', text: actionStr };
    }
    if (action.includes('RESTORE')) {
      return { className: 'badge badge-warning', icon: '⏪', text: actionStr };
    }
    if (action.includes('ADDON') || action.includes('PACK')) {
      return { className: 'badge badge-behavior', icon: '🧩', text: actionStr };
    }
    if (action.includes('USER') || action.includes('ROLE') || action.includes('INVITE') || action.includes('AUTH') || action.includes('LOGIN')) {
      return { className: 'badge badge-admin', icon: '👤', text: actionStr };
    }
    if (action.includes('WORLD')) {
      return { className: 'badge badge-secondary', icon: '🌍', text: actionStr };
    }
    if (action.includes('VERSION') || action.includes('UPDATE')) {
      return { className: 'badge badge-info', icon: '🚀', text: actionStr };
    }
    if (action.includes('CONFIG') || action.includes('PROPERTIES')) {
      return { className: 'badge badge-secondary', icon: '⚙️', text: actionStr };
    }

    return { className: 'badge badge-secondary', icon: '📝', text: actionStr || 'UNKNOWN' };
  };

  const formatTimestamp = (dateVal) => {
    if (!dateVal) return '-';
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

  const formatDetailsPreview = (details) => {
    if (!details) return '-';
    if (typeof details === 'object') {
      try {
        return JSON.stringify(details);
      } catch {
        return String(details);
      }
    }
    return String(details);
  };

  // Filter and search
  const filteredLogs = logs.filter((entry) => {
    const action = String(entry.action || '').toUpperCase();
    const username = String(entry.username || entry.user || '').toLowerCase();
    const details = formatDetailsPreview(entry.details).toLowerCase();
    const query = searchTerm.toLowerCase();

    // Type filter
    if (selectedFilter !== 'ALL') {
      if (selectedFilter === 'SERVER' && !action.includes('START') && !action.includes('STOP') && !action.includes('RESTART')) {
        return false;
      }
      if (selectedFilter === 'BACKUP' && !action.includes('BACKUP') && !action.includes('RESTORE')) {
        return false;
      }
      if (selectedFilter === 'ADDON' && !action.includes('ADDON') && !action.includes('PACK')) {
        return false;
      }
      if (selectedFilter === 'USER' && !action.includes('USER') && !action.includes('ROLE') && !action.includes('INVITE') && !action.includes('LOGIN')) {
        return false;
      }
      if (selectedFilter === 'WORLD' && !action.includes('WORLD')) {
        return false;
      }
    }

    // Search query
    if (query) {
      return (
        username.includes(query) ||
        action.toLowerCase().includes(query) ||
        details.includes(query)
      );
    }

    return true;
  });

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Audit Trail & Security Logs</h1>
          <p className="page-subtitle">Track administrative actions, server lifecycle events, and configuration modifications</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleRefresh}
            disabled={loading || loadingMore}
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

      {/* Filter and Search Bar */}
      <div className="card mb-6">
        <div className="card-body">
          <div className="d-flex items-center justify-between gap-4 flex-wrap">
            <div className="d-flex items-center gap-3 flex-1 min-w-250">
              <label htmlFor="filterTypeSelect" className="text-sm font-semibold text-muted whitespace-nowrap">
                Action Type:
              </label>
              <select
                id="filterTypeSelect"
                className="form-select form-select-sm"
                value={selectedFilter}
                onChange={(e) => setSelectedFilter(e.target.value)}
              >
                <option value="ALL">All Actions</option>
                <option value="SERVER">Server Lifecycle (Start / Stop / Restart)</option>
                <option value="BACKUP">Backups & Restores</option>
                <option value="ADDON">Addons & Packs</option>
                <option value="WORLD">World Management</option>
                <option value="USER">User & Invites</option>
              </select>
            </div>

            <div className="d-flex items-center gap-2 flex-1 min-w-250">
              <input
                type="text"
                className="form-input form-input-sm w-full"
                placeholder="Search user, action, or details..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setSearchTerm('')}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="card">
        <div className="card-header d-flex justify-between items-center">
          <h2 className="card-title m-0">Event History</h2>
          <span className="text-muted text-sm">
            Showing {filteredLogs.length} of {totalCount || logs.length} events
          </span>
        </div>

        <div className="card-body p-0">
          {loading && logs.length === 0 ? (
            <div className="loading-container py-12">
              <div className="spinner" />
              <p className="text-muted mt-3">Loading audit records...</p>
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="empty-state py-12 text-center">
              <div className="empty-state-icon">📋</div>
              <h3>No Audit Entries Found</h3>
              <p className="text-muted">
                {searchTerm || selectedFilter !== 'ALL'
                  ? 'No events match your current filter criteria.'
                  : 'Action logs will record here as commands and changes occur.'}
              </p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-striped w-full">
                <thead>
                  <tr>
                    <th className="w-180">Timestamp</th>
                    <th className="w-140">User</th>
                    <th className="w-180">Action</th>
                    <th>Details</th>
                    <th className="w-80 text-right">Inspect</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map((entry, index) => {
                    const badgeInfo = getActionBadge(entry.action);
                    const userDisplay = entry.username || entry.user || 'System';
                    const timestampStr = formatTimestamp(entry.timestamp || entry.created_at || entry.createdAt || entry.time);
                    const detailsStr = formatDetailsPreview(entry.details);

                    return (
                      <tr key={entry.id || `${timestampStr}-${index}`}>
                        <td className="font-mono text-xs text-secondary whitespace-nowrap">
                          {timestampStr}
                        </td>
                        <td className="font-medium text-primary whitespace-nowrap">
                          <span className="user-icon-sm mr-1">👤</span>
                          {userDisplay}
                        </td>
                        <td>
                          <span className={badgeInfo.className}>
                            <span className="mr-1">{badgeInfo.icon}</span>
                            {badgeInfo.text}
                          </span>
                        </td>
                        <td className="font-mono text-xs text-secondary max-w-400 truncate" title={detailsStr}>
                          {detailsStr}
                        </td>
                        <td className="text-right">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setDetailEntry(entry)}
                            title="View full event payload"
                          >
                            View
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

        {/* Load More Footer */}
        {hasMore && !loading && (
          <div className="card-footer text-center py-4">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleLoadMore}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <>
                  <span className="spinner-sm mr-2" /> Loading Older Events...
                </>
              ) : (
                'Load More Entries'
              )}
            </button>
          </div>
        )}
      </div>

      {/* Entry Detail Modal */}
      {detailEntry && (
        <div className="modal-overlay" onClick={() => setDetailEntry(null)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3 className="modal-title">Audit Record Details</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setDetailEntry(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="mb-4 d-flex gap-4 flex-wrap">
                <div>
                  <span className="text-xs text-muted block">Timestamp</span>
                  <span className="font-mono text-sm">
                    {formatTimestamp(detailEntry.timestamp || detailEntry.created_at || detailEntry.createdAt)}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-muted block">User</span>
                  <span className="font-semibold text-primary">
                    {detailEntry.username || detailEntry.user || 'System'}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-muted block">Action</span>
                  <span className={getActionBadge(detailEntry.action).className}>
                    {detailEntry.action}
                  </span>
                </div>
                {detailEntry.ip && (
                  <div>
                    <span className="text-xs text-muted block">IP Address</span>
                    <span className="font-mono text-sm">{detailEntry.ip}</span>
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs font-semibold text-muted block mb-1">Raw Payload / Details:</label>
                <pre className="p-3 bg-darker rounded font-mono text-xs overflow-x-auto text-primary m-0">
                  {typeof detailEntry.details === 'object'
                    ? JSON.stringify(detailEntry.details, null, 2)
                    : (() => {
                        try {
                          const parsed = JSON.parse(detailEntry.details);
                          return JSON.stringify(parsed, null, 2);
                        } catch {
                          return String(detailEntry.details || 'No additional details.');
                        }
                      })()}
                </pre>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDetailEntry(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Audit;
