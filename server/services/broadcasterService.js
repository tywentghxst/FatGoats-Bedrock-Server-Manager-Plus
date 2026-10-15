const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config');
const db = require('../database');
const playitService = require('./playitService');

class BroadcasterService {
  constructor() {
    this.process = null;
    this.state = 'offline'; // 'offline' | 'awaiting_login' | 'running' | 'error'
    this.errorMessage = null;

    // Account information
    this.account = {
      authenticated: false,
      gamertag: null,
      displayPic: null,
      gamerscore: '0',
      xuid: null,
    };

    // Pending Device Code Login
    this.pendingLogin = null; // { userCode, verificationUri, expiresAt, message }

    // Stats and logs
    this.totalRedirects = 0;
    this.friendsList = [];
    this.activityLogs = [];

    // Paths
    this.workingDir = path.join(__dirname, '..', '..', 'data', 'broadcaster');
    this.jarPath = path.join(this.workingDir, 'MCXboxBroadcastStandalone.jar');
    this.configFile = path.join(this.workingDir, 'config.yml');
    this.cacheDir = path.join(this.workingDir, 'cache');

    // Ensure working directory exists
    if (!fs.existsSync(this.workingDir)) {
      try {
        fs.mkdirSync(this.workingDir, { recursive: true });
      } catch (_) {}
    }

    // Try reading cached account if available
    this._checkCachedSession();

    // Auto-sync destination engine with Playit tunnel if active
    if (playitService && typeof playitService.on === 'function') {
      playitService.on('tunnelUpdate', (tunnelInfo) => {
        this._handleTunnelUpdate(tunnelInfo);
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Auto-sync Playit Tunnel handler
  // ---------------------------------------------------------------------------
  async _handleTunnelUpdate(tunnelInfo) {
    const autoSync = db.getSetting('xbox_auto_sync_playit', 'true') === 'true';
    if (!autoSync) return;

    if (tunnelInfo && tunnelInfo.isRunning && (tunnelInfo.publicIp || tunnelInfo.publicHost) && tunnelInfo.publicPort) {
      const target = tunnelInfo.publicIp || tunnelInfo.publicHost;
      const port = tunnelInfo.publicPort;
      this._logActivity('AUTOSYNC', `⚡ Auto-syncing Xbox bot destination to Playit tunnel: ${tunnelInfo.publicAddress} (Target: ${target}:${port})`);
      this.writeConfigFile();

      if (this.process && !this.process.killed) {
        this._logActivity('AUTOSYNC', 'Restarting MCXboxBroadcast session with new Playit tunnel destination...');
        this.restart().catch((err) => {
          console.error('[BroadcasterService] Error reloading broadcaster on tunnel update:', err);
        });
      }
    } else {
      const manualIp = db.getSetting('xbox_target_ip', '127.0.0.1');
      const manualPort = parseInt(db.getSetting('xbox_target_port', '19132'), 10) || 19132;
      this._logActivity('AUTOSYNC', `Playit tunnel offline. Reverting Xbox bot destination to local ${manualIp}:${manualPort}`);
      this.writeConfigFile();

      if (this.process && !this.process.killed) {
        this.restart().catch((err) => {
          console.error('[BroadcasterService] Error reloading broadcaster on tunnel stop:', err);
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------
  getConfig() {
    const autoSync = db.getSetting('xbox_auto_sync_playit', 'true') === 'true';
    const manualIp = db.getSetting('xbox_target_ip', '127.0.0.1');
    const manualPort = parseInt(db.getSetting('xbox_target_port', '19132'), 10) || 19132;

    let effectiveIp = manualIp;
    let effectivePort = manualPort;
    let isPlayitSynced = false;
    let playitAddress = null;
    let playitIp = null;

    if (autoSync && playitService) {
      try {
        const pStatus = playitService.getStatus();
        if (pStatus.isRunning && pStatus.publicAddress && pStatus.publicPort) {
          effectiveIp = playitService.publicIp || pStatus.publicHost || manualIp;
          effectivePort = pStatus.publicPort || manualPort;
          isPlayitSynced = true;
          playitAddress = pStatus.publicAddress;
          playitIp = playitService.publicIp || null;
        }
      } catch (_) {}
    }

    return {
      targetIp: manualIp,
      targetPort: manualPort,
      effectiveIp,
      effectivePort,
      autoSyncPlayit: autoSync,
      isPlayitSynced,
      playitAddress,
      playitIp,
      listenPort: parseInt(db.getSetting('xbox_listen_port', '19133'), 10),
      autoAcceptFriends: db.getSetting('xbox_auto_accept', 'true') === 'true',
      showInPortal: db.getSetting('portal_show_xbox_bot', 'true') === 'true',
      serverName: db.getSetting('xbox_server_name', 'Bedrock Dedicated Realm'),
    };
  }

  async updateConfig(newConfig) {
    if (newConfig.targetIp !== undefined) {
      db.setSetting('xbox_target_ip', String(newConfig.targetIp).trim());
    }
    if (newConfig.targetPort !== undefined) {
      db.setSetting('xbox_target_port', String(newConfig.targetPort).trim());
    }
    if (newConfig.autoSyncPlayit !== undefined) {
      db.setSetting('xbox_auto_sync_playit', Boolean(newConfig.autoSyncPlayit));
    }
    if (newConfig.listenPort !== undefined) {
      db.setSetting('xbox_listen_port', String(newConfig.listenPort).trim());
    }
    if (newConfig.autoAcceptFriends !== undefined) {
      db.setSetting('xbox_auto_accept', Boolean(newConfig.autoAcceptFriends));
    }
    if (newConfig.showInPortal !== undefined) {
      db.setSetting('portal_show_xbox_bot', Boolean(newConfig.showInPortal));
    }
    if (newConfig.serverName !== undefined) {
      db.setSetting('xbox_server_name', String(newConfig.serverName).trim());
    }

    this.writeConfigFile();
    this._logActivity('CONFIG', 'Broadcaster configuration updated', newConfig);

    // If broadcaster is currently running, reload it in the background so HTTP response is instant
    if (this.process && !this.process.killed) {
      this._logActivity('CONFIG', 'Reloading MCXboxBroadcast with new destination engine settings...');
      this.restart().catch((err) => {
        console.error('[BroadcasterService] Error reloading broadcaster on config change:', err);
      });
    }

    return this.getConfig();
  }

  writeConfigFile() {
    const cfg = this.getConfig();
    const serverName = cfg.serverName || 'Bedrock Dedicated Realm';
    // When autoSyncPlayit is true and Playit is active, use the live Playit tunnel destination
    const targetIp = (cfg.autoSyncPlayit && cfg.isPlayitSynced && cfg.effectiveIp) ? cfg.effectiveIp : (cfg.targetIp || '127.0.0.1');
    const targetPort = (cfg.autoSyncPlayit && cfg.isPlayitSynced && cfg.effectivePort) ? cfg.effectivePort : (cfg.targetPort || 19132);
    const autoAccept = cfg.autoAcceptFriends ? 'true' : 'false';

    const yamlContent = `# MCXboxBroadcast Standalone Configuration
# Managed automatically by Bedrock Server Manager
session:
  update-interval: 30
  query-server: true
  web-query-fallback: false
  config-fallback: true
  session-info:
    host-name: "${serverName.replace(/"/g, '\\"')}"
    world-name: "${serverName.replace(/"/g, '\\"')}"
    game-mode: Survival
    players: 0
    max-players: 35
    ip: "${targetIp}"
    port: ${targetPort}
  ice-port-range:
    min: 0
    max: 0

friend-sync:
  update-interval: 60
  auto-friend: ${autoAccept}
  initial-invite: true
  expiry:
    enabled: true
    days: 15
    check: 1800

notifications:
  enabled: false
  webhook-url: ''

debug-mode: false
suppress-session-update-message: false
`;

    try {
      fs.writeFileSync(this.configFile, yamlContent, 'utf8');
      console.log(`[BroadcasterService] config.yml written successfully (Target: ${targetIp}:${targetPort}${cfg.isPlayitSynced ? ' [Playit Synced]' : ''}).`);
    } catch (err) {
      console.error('[BroadcasterService] Error writing config.yml:', err.message);
    }
  }

  // ---------------------------------------------------------------------------
  // Cache inspection
  // ---------------------------------------------------------------------------
  _checkCachedSession() {
    try {
      const cacheJsonPath = path.join(this.cacheDir, 'cache.json');
      if (fs.existsSync(cacheJsonPath)) {
        const cacheData = JSON.parse(fs.readFileSync(cacheJsonPath, 'utf8'));
        if (cacheData && cacheData.xboxUserProfile) {
          const profile = cacheData.xboxUserProfile;
          const settings = profile.settings || {};
          const gamertag = settings.Gamertag || settings.AppDisplayName;
          const pic = settings.AppDisplayPicRaw || settings.GameDisplayPicRaw;
          const xuid = profile.id;
          if (gamertag) {
            this.account.authenticated = true;
            this.account.gamertag = gamertag;
            this.account.xuid = xuid;
            if (pic) {
              this.account.displayPic = pic;
              db.setSetting('broadcaster_display_pic', pic);
            }
            db.setSetting('broadcaster_gamertag', gamertag);
            if (xuid) db.setSetting('broadcaster_xuid', xuid);
          }
        }
      }
    } catch (_) {}

    // Fallback to DB
    const savedGamertag = db.getSetting('broadcaster_gamertag', null);
    const savedXuid = db.getSetting('broadcaster_xuid', null);
    const savedPic = db.getSetting('broadcaster_display_pic', null);
    if (savedGamertag) {
      this.account.authenticated = true;
      this.account.gamertag = savedGamertag;
      if (savedXuid) this.account.xuid = savedXuid;
      if (savedPic) this.account.displayPic = savedPic;
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle Management
  // ---------------------------------------------------------------------------
  async start() {
    if (this.process && !this.process.killed) {
      return {
        success: true,
        message: 'MCXboxBroadcast is already running.',
        pendingLogin: this.pendingLogin,
      };
    }

    if (!fs.existsSync(this.jarPath)) {
      throw new Error(`MCXboxBroadcast jar not found at ${this.jarPath}. Please verify download.`);
    }

    this.writeConfigFile();
    this.errorMessage = null;
    this.state = 'starting';

    this._logActivity('PROCESS', 'Starting MCXboxBroadcast Standalone (Java)...');

    return new Promise((resolve, reject) => {
      let resolved = false;

      try {
        const child = spawn('java', ['-jar', 'MCXboxBroadcastStandalone.jar'], {
          cwd: this.workingDir,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        this.process = child;

        child.stdout.on('data', (data) => {
          const lines = data.toString().split(/\r?\n/).filter(Boolean);
          for (const line of lines) {
            this._handleLogLine(line);
          }

          if (!resolved) {
            resolved = true;
            resolve({
              success: true,
              message: 'MCXboxBroadcast process started.',
              pendingLogin: this.pendingLogin,
            });
          }
        });

        child.stderr.on('data', (data) => {
          const lines = data.toString().split(/\r?\n/).filter(Boolean);
          for (const line of lines) {
            this._handleLogLine(line);
          }
        });

        child.on('error', (err) => {
          console.error('[BroadcasterService] Failed to spawn java process:', err);
          if (this.process === child) {
            this.state = 'error';
            this.errorMessage = `Failed to launch MCXboxBroadcast: ${err.message}`;
            this._logActivity('ERROR', this.errorMessage);
          }
          if (!resolved) {
            resolved = true;
            reject(new Error(this.errorMessage || err.message));
          }
        });

        child.on('close', (code) => {
          console.log(`[BroadcasterService] Process exited with code ${code}`);
          this._logActivity('PROCESS', `MCXboxBroadcast process exited (code ${code})`);
          if (this.process === child) {
            this.process = null;
            this.state = 'offline';
          }
        });

        // Resolve after 4 seconds if stdout didn't fire immediately
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve({
              success: true,
              message: 'MCXboxBroadcast process started.',
              pendingLogin: this.pendingLogin,
            });
          }
        }, 4000);

      } catch (err) {
        this.state = 'error';
        this.errorMessage = err.message;
        this._logActivity('ERROR', `Error starting broadcaster: ${err.message}`);
        reject(err);
      }
    });
  }

  async stop() {
    if (!this.process || this.process.killed) {
      this.state = 'offline';
      this.process = null;
      return { success: true, message: 'Broadcaster is already stopped.' };
    }

    const proc = this.process;
    this._logActivity('PROCESS', 'Stopping MCXboxBroadcast...');

    return new Promise((resolve) => {
      let resolved = false;
      const done = () => {
        if (!resolved) {
          resolved = true;
          if (this.process === proc) {
            this.process = null;
            this.state = 'offline';
          }
          this._logActivity('PROCESS', 'MCXboxBroadcast stopped.');
          resolve({ success: true, message: 'MCXboxBroadcast stopped successfully.' });
        }
      };

      try {
        proc.stdin.write('stop\n');
      } catch (_) {}

      proc.once('close', done);

      // Force kill fallback if not closed within 2.5s
      setTimeout(() => {
        if (!proc.killed) {
          try { proc.kill(); } catch (_) {}
        }
        done();
      }, 2500);
    });
  }

  async restart() {
    await this.stop();
    await new Promise((res) => setTimeout(res, 1200));
    return await this.start();
  }

  // ---------------------------------------------------------------------------
  // Log line parser & Auth detection
  // ---------------------------------------------------------------------------
  // Log line parser & Auth detection
  // ---------------------------------------------------------------------------
  _handleLogLine(line) {
    const clean = line.trim();
    if (!clean) return;

    // Strip ANSI terminal color sequences for robust regex matching
    const uncolored = clean.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').trim();

    console.log(`[MCXboxBroadcast] ${uncolored}`);
    this._logActivity('LOG', uncolored);

    // 1. Detect device login prompt:
    // e.g. "To sign in, use a web browser to open the page https://www.microsoft.com/link and use the code 8STYVU6P or visit http://microsoft.com/link?otc=8STYVU6P"
    let userCode = null;
    let verificationUri = 'https://www.microsoft.com/link';

    const otcMatch = uncolored.match(/microsoft\.com\/link\?otc=([A-Z0-9]+)/i);
    if (otcMatch) {
      userCode = otcMatch[1].trim();
      verificationUri = `https://www.microsoft.com/link?otc=${userCode}`;
    } else {
      const codeMatch = uncolored.match(/(?:open the page|go to)\s+(https:\/\/(?:www\.)?microsoft\.com\/(?:link|devicelogin))\s+(?:and (?:enter|use) the code|code:?)\s+([A-Z0-9]+)/i)
        || uncolored.match(/(?:enter the code|use the code|code:?)\s+([A-Z0-9]{6,12})/i);
      if (codeMatch) {
        if (codeMatch.length >= 3) {
          verificationUri = codeMatch[1];
          userCode = codeMatch[2].trim();
        } else if (codeMatch.length === 2) {
          userCode = codeMatch[1].trim();
          verificationUri = `https://www.microsoft.com/link?otc=${userCode}`;
        }
      }
    }

    if (userCode) {
      const fullUri = verificationUri.includes('?otc=') ? verificationUri : `https://www.microsoft.com/link?otc=${userCode}`;
      this.pendingLogin = {
        userCode,
        verificationUri: fullUri,
        expiresAt: Date.now() + 15 * 60 * 1000,
        message: uncolored,
      };
      this.state = 'awaiting_login';
      this._logActivity('AUTH', `Microsoft Device Code generated: ${userCode}. Link: ${fullUri}`);
      return;
    }

    // 2. Detect Successful Login / Gamertag
    // e.g. "Successfully authenticated as The FatGoats595 (2535472796844934) with 10/1000 friends"
    // e.g. "Signed in as <Gamertag> (<XUID>)"
    // e.g. "Logged in as <Gamertag>"
    const signinMatch = uncolored.match(/(?:Successfully authenticated as|Signed in as|Logged in as:?|Authenticated as|Logged in as user)\s+([^(]+?)(?:\s+\(([0-9]+)\))?(?:\s+with\s+([0-9]+)(?:\/[0-9]+)?\s+friends)?(?:\s*$|\s+with)/i);
    if (signinMatch) {
      const gamertag = signinMatch[1].trim();
      const xuid = signinMatch[2] ? signinMatch[2].trim() : this.account.xuid;
      const fCount = signinMatch[3] ? parseInt(signinMatch[3], 10) : null;

      this.account.authenticated = true;
      this.account.gamertag = gamertag;
      if (xuid) this.account.xuid = xuid;
      if (fCount !== null && !isNaN(fCount)) {
        this.friendsCount = fCount;
      }
      this.account.displayPic = `https://avatar.xboxlive.com/avatar/${encodeURIComponent(gamertag)}/avatarpic-l.png`;
      this.pendingLogin = null;
      this.state = 'running';

      // Persist in DB settings so session info survives restart
      db.setSetting('broadcaster_gamertag', gamertag);
      if (xuid) db.setSetting('broadcaster_xuid', xuid);

      this._logActivity('AUTH', `✓ Signed in to Xbox Live as: ${gamertag}${xuid ? ` (${xuid})` : ''}`);
      return;
    }

    // 2b. Also detect XUID if logged on separate line
    const xuidMatch = uncolored.match(/XUID:?\s*([0-9]{12,24})/i);
    if (xuidMatch && this.account.authenticated && !this.account.xuid) {
      this.account.xuid = xuidMatch[1].trim();
      db.setSetting('broadcaster_xuid', this.account.xuid);
    }

    // 3. Detect Session Manager started or broadcast updated
    if (
      uncolored.includes('Creation of Xbox LIVE session was successful') ||
      uncolored.includes('NetherNet Broadcaster started') ||
      uncolored.includes('SessionManager') ||
      uncolored.includes('Session created') ||
      uncolored.includes('Updated session!') ||
      uncolored.includes('Starting NetherNet')
    ) {
      this.state = 'running';
      this.pendingLogin = null;
    }

    // 4. Detect player redirect / join
    if (uncolored.includes('Redirecting') || uncolored.includes('Transferring') || uncolored.includes('Connected client') || uncolored.includes('Player joined')) {
      this.totalRedirects += 1;
      this._logActivity('REDIRECT', `Player join detected: ${uncolored}`);
    }

    // 5. Detect friend auto-accept
    if (uncolored.includes('Added friend') || uncolored.includes('Accepted friend') || uncolored.includes('friend request')) {
      this._logActivity('FRIEND', uncolored);
    }
  }

  // ---------------------------------------------------------------------------
  // Account Linking & Logout
  // ---------------------------------------------------------------------------
  async startLogin() {
    this.errorMessage = null;

    // If already authenticated and bot process is running, return current status
    if (this.account.authenticated && this.process && !this.process.killed) {
      return {
        success: true,
        authenticated: true,
        account: this.account,
        message: `Already authenticated as ${this.account.gamertag}.`,
      };
    }

    // If we already have a valid pending login code that hasn't expired, return it immediately
    if (this.pendingLogin && this.pendingLogin.expiresAt > Date.now()) {
      return {
        success: true,
        pendingLogin: this.pendingLogin,
        message: 'Device code active. Follow link to authenticate.',
      };
    }

    // Reset pending login
    this.pendingLogin = null;
    this.state = 'awaiting_login';

    // If not authenticated, ensure stale cache doesn't prevent new device code generation
    if (!this.account.authenticated) {
      try {
        const cacheFile = path.join(this.cacheDir, 'cache.json');
        if (fs.existsSync(cacheFile)) {
          fs.unlinkSync(cacheFile);
        }
      } catch (_) {}
    }

    // If process is running but not authenticated or has no valid code, restart it fresh
    if (this.process && !this.process.killed) {
      this._logActivity('AUTH', 'Restarting MCXboxBroadcast to generate fresh device code...');
      await this.restart();
    } else {
      this._logActivity('AUTH', 'Starting MCXboxBroadcast to generate device code...');
      await this.start();
    }

    // Wait up to 15 seconds for device code (or auto-authentication) to appear
    const maxWaitMs = 15000;
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      if (this.pendingLogin) {
        return {
          success: true,
          message: 'Device code generated. Follow link to authenticate.',
          pendingLogin: this.pendingLogin,
        };
      }
      if (this.account.authenticated) {
        return {
          success: true,
          authenticated: true,
          account: this.account,
          message: `Authenticated as ${this.account.gamertag}`,
        };
      }
      if (this.state === 'error') {
        throw new Error(this.errorMessage || 'MCXboxBroadcast process encountered an error during login.');
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    return {
      success: true,
      message: this.pendingLogin
        ? 'Device code generated. Follow link to authenticate.'
        : 'MCXboxBroadcast is initializing. Check logs or wait a moment for the device code.',
      pendingLogin: this.pendingLogin,
    };
  }

  cancelLogin() {
    this.pendingLogin = null;
    if (this.state === 'awaiting_login') {
      this.stop();
    }
    return { success: true, message: 'Pending login cancelled.' };
  }

  async logout() {
    await this.stop();
    this.account = {
      authenticated: false,
      gamertag: null,
      displayPic: null,
      gamerscore: '0',
      xuid: null,
    };
    this.pendingLogin = null;
    this.state = 'offline';

    db.setSetting('broadcaster_gamertag', '');
    db.setSetting('broadcaster_xuid', '');
    db.setSetting('broadcaster_display_pic', '');

    // Wipe cached token folder
    try {
      if (fs.existsSync(this.cacheDir)) {
        fs.rmSync(this.cacheDir, { recursive: true, force: true });
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
    } catch (_) {}

    this._logActivity('AUTH', 'Unlinked Microsoft account and cleared cache.');
    return { success: true, message: 'Logged out successfully.' };
  }

  // ---------------------------------------------------------------------------
  // Friends List & Incoming Requests via Xbox Live PeopleHub
  // ---------------------------------------------------------------------------
  async getFriends(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this.cachedFriendsData && (now - (this.lastFriendsFetchTime || 0) < 20000)) {
      return this.cachedFriendsData;
    }

    let token = null;
    let userHash = null;

    try {
      const cacheJsonPath = path.join(this.cacheDir, 'cache.json');
      if (fs.existsSync(cacheJsonPath)) {
        const cacheData = JSON.parse(fs.readFileSync(cacheJsonPath, 'utf8'));
        if (cacheData?.xboxLiveXstsToken?.token) {
          token = cacheData.xboxLiveXstsToken.token;
          userHash = cacheData.xboxLiveXstsToken.userHash;
        }
      }
    } catch (_) {}

    const friends = [];
    const requests = [];

    if (token && userHash) {
      const authHeader = `XBL3.0 x=${userHash};${token}`;
      try {
        const socialRes = await fetch('https://peoplehub.xboxlive.com/users/me/people/social', {
          headers: {
            'Authorization': authHeader,
            'x-xbl-contract-version': '1',
          },
          signal: AbortSignal.timeout(6000),
        });

        if (socialRes.ok) {
          const data = await socialRes.json();
          for (const p of data.people || []) {
            const item = {
              xuid: p.xuid,
              gamertag: p.gamertag,
              displayName: p.displayName || p.gamertag,
              displayPic: p.displayPicRaw,
              presence: p.presenceState || 'Offline',
              presenceText: p.presenceText || (p.presenceState === 'Online' ? 'Online' : 'Offline'),
              isFollowing: Boolean(p.isFollowingCaller),
              isFollowed: Boolean(p.isFollowedByCaller),
              isFavorite: Boolean(p.isFavorite),
              gamerScore: p.gamerScore || '0',
              addedAt: p.addedDateTimeUtc,
            };

            if (p.isFollowingCaller && !p.isFollowedByCaller) {
              requests.push(item);
            } else {
              friends.push(item);
            }
          }
        }
      } catch (err) {
        console.warn('[BroadcasterService] Could not fetch live PeopleHub friends:', err.message);
      }
    }

    // Fallback if PeopleHub was unavailable or token expired: check player_history.db
    if (friends.length === 0 && requests.length === 0) {
      try {
        const initSqlJs = require('sql.js');
        const dbFile = path.join(this.cacheDir, 'player_history.db');
        if (fs.existsSync(dbFile)) {
          const SQL = await initSqlJs();
          const filebuffer = fs.readFileSync(dbFile);
          const historyDb = new SQL.Database(filebuffer);
          const res = historyDb.exec('SELECT xuid, lastSeen FROM players ORDER BY lastSeen DESC');
          if (res.length && res[0].values) {
            for (const row of res[0].values) {
              const xuid = String(row[0]);
              const lastSeen = row[1] ? new Date(row[1] * 1000).toLocaleDateString() : null;
              friends.push({
                xuid,
                gamertag: `Xbox Player (${xuid.slice(-4)})`,
                displayName: `Player ${xuid.slice(-4)}`,
                displayPic: `https://avatar.xboxlive.com/avatar/${xuid}/avatarpic-l.png`,
                presence: 'Offline',
                presenceText: lastSeen ? `Last seen ${lastSeen}` : 'Offline',
                isFollowing: true,
                isFollowed: true,
                gamerScore: '0',
                addedAt: null,
              });
            }
          }
        }
      } catch (_) {}
    }

    this.friendsList = friends;
    this.requestsList = requests;
    this.lastFriendsFetchTime = Date.now();

    const result = {
      success: true,
      friendsCount: friends.length,
      requestsCount: requests.length,
      friends,
      requests,
    };

    this.cachedFriendsData = result;
    return result;
  }

  // ---------------------------------------------------------------------------
  // Accept / Follow Friend on Xbox Live
  // ---------------------------------------------------------------------------
  async acceptFriend(xuid) {
    if (!xuid) throw new Error('Target XUID is required');

    let token = null;
    let userHash = null;
    try {
      const cacheJsonPath = path.join(this.cacheDir, 'cache.json');
      if (fs.existsSync(cacheJsonPath)) {
        const cacheData = JSON.parse(fs.readFileSync(cacheJsonPath, 'utf8'));
        token = cacheData?.xboxLiveXstsToken?.token;
        userHash = cacheData?.xboxLiveXstsToken?.userHash;
      }
    } catch (_) {}

    if (!token || !userHash) {
      throw new Error('No active Xbox Live session token found to accept friend.');
    }

    const authHeader = `XBL3.0 x=${userHash};${token}`;
    const url = `https://social.xboxlive.com/users/me/people/xuid(${xuid})`;

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'x-xbl-contract-version': '2',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Xbox Live failed to add friend (${res.status}): ${txt}`);
    }

    this._logActivity('FRIEND', `✓ Accepted friend request for XUID ${xuid}`);
    this.cachedFriendsData = null;
    return await this.getFriends(true);
  }

  // ---------------------------------------------------------------------------
  // Status Payload (Compatible with existing UI & Portal)
  // ---------------------------------------------------------------------------
  getStatus() {
    const isProcRunning = Boolean(this.process && !this.process.killed);
    let effectiveState = this.state;
    if (!isProcRunning && effectiveState === 'running') {
      effectiveState = 'offline';
    }

    let displayPic = this.account.displayPic || db.getSetting('broadcaster_display_pic', null);
    if (!displayPic || displayPic.includes('avatar.xboxlive.com')) {
      try {
        const cacheJsonPath = path.join(this.cacheDir, 'cache.json');
        if (fs.existsSync(cacheJsonPath)) {
          const cacheData = JSON.parse(fs.readFileSync(cacheJsonPath, 'utf8'));
          displayPic = cacheData?.xboxUserProfile?.settings?.AppDisplayPicRaw || cacheData?.xboxUserProfile?.settings?.GameDisplayPicRaw;
          if (displayPic) {
            this.account.displayPic = displayPic;
            db.setSetting('broadcaster_display_pic', displayPic);
          }
        }
      } catch (_) {}
    }

    return {
      state: effectiveState,
      mode: 'MCXboxBroadcast',
      errorMessage: this.errorMessage,
      account: {
        authenticated: this.account.authenticated,
        gamertag: this.account.gamertag,
        displayPic: displayPic || (this.account.gamertag ? `https://avatar.xboxlive.com/avatar/${encodeURIComponent(this.account.gamertag)}/avatarpic-l.png` : null),
        gamerscore: this.account.gamerscore || '0',
        xuid: this.account.xuid,
      },
      pendingLogin: this.pendingLogin,
      config: this.getConfig(),
      stats: {
        totalRedirects: this.totalRedirects,
        friendsCount: this.friendsList.length || (this.cachedFriendsData?.friendsCount ?? 0) || this.friendsCount || 0,
        requestsCount: this.requestsList ? this.requestsList.length : (this.cachedFriendsData?.requestsCount ?? 0),
      },
      recentLogs: this.activityLogs.slice(-35).reverse(),
    };
  }

  _logActivity(type, message, details = null) {
    const entry = {
      id: Date.now() + Math.random(),
      timestamp: new Date().toISOString(),
      type,
      message,
      details,
    };
    this.activityLogs.push(entry);
    if (this.activityLogs.length > 200) {
      this.activityLogs.shift();
    }
  }
}

// Singleton export
const broadcasterService = new BroadcasterService();
module.exports = broadcasterService;
