const TOKEN_KEY = 'bsm_jwt_token';

export const setToken = (token) => {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
};

export const getToken = () => {
  return localStorage.getItem(TOKEN_KEY);
};

export const clearToken = () => {
  localStorage.removeItem(TOKEN_KEY);
};

export const request = async (method, url, body = null, isFormData = false, extraHeaders = {}) => {
  const headers = { ...extraHeaders };
  const token = getToken();

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const options = {
    method,
    headers,
  };

  if (body) {
    if (isFormData) {
      options.body = body;
    } else {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
  }

  const response = await fetch(url, options);

  if (response.status === 401) {
    clearToken();
  }

  let data;
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    let errorMsg =
      (data && data.details) ||
      (data && data.message) ||
      (data && data.error);

    if (!errorMsg && typeof data === 'string') {
      const preMatch = data.match(/<pre>(.*?)<\/pre>/is);
      if (preMatch) {
        errorMsg = preMatch[1].trim();
      } else {
        const stripped = data.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        errorMsg = stripped || 'API Request Failed';
      }
    } else if (!errorMsg) {
      errorMsg = 'API Request Failed';
    }

    const error = new Error(errorMsg);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
};

// Nested API namespaces as requested in specification
export const Auth = {
  login: (username, password) => request('POST', '/api/auth/login', { username, password }),
  register: (username, password, inviteToken) =>
    request('POST', '/api/auth/register', { username, password, inviteToken }),
  getMe: () => request('GET', '/api/auth/me'),
  updateCredentials: (data) => request('PUT', '/api/auth/credentials', data),
};

export const Server = {
  getStatus: () => request('GET', '/api/server/status'),
  start: () => request('POST', '/api/server/start'),
  stop: () => request('POST', '/api/server/stop'),
  kill: () => request('POST', '/api/server/kill'),
  restart: () => request('POST', '/api/server/restart'),
  startAll: () => request('POST', '/api/server/start-all'),
  restartAll: () => request('POST', '/api/server/restart-all'),
  stopAll: () => request('POST', '/api/server/stop-all'),
  setTime: (time) => request('POST', '/api/server/time', { time }),
  setWeather: (weather) => request('POST', '/api/server/weather', { weather }),
  setDaylightCycle: (enable) => request('POST', '/api/server/daylight-cycle', { enable }),
};

export const Players = {
  list: () => request('GET', '/api/players'),
  setOp: (name, isOp) => request('POST', '/api/players/op', { name, isOp }),
  setPermission: (name, permission) => request('POST', '/api/players/permission', { name, permission }),
  setAllowlist: (name, isAllowlisted, xuid) => request('POST', '/api/players/allowlist', { name, isAllowlisted, xuid }),
  kick: (name, reason) => request('POST', '/api/players/kick', { name, reason }),
  add: (name, xuid, isOp, permission, isAllowlisted) =>
    request('POST', '/api/players/add', { name, xuid, isOp, permission, isAllowlisted }),
  delete: (name) => request('DELETE', `/api/players/${encodeURIComponent(name)}`),
};

export const Console = {
  getLogs: () => request('GET', '/api/console'),
  sendCommand: (command) => request('POST', '/api/console/command', { command }),
};

export const Properties = {
  get: () => request('GET', '/api/properties'),
  update: (properties) => request('PUT', '/api/properties', properties),
  getExperiments: async (worldName = '') => {
    try {
      return await request('GET', `/api/properties/experiments${worldName ? `?worldName=${encodeURIComponent(worldName)}` : ''}`);
    } catch (err) {
      if (err.status === 404) {
        return await request('GET', `/api/worlds/experiments${worldName ? `?worldName=${encodeURIComponent(worldName)}` : ''}`);
      }
      throw err;
    }
  },
  updateExperiments: async (experiments, worldName = '') => {
    try {
      return await request('PUT', '/api/properties/experiments', { experiments, worldName });
    } catch (err) {
      if (err.status === 404 || err.status === 405) {
        try {
          return await request('POST', '/api/properties/experiments', { experiments, worldName });
        } catch (_) {
          return await request('PUT', '/api/worlds/experiments', { experiments, worldName });
        }
      }
      throw err;
    }
  },
};

export const Worlds = {
  list: () => request('GET', '/api/worlds'),
  setActive: (name) => request('POST', '/api/worlds/active', { name }),
  delete: (name) => request('DELETE', `/api/worlds/${encodeURIComponent(name)}`),
};

export const Backups = {
  list: () => request('GET', '/api/backups'),
  create: (worldName) => request('POST', '/api/backups', { worldName }),
  restore: (filename) => request('POST', `/api/backups/${encodeURIComponent(filename)}/restore`),
  delete: (filename) => request('DELETE', `/api/backups/${encodeURIComponent(filename)}`),
  getSettings: () => request('GET', '/api/backups/settings'),
  updateSettings: (autoBackup, frequencyHours) =>
    request('POST', '/api/backups/settings', { autoBackup, frequencyHours }),
};

export const Addons = {
  list: () => request('GET', '/api/addons'),
  upload: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('addon', file);
    return request('POST', '/api/addons/upload', formData, true);
  },
  updateInPlace: (uuid, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return request('POST', `/api/addons/${encodeURIComponent(uuid)}/update`, formData, true);
  },
  scan: () => request('POST', '/api/addons/scan'),
  updateMetadata: (uuid, data) => request('PUT', `/api/addons/${encodeURIComponent(uuid)}`, data),
  searchUrl: (query, uuid) =>
    request('GET', `/api/addons/search-url?query=${encodeURIComponent(query || '')}&uuid=${encodeURIComponent(uuid || '')}`),
  delete: (uuid, options = {}) =>
    request('DELETE', `/api/addons/${encodeURIComponent(uuid)}${options.deleteCompanion ? '?deleteCompanion=true' : ''}`),
  getActive: () => request('GET', '/api/addons/active'),
  setActive: (behaviorPacks, resourcePacks) =>
    request('PUT', '/api/addons/active', { behaviorPacks, resourcePacks }),
  getDiagnostics: (geminiKey) => {
    const extraHeaders = geminiKey ? { 'X-Gemini-Key': geminiKey } : {};
    return request('POST', '/api/addons/diagnostics', { geminiKey }, false, extraHeaders);
  },
  autoFix: (action, targetUuid) => request('POST', '/api/addons/autofix', { action, targetUuid }),
  bulkAction: (action, uuids = null, options = {}) =>
    request('POST', '/api/addons/bulk', { action, uuids, ...options }),
  getSuggestions: () => request('GET', '/api/addons/suggestions'),
  swapPackType: (uuid, swapPair = false) =>
    request('POST', `/api/addons/${encodeURIComponent(uuid)}/swap`, { swapPair }),
};

