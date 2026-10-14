import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';

export const Users = () => {
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin';

  // Data states
  const [users, setUsers] = useState([]);
  const [invites, setInvites] = useState([]);

  // Form states
  const [inviteRole, setInviteRole] = useState('viewer');
  const [isCreatingInvite, setIsCreatingInvite] = useState(false);

  // Status & modal states
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [copyFeedback, setCopyFeedback] = useState(null);

  const [deleteUserModal, setDeleteUserModal] = useState(null);
  const [isDeletingUser, setIsDeletingUser] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState(null);

  const [deleteInviteModal, setDeleteInviteModal] = useState(null);
  const [isDeletingInvite, setIsDeletingInvite] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersRes, invitesRes] = await Promise.allSettled([
        api.Users.list(),
        api.Users.getInvites(),
      ]);

      if (usersRes.status === 'fulfilled') {
        const uData = usersRes.value;
        setUsers(Array.isArray(uData) ? uData : uData?.users || []);
      } else {
        console.error('Failed to load users:', usersRes.reason);
        setError('Failed to fetch user list.');
      }

      if (invitesRes.status === 'fulfilled') {
        const iData = invitesRes.value;
        setInvites(Array.isArray(iData) ? iData : iData?.invites || []);
      } else {
        console.error('Failed to load invites:', invitesRes.reason);
      }
    } catch (err) {
      console.error('Error fetching users and invites:', err);
      setError(err.message || 'Error communicating with server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRoleChange = async (userId, newRole) => {
    setUpdatingUserId(userId);
    setError(null);
    setSuccessMsg(null);
    try {
      await api.Users.updateRole(userId, newRole);
      setSuccessMsg(`User role successfully changed to ${newRole}.`);
      await loadData();
    } catch (err) {
      console.error('Failed to update user role:', err);
      setError(err.message || 'Failed to update user role.');
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handleDeleteUser = async (userId) => {
    if (String(userId) === String(currentUser?.id) || deleteUserModal?.username === currentUser?.username) {
      setError('You cannot delete your own account.');
      setDeleteUserModal(null);
      return;
    }

    setIsDeletingUser(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await api.Users.delete(userId);
      setSuccessMsg(`User "${deleteUserModal?.username}" was deleted.`);
      setDeleteUserModal(null);
      await loadData();
    } catch (err) {
      console.error('Failed to delete user:', err);
      setError(err.message || 'Failed to delete user.');
    } finally {
      setIsDeletingUser(false);
    }
  };

  const handleCreateInvite = async (e) => {
    e.preventDefault();
    setIsCreatingInvite(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await api.Users.createInvite(inviteRole);
      setSuccessMsg(`New invite token for role "${inviteRole}" generated!`);
      await loadData();
    } catch (err) {
      console.error('Failed to create invite token:', err);
      setError(err.message || 'Failed to generate invite token.');
    } finally {
      setIsCreatingInvite(false);
    }
  };

  const handleDeleteInvite = async (inviteId) => {
    setIsDeletingInvite(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await api.Users.deleteInvite(inviteId);
      setSuccessMsg('Invite token deleted.');
      setDeleteInviteModal(null);
      await loadData();
    } catch (err) {
      console.error('Failed to delete invite:', err);
      setError(err.message || 'Failed to delete invite.');
    } finally {
      setIsDeletingInvite(false);
    }
  };

  const copyToClipboard = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback(`Copied ${label} to clipboard!`);
      setTimeout(() => setCopyFeedback(null), 3000);
    } catch (err) {
      console.error('Clipboard copy failed:', err);
      setError('Could not copy to clipboard.');
    }
  };

  const getFullInviteUrl = (token) => {
    return `${window.location.origin}/register/${encodeURIComponent(token)}`;
  };

  const formatDate = (dateVal) => {
    if (!dateVal) return '-';
    try {
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return String(dateVal);
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return String(dateVal);
    }
  };

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">User & Access Management</h1>
          <p className="page-subtitle">Manage server administrator accounts, viewer access, and invitation tokens</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={loadData}
            disabled={loading}
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
      {successMsg && (
        <div className="toast toast-success" role="alert">
          <span className="toast-icon">✓</span>
          <div className="toast-content">{successMsg}</div>
          <button type="button" className="toast-close" onClick={() => setSuccessMsg(null)}>✕</button>
        </div>
      )}
      {copyFeedback && (
        <div className="toast toast-success" role="alert">
          <span className="toast-icon">📋</span>
          <div className="toast-content">{copyFeedback}</div>
          <button type="button" className="toast-close" onClick={() => setCopyFeedback(null)}>✕</button>
        </div>
      )}

      {/* Users Table */}
      <div className="card mb-6">
        <div className="card-header d-flex justify-between items-center">
          <h2 className="card-title m-0">Registered Users ({users.length})</h2>
          <span className="text-muted text-sm">Authenticated panel users</span>
        </div>
        <div className="card-body p-0">
          {loading && users.length === 0 ? (
            <div className="loading-container py-12">
              <div className="spinner" />
              <p className="text-muted mt-3">Fetching accounts...</p>
            </div>
          ) : users.length === 0 ? (
            <div className="empty-state py-8 text-center">
              <p className="text-muted">No users found.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-striped w-full">
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Current Role</th>
                    <th>Change Role</th>
                    <th>Created Date</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const isSelf = String(u.id) === String(currentUser?.id) || u.username === currentUser?.username;
                    const isUpdating = updatingUserId === u.id;

                    return (
                      <tr key={u.id || u.username}>
                        <td className="font-semibold text-primary">
                          <span className="user-avatar-icon mr-2">👤</span>
                          {u.username}
                          {isSelf && <span className="badge badge-secondary ml-2">You</span>}
                        </td>
                        <td>
                          {u.role === 'admin' ? (
                            <span className="badge badge-admin">Admin</span>
                          ) : u.role === 'operator' ? (
                            <span className="badge badge-operator">Operator</span>
                          ) : (
                            <span className="badge badge-viewer">Viewer</span>
                          )}
                        </td>
                        <td>
                          <select
                            className="form-select form-select-sm"
                            value={u.role || 'viewer'}
                            onChange={(e) => handleRoleChange(u.id, e.target.value)}
                            disabled={isUpdating || isSelf || !isAdmin}
                            title={isSelf ? 'Cannot change own role' : !isAdmin ? 'Admin permission required' : 'Change user permissions'}
                          >
                            <option value="admin">Admin (Full Control)</option>
                            <option value="operator">Operator (View & Start/Stop/Restart Only)</option>
                            <option value="viewer">Viewer (Read Only)</option>
                          </select>
                        </td>
                        <td className="text-secondary text-sm">
                          {formatDate(u.created_at || u.createdAt || u.created)}
                        </td>
                        <td className="text-right">
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => setDeleteUserModal(u)}
                            disabled={isSelf || !isAdmin}
                            title={
                              isSelf
                                ? 'Cannot delete your own account'
                                : !isAdmin
                                ? 'Admin permission required'
                                : 'Delete account'
                            }
                          >
                            Delete
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

      {/* Invite Tokens Section */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title m-0">Invite Tokens</h2>
        </div>
        <div className="card-body">
          {/* Create Invite Form */}
          <form onSubmit={handleCreateInvite} className="invite-form-box p-4 bg-darker rounded mb-6">
            <h3 className="text-sm font-semibold mb-3">Generate New Registration Invite</h3>
            <div className="d-flex items-center gap-3 flex-wrap">
              <div className="form-group m-0 min-w-200">
                <label htmlFor="inviteRoleSelect" className="form-label text-xs">
                  Assigned Role for New User:
                </label>
                <select
                  id="inviteRoleSelect"
                  className="form-select form-select-sm"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  disabled={isCreatingInvite || !isAdmin}
                >
                  <option value="viewer">Viewer (View server & console, read-only)</option>
                  <option value="operator">Operator (View & Start/Stop/Restart Server)</option>
                  <option value="admin">Admin (Full server management & configuration)</option>
                </select>
              </div>

              <div className="pt-4">
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={isCreatingInvite || !isAdmin}
                  title={!isAdmin ? 'Admin permission required' : 'Generate invitation link'}
                >
                  {isCreatingInvite ? 'Generating...' : '➕ Generate Invite Token'}
                </button>
              </div>
            </div>
          </form>

          {/* Invites Table */}
          <h3 className="section-title text-sm mb-3">Existing Tokens ({invites.length})</h3>
          {invites.length === 0 ? (
            <div className="empty-state py-6 text-center">
              <p className="text-muted text-sm m-0">No active or previous invite tokens. Generate one above to invite operators or viewers.</p>
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-striped w-full">
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Assigned Role</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invites.map((inv) => {
                    const token = inv.token || inv.id;
                    const isUsed = Boolean(inv.used || inv.isUsed || inv.used_at || inv.usedAt);
                    const inviteUrl = getFullInviteUrl(token);

                    return (
                      <tr key={inv.id || token}>
                        <td className="font-mono text-xs">
                          <span className="token-pill">{token}</span>
                        </td>
                        <td>
                          {inv.role === 'admin' ? (
                            <span className="badge badge-admin">Admin</span>
                          ) : inv.role === 'operator' ? (
                            <span className="badge badge-operator">Operator</span>
                          ) : (
                            <span className="badge badge-viewer">Viewer</span>
                          )}
                        </td>
                        <td>
                          {isUsed ? (
                            <span className="badge badge-secondary">Used</span>
                          ) : (
                            <span className="badge badge-success">Available</span>
                          )}
                        </td>
                        <td className="text-secondary text-sm">
                          {formatDate(inv.created_at || inv.createdAt || inv.created)}
                        </td>
                        <td className="text-right">
                          <div className="d-flex justify-end gap-2">
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => copyToClipboard(token, 'token')}
                              title="Copy raw token"
                            >
                              Copy Token
                            </button>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => copyToClipboard(inviteUrl, 'registration link')}
                              title="Copy full registration link"
                            >
                              Copy Link
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              onClick={() => setDeleteInviteModal(inv)}
                              disabled={!isAdmin}
                              title={!isAdmin ? 'Admin permission required' : 'Revoke invite token'}
                            >
                              Delete
                            </button>
                          </div>
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

      {/* Delete User Modal */}
      {deleteUserModal && (
        <div className="modal-overlay" onClick={() => !isDeletingUser && setDeleteUserModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3 className="modal-title">Delete User Account</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => !isDeletingUser && setDeleteUserModal(null)}
                disabled={isDeletingUser}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p>
                Are you sure you want to delete user account <strong>"{deleteUserModal.username}"</strong>?
              </p>
              <div className="alert alert-danger mt-3">
                ⚠️ This user will immediately lose all access to the Bedrock Dedicated Server Manager.
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDeleteUserModal(null)}
                disabled={isDeletingUser}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => handleDeleteUser(deleteUserModal.id)}
                disabled={isDeletingUser}
              >
                {isDeletingUser ? 'Deleting...' : 'Delete User'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Invite Modal */}
      {deleteInviteModal && (
        <div className="modal-overlay" onClick={() => !isDeletingInvite && setDeleteInviteModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <h3 className="modal-title">Revoke Invite Token</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => !isDeletingInvite && setDeleteInviteModal(null)}
                disabled={isDeletingInvite}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p>
                Are you sure you want to revoke this invite token?
              </p>
              <div className="p-3 bg-darker rounded font-mono text-xs my-2">
                {deleteInviteModal.token || deleteInviteModal.id}
              </div>
              <p className="text-secondary text-sm">
                Anyone attempting to register with this link will no longer be permitted.
              </p>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDeleteInviteModal(null)}
                disabled={isDeletingInvite}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => handleDeleteInvite(deleteInviteModal.id || deleteInviteModal.token)}
                disabled={isDeletingInvite}
              >
                {isDeletingInvite ? 'Revoking...' : 'Revoke Token'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Users;
