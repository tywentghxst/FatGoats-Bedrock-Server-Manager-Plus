import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export const Register = () => {
  const { token: inviteToken } = useParams();
  const { register } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!inviteToken) {
      setError('Invite token is missing from the URL.');
      return;
    }

    if (!username.trim() || !password) {
      setError('Please fill in all required fields.');
      return;
    }

    if (password.length < 4) {
      setError('Password must be at least 4 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await register(username.trim(), password, inviteToken);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message || 'Registration failed. The invite token may be invalid or already used.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page-container">
      <div className="auth-ambient-orb orb-1" />
      <div className="auth-ambient-orb orb-2" />

      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-logo-badge">
            <span className="auth-logo-glyph">🎟️</span>
          </div>
          <h1 className="auth-title">Create Account</h1>
          <p className="auth-subtitle">Join the Bedrock Server Management Team</p>
          <div className="auth-version-pill">
            <span className="auth-pill-dot" />
            <span>Token: <code>{inviteToken?.slice(0, 16)}...</code></span>
          </div>
        </div>

        {error && (
          <div className="auth-error-alert" role="alert">
            <span className="error-icon">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label className="form-label" htmlFor="username">
              <span className="label-icon">👤</span>
              <span>Choose Username</span>
            </label>
            <div className="input-wrapper">
              <input
                id="username"
                type="text"
                className="form-control"
                placeholder="e.g. alex_operator"
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
              <span>Create Password</span>
            </label>
            <div className="input-wrapper">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                className="form-control"
                placeholder="Min. 4 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                disabled={loading}
              />
              <button
                type="button"
                className="btn-toggle-password"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? '👁️' : '👁️‍🗨️'}
              </button>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="confirmPassword">
              <span className="label-icon">🛡️</span>
              <span>Confirm Password</span>
            </label>
            <div className="input-wrapper">
              <input
                id="confirmPassword"
                type={showPassword ? 'text' : 'password'}
                className="form-control"
                placeholder="Re-enter password to verify"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
                disabled={loading}
              />
            </div>
          </div>

          <button type="submit" className="btn-auth-submit" disabled={loading}>
            {loading ? 'Creating Account...' : 'Complete Registration →'}
          </button>
        </form>

        <div className="auth-footer">
          <Link to="/login" className="btn-invite-link">
            <span>← Already have an account?</span>
            <span className="link-highlight">Back to Sign In</span>
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Register;