export const Users = {
  list: () => request('GET', '/api/users'),
  updateRole: (id, role) => request('PUT', `/api/users/${encodeURIComponent(id)}/role`, { role }),
  delete: (id) => request('DELETE', `/api/users/${encodeURIComponent(id)}`),
  createInvite: (role) => request('POST', '/api/users/invites', { role }),
  getInvites: () => request('GET', '/api/users/invites'),
  deleteInvite: (id) => request('DELETE', `/api/users/invites/${encodeURIComponent(id)}`),
};

export const Versions = {
  getCurrent: () => request('GET', '/api/versions/current'),
  getAvailable: () => request('GET', '/api/versions/available'),
  install: (url) => request('POST', '/api/versions/install', { url }),
  installLatest: () => request('POST', '/api/versions/install-latest'),
  getSettings: () => request('GET', '/api/versions/settings'),
  updateSettings: (autoUpdate) => request('POST', '/api/versions/settings', { autoUpdate }),
  upload: (file) => {
    const formData = new FormData();
    formData.append('package', file);
    return request('POST', '/api/versions/upload', formData, true);
  },
};

export const Audit = {
  getLogs: (limit = 50, offset = 0) => request('GET', `/api/audit?limit=${limit}&offset=${offset}`),
};

export const Portal = {
  getConfig: () => request('GET', '/api/portal/config'),
  getStatus: () => request('GET', '/api/portal/status'),
  action: (action) => request('POST', '/api/portal/action', { action }),
  updateSettings: (settings) => request('PUT', '/api/portal/settings', settings),
};

