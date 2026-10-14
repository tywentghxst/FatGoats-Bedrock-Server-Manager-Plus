import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export const Login = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [inviteToken, setInviteToken] = useState('');
  const [showInviteInput, setShowInviteInput] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const from = location.state?.from?.pathname || '/';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password.trim()) {
      setError('Please provide both username and password.');
      return;
    }

    setLoading(true);
    try {
      await login(username.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message || 'Invalid username or password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoToRegister = (e) => {
    e.preventDefault();
    if (inviteToken.trim()) {
      navigate(`/register/${encodeURIComponent(inviteToken.trim())}`);
    } else {
      setShowInviteInput(true);
    }
  };

  return (
    <div className="auth-page-container">
      {/* Decorative ambient background orbs */}
      <div className="auth-ambient-orb orb-1" />
      <div className="auth-ambient-orb orb-2" />

      <div className="auth-card">
        {/* Card Header */}
        <div className="auth-header">
          <div className="auth-logo-badge">
            <span className="auth-logo-glyph">⛏️</span>
          </div>
          <h1 className="auth-title">Bedrock Dedicated Server</h1>
          <p className="auth-subtitle">Administration Panel & Telemetry Hub</p>
          <div className="auth-version-pill">
            <span className="auth-pill-dot" />
            <span>Dedicated Server Engine v1.21</span>
          </div>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="auth-error-alert" role="alert">
            <span className="error-icon">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {/* Credentials Form */}
        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label className="form-label" htmlFor="username">
              <span className="label-icon">👤</span>
              <span>Username</span>
            </label>
            <div className="input-wrapper">
              <input
                id="username"
                type="text"
                className="form-control"
                placeholder="Enter your username (e.g. admin)"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                disabled={loading}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">
              <span className="label-icon">🔒</span>
              <span>Password</span>
            </label>
            <div className="input-wrapper">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                className="form-control"
                placeholder="Enter your account password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                disabled={loading}
              />
              <button
                type="button"
                className="btn-toggle-password"
                onClick={() => setShowPassword(!showPassword)}
                title={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                {showPassword ? '👁️' : '👁️‍🗨️'}
              </button>
            </div>
          </div>

          <button type="submit" className="btn-auth-submit" disabled={loading}>
            {loading ? (
              <span className="btn-loading-flex">
                <span className="spinner-dots" /> Authenticating...
              </span>
            ) : (
              <span>Sign In to Panel →</span>
            )}
          </button>
        </form>

        {/* Quick hint for default login */}
        <div className="auth-hint-banner">
          <span className="hint-label">Default Credentials:</span>
          <code className="hint-code">admin</code> / <code className="hint-code">admin</code>
        </div>

        {/* Invite Registration Section */}
        <div className="auth-footer">
          <div className="auth-divider">
            <span className="divider-line" />
            <span className="divider-text">OR</span>
            <span className="divider-line" />
          </div>

          {!showInviteInput ? (
            <button
              type="button"
              className="btn-invite-link"
              onClick={() => setShowInviteInput(true)}
            >
              <span>🎟️ Have an invite token?</span>
              <span className="link-highlight">Register an account</span>
            </button>
          ) : (
            <div className="invite-token-box">
              <label className="invite-label">Registration Token</label>
              <div className="invite-input-row">
                <input
                  type="text"
                  className="form-control form-control-sm"
                  placeholder="Paste invite token here"
                  value={inviteToken}
                  onChange={(e) => setInviteToken(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleGoToRegister}
                  disabled={!inviteToken.trim()}
                >
                  Continue →
                </button>
              </div>
              <button
                type="button"
                className="btn-cancel-invite"
                onClick={() => setShowInviteInput(false)}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Login;
