import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api, { getToken, setToken, clearToken } from '../api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setTokenState] = useState(getToken());
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    clearToken();
    setTokenState(null);
    setUser(null);
  }, []);

  const loadUser = useCallback(async () => {
    const savedToken = getToken();
    if (!savedToken) {
      setUser(null);
      setLoading(false);
      return;
    }

    try {
      const userData = await api.getMe();
      setUser(userData?.user || userData);
      setTokenState(savedToken);
    } catch (err) {
      console.error('Failed to validate auth token:', err);
      logout();
    } finally {
      setLoading(false);
    }
  }, [logout]);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const login = async (username, password) => {
    const res = await api.login(username, password);
    const receivedToken = res.token;
    setToken(receivedToken);
    setTokenState(receivedToken);
    if (res.user) {
      setUser(res.user);
    } else {
      const userData = await api.getMe();
      setUser(userData?.user || userData);
    }
    return res;
  };

  const register = async (username, password, inviteToken) => {
    const res = await api.register(username, password, inviteToken);
    if (res.token) {
      setToken(res.token);
      setTokenState(res.token);
      if (res.user) {
        setUser(res.user);
      } else {
        const userData = await api.getMe();
        setUser(userData?.user || userData);
      }
    }
    return res;
  };

  const updateCredentials = async (credentialsData) => {
    const res = await api.Auth.updateCredentials(credentialsData);
    if (res.token) {
      setToken(res.token);
      setTokenState(res.token);
    }
    if (res.user) {
      setUser(res.user);
    }
    return res;
  };

  const value = {
    user,
    token,
    loading,
    login,
    logout,
    register,
    updateCredentials,
    isAdmin: user?.role === 'admin',
    isOperator: user?.role === 'operator',
    canControlServer: user?.role === 'admin' || user?.role === 'operator',
    role: user?.role || 'viewer',
    isAuthenticated: !!user && !!token,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext;