export const Xbox = {
  getStatus: () => request('GET', '/api/xbox/status'),
  startLogin: () => request('POST', '/api/xbox/login/start'),
  cancelLogin: () => request('POST', '/api/xbox/login/cancel'),
  setToken: (token) => request('POST', '/api/xbox/login/token', { token }),
  logout: () => request('POST', '/api/xbox/logout'),
  start: () => request('POST', '/api/xbox/start'),
  stop: () => request('POST', '/api/xbox/stop'),
  restart: () => request('POST', '/api/xbox/restart'),
  updateConfig: (config) => request('PUT', '/api/xbox/config', config),
  getFriends: () => request('GET', '/api/xbox/friends'),
  syncFriends: () => request('POST', '/api/xbox/friends/sync'),
  acceptFriend: (xuid) => request('POST', '/api/xbox/friends/accept', { xuid }),
};

export const Tunnel = {
  getStatus: () => request('GET', '/api/tunnel/status'),
  start: () => request('POST', '/api/tunnel/start'),
  stop: () => request('POST', '/api/tunnel/stop'),
  restart: () => request('POST', '/api/tunnel/restart'),
  startClaim: () => request('POST', '/api/tunnel/claim/start'),
  submitSecret: (secret) => request('POST', '/api/tunnel/claim/secret', { secret }),
  reset: () => request('POST', '/api/tunnel/reset'),
  updateConfig: (config) => request('PUT', '/api/tunnel/config', config),
};

export const Updates = {
  getStatus: (forceFetch = false) => request('GET', `/api/updates/status${forceFetch ? '?fetch=true' : ''}`),
  getProgress: () => request('GET', '/api/updates/progress'),
  check: () => request('POST', '/api/updates/check'),
  setPreferences: (prefs) => request('POST', '/api/updates/preferences', prefs),
  apply: () => request('POST', '/api/updates/apply'),
};

const api = {
  setToken,
  getToken,
  clearToken,
  request,

  // Direct namespaces
  Auth,
  Server,
  Console,
  Players,
  Properties,
  Worlds,
  Backups,
  Addons,
  Users,
  Versions,
  Audit,
  Portal,
  Xbox,
  Tunnel,
  Updates,

  // Top-level aliases for flexibility
  login: Auth.login,
  register: Auth.register,
  getMe: Auth.getMe,
  updateCredentials: Auth.updateCredentials,

  getStatus: Server.getStatus,
  start: Server.start,
  stop: Server.stop,
  kill: Server.kill,
  restart: Server.restart,
  startAll: Server.startAll,
  restartAll: Server.restartAll,
  stopAll: Server.stopAll,

  getLogs: Console.getLogs,
  sendCommand: Console.sendCommand,

  getProperties: Properties.get,
  updateProperties: Properties.update,
  getExperiments: Properties.getExperiments,
  updateExperiments: Properties.updateExperiments,

  listWorlds: Worlds.list,
  setActiveWorld: Worlds.setActive,
  deleteWorld: Worlds.delete,

  listBackups: Backups.list,
  createBackup: Backups.create,
  restoreBackup: Backups.restore,
  deleteBackup: Backups.delete,

  listAddons: Addons.list,
  uploadAddon: Addons.upload,
  deleteAddon: Addons.delete,
  getActiveAddons: Addons.getActive,
  setActiveAddons: Addons.setActive,

  listUsers: Users.list,
  updateUserRole: Users.updateRole,
  deleteUser: Users.delete,
  createInvite: Users.createInvite,
  getInvites: Users.getInvites,
  deleteInvite: Users.deleteInvite,

  getCurrentVersion: Versions.getCurrent,
  getAvailableVersions: Versions.getAvailable,
  installVersion: Versions.install,
  installLatestVersion: Versions.installLatest,
  getVersionSettings: Versions.getSettings,
  updateVersionSettings: Versions.updateSettings,
  uploadVersion: Versions.upload,

  getAuditLogs: Audit.getLogs,

  // Portal aliases
  getPortalConfig: Portal.getConfig,
  getPortalStatus: Portal.getStatus,
  portalAction: Portal.action,
  updatePortalSettings: Portal.updateSettings,
};

export default api;
