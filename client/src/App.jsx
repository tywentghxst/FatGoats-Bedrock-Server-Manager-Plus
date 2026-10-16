import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';

// Pages
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Console from './pages/Console';
import Properties from './pages/Properties';
import Worlds from './pages/Worlds';
import Backups from './pages/Backups';
import Addons from './pages/Addons';
import Players from './pages/Players';
import Users from './pages/Users';
import Settings from './pages/Settings';
import Versions from './pages/Versions';
import Audit from './pages/Audit';
import PlayerPortal from './pages/PlayerPortal';
import XboxLive from './pages/XboxLive';

const RESERVED_PATHS = [
  'login', 'register', 'players', 'console', 'xbox',
  'properties', 'worlds', 'backups', 'addons', 'users',
  'settings', 'versions', 'audit', 'api'
];

const DynamicPortalRoute = () => {
  const { slug } = useParams();
  if (slug && RESERVED_PATHS.includes(slug.toLowerCase())) {
    return <Navigate to="/" replace />;
  }
  return <PlayerPortal />;
};

export const App = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public Authentication Routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/register/:token" element={<Register />} />

          {/* Dedicated Player Control Portal (Outside Admin Layout) */}
          <Route path="/server" element={<PlayerPortal />} />
          <Route path="/portal" element={<PlayerPortal />} />
          <Route path="/portal/:slug" element={<PlayerPortal />} />
          <Route path="/p/:slug" element={<PlayerPortal />} />

          {/* Protected Routes inside App Layout */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="players" element={<Players />} />
            <Route path="console" element={<Console />} />
            <Route path="xbox" element={<XboxLive />} />
            
            {/* Configuration & Management (Admin Only) */}
            <Route
              path="properties"
              element={
                <ProtectedRoute requireAdmin>
                  <Properties />
                </ProtectedRoute>
              }
            />
            <Route
              path="worlds"
              element={
                <ProtectedRoute requireAdmin>
                  <Worlds />
                </ProtectedRoute>
              }
            />
            <Route
              path="backups"
              element={
                <ProtectedRoute requireAdmin>
                  <Backups />
                </ProtectedRoute>
              }
            />
            <Route
              path="addons"
              element={
                <ProtectedRoute requireAdmin>
                  <Addons />
                </ProtectedRoute>
              }
            />

            {/* Admin-only Routes */}
            <Route
              path="users"
              element={
                <ProtectedRoute requireAdmin>
                  <Users />
                </ProtectedRoute>
              }
            />
            <Route
              path="settings"
              element={
                <ProtectedRoute requireAdmin>
                  <Settings />
                </ProtectedRoute>
              }
            />
            <Route
              path="versions"
              element={
                <ProtectedRoute requireAdmin>
                  <Versions />
                </ProtectedRoute>
              }
            />
            <Route
              path="audit"
              element={
                <ProtectedRoute requireAdmin>
                  <Audit />
                </ProtectedRoute>
              }
            />
          </Route>

          {/* Any other top-level custom slug (e.g. /play, /join, /custom) routes to PlayerPortal */}
          <Route path="/:slug" element={<DynamicPortalRoute />} />

          {/* Catch-all redirect to Dashboard */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
