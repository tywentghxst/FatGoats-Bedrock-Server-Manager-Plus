const path = require('path');
const fs = require('fs');
const { Authflow, Titles } = require('prismarine-auth');
const bedrock = require('bedrock-protocol');
const db = require('../database');
const XboxLiveApi = require('./xboxLiveApi');
const config = require('../config');

class XboxBotService {
  constructor() {
    this.state = 'offline'; // 'offline' | 'awaiting_login' | 'authenticating' | 'running' | 'error'
    this.errorMessage = null;

    // Account data
    this.account = {
      authenticated: false,
      gamertag: null,
      displayPic: null,
      gamerscore: '0',
      xuid: null,
      userHash: null,
      xstsToken: null,
    };

    // Pending Device Code Login
    this.pendingLogin = null; // { userCode, verificationUri, expiresAt, message }

    // Active Server & Timers
    this.server = null;
    this.sessionName = `bsm_bot_${Date.now()}`;
    this.friendSyncInterval = null;
    this.presenceInterval = null;

    // Redirect & activity logs
    this.totalRedirects = 0;
    this.activityLogs = []; // Array of { id, timestamp, type, message, details }
    this.friendsList = [];

    // Cache directory for prismarine-auth
    this.authCacheDir = path.join(path.dirname(config.DB_PATH), 'auth_cache', 'xbox_bot');
    if (!fs.existsSync(this.authCacheDir)) {
      try {
        fs.mkdirSync(this.authCacheDir, { recursive: true });
      } catch (_) {}
    }

    // Try loading existing session on startup
    this._tryRestoreAuth();
  }

  // ---------------------------------------------------------------------------
  // Config helpers (persisted in SQLite settings table)
  // ---------------------------------------------------------------------------
  getConfig() {
    return {
      targetIp: db.getSetting('xbox_target_ip', '127.0.0.1'),
      targetPort: parseInt(db.getSetting('xbox_target_port', '19132'), 10),
      listenPort: parseInt(db.getSetting('xbox_listen_port', '19133'), 10),
      autoAcceptFriends: db.getSetting('xbox_auto_accept', 'true') === 'true',
      showInPortal: db.getSetting('portal_show_xbox_bot', 'true') === 'true',
      serverName: db.getSetting('xbox_server_name', 'Bedrock Dedicated Realm'),
      redirectMode: db.getSetting('xbox_redirect_mode', 'transfer'), // 'transfer' or 'relay'
    };
  }

  updateConfig(newConfig) {
    if (newConfig.targetIp !== undefined) {
      db.setSetting('xbox_target_ip', String(newConfig.targetIp).trim());
    }
    if (newConfig.targetPort !== undefined) {
      db.setSetting('xbox_target_port', String(newConfig.targetPort).trim());
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
    if (newConfig.redirectMode !== undefined) {
      db.setSetting('xbox_redirect_mode', String(newConfig.redirectMode).trim());
    }
    this._logActivity('CONFIG', 'Bot configuration updated', newConfig);
    return this.getConfig();
  }

  // ---------------------------------------------------------------------------
  // Status payload
  // ---------------------------------------------------------------------------
  getStatus() {
    return {
      state: this.state,
      errorMessage: this.errorMessage,
      account: {
        authenticated: this.account.authenticated,
        gamertag: this.account.gamertag,
        displayPic: this.account.displayPic,
        gamerscore: this.account.gamerscore,
        xuid: this.account.xuid,
      },
      pendingLogin: this.pendingLogin,
      config: this.getConfig(),
      stats: {
        totalRedirects: this.totalRedirects,
        friendsCount: this.friendsList.length,
      },
      recentLogs: this.activityLogs.slice(-25).reverse(),
    };
  }

  // ---------------------------------------------------------------------------
  // Authentication: Restore, Device Code Flow, Token Input, Logout
  // ---------------------------------------------------------------------------
  async _tryRestoreAuth() {
    try {
      // Check if cache actually exists and is non-empty before trying restore
      const liveCacheFile = path.join(this.authCacheDir, 'fab18c_live-cache.json');
      if (!fs.existsSync(liveCacheFile)) return;
      const content = fs.readFileSync(liveCacheFile, 'utf8').trim();
      if (!content || content === '{}') return;

      const flow = new Authflow('bsm_bedrock_bot', this.authCacheDir, {
        flow: 'live',
        authTitle: Titles.MinecraftNintendoSwitch,
      });

      const tokenRes = await flow.getXboxToken('http://xboxlive.com');
      const xstsToken = tokenRes && (tokenRes.XSTSToken || tokenRes.xstsToken);
      if (tokenRes && tokenRes.userXUID && tokenRes.userHash && xstsToken) {
        this.account.userHash = tokenRes.userHash;
        this.account.xstsToken = xstsToken;
        this.account.xuid = tokenRes.userXUID;
        this.account.authenticated = true;

        // Fetch profile
        const profile = await XboxLiveApi.getProfile({
          userHash: tokenRes.userHash,
          xstsToken: xstsToken,
          xuid: tokenRes.userXUID,
        });

        this.account.gamertag = profile.gamertag;
        this.account.displayPic = profile.displayPic;
        this.account.gamerscore = profile.gamerscore;

        console.log(`[XboxBotService] Restored Xbox Live session: ${profile.gamertag} (${tokenRes.userXUID})`);
        this._logActivity('AUTH', `Restored Xbox Live session for ${profile.gamertag}`);
      }
    } catch (_) {
      // Session not yet present or expired; user will connect via UI
    }
  }

  /**
   * Start 1-Click Microsoft Device Code Flow
   */
  async startLogin() {
    this.errorMessage = null;
    this.state = 'awaiting_login';

    let codeReceivedResolve;
    const codeReceivedPromise = new Promise((resolve) => {
      codeReceivedResolve = resolve;
    });

    const onDeviceCode = (deviceCodeData) => {
      this.pendingLogin = {
        userCode: deviceCodeData.user_code,
        verificationUri: deviceCodeData.verification_uri || 'https://www.microsoft.com/link',
        message: deviceCodeData.message,
        expiresAt: Date.now() + (deviceCodeData.expires_in || 900) * 1000,
      };
      this._logActivity('AUTH', `Device code generated: ${deviceCodeData.user_code}. Awaiting user login.`);
      if (codeReceivedResolve) codeReceivedResolve();
    };

    const flow = new Authflow('bsm_bedrock_bot', this.authCacheDir, {
      flow: 'live',
      authTitle: Titles.MinecraftNintendoSwitch,
    }, onDeviceCode);

    // Run auth in background and resolve once complete
    flow.getXboxToken('http://xboxlive.com', onDeviceCode)
      .then(async (tokenRes) => {
        this.pendingLogin = null;
        const xstsToken = tokenRes && (tokenRes.XSTSToken || tokenRes.xstsToken);
        this.account.userHash = tokenRes.userHash;
        this.account.xstsToken = xstsToken;
        this.account.xuid = tokenRes.userXUID;
        this.account.authenticated = true;

        const profile = await XboxLiveApi.getProfile({
          userHash: tokenRes.userHash,
          xstsToken: xstsToken,
          xuid: tokenRes.userXUID,
        });

        this.account.gamertag = profile.gamertag;
        this.account.displayPic = profile.displayPic;
        this.account.gamerscore = profile.gamerscore;

        this.state = 'offline';
        this._logActivity('AUTH', `Successfully logged in to Microsoft account: ${profile.gamertag}`);
      })
      .catch((err) => {
        console.error('[XboxBotService] Login failed:', err);
        this.pendingLogin = null;
        this.state = 'error';

        let friendlyMsg = err.message;
        const cause = err.cause?.message || err.cause?.code || '';
        if (friendlyMsg.includes('fetch failed') || cause.includes('ENOTFOUND') || cause.includes('ETIMEDOUT') || cause.includes('ECONNREFUSED')) {
          friendlyMsg = `Network / DNS failure: Unable to reach Microsoft login servers (login.live.com). Please check your internet connection or VPN/Firewall settings (${cause || 'fetch failed'}).`;
        }

        this.errorMessage = `Authentication failed: ${friendlyMsg}`;
        this._logActivity('ERROR', `Authentication failed: ${friendlyMsg}`);
        if (codeReceivedResolve) codeReceivedResolve();
      });

    // Wait up to 4 seconds for Microsoft to return device code
    await Promise.race([
      codeReceivedPromise,
      new Promise((resolve) => setTimeout(resolve, 4000)),
    ]);

    return {
      success: true,
      message: 'Device code flow started. Follow prompt to authenticate.',
      pendingLogin: this.pendingLogin,
    };
  }

  cancelLogin() {
    this.pendingLogin = null;
    if (this.state === 'awaiting_login') {
      this.state = 'offline';
    }
    return { success: true, message: 'Pending login cancelled.' };
  }

  async setManualToken(tokenPayload) {
    try {
      this.errorMessage = null;
      // If user inputs manual { userHash, xstsToken, xuid } or JWT
      let parsed = tokenPayload;
      if (typeof tokenPayload === 'string') {
        try {
          parsed = JSON.parse(tokenPayload);
        } catch (_) {
          parsed = { xstsToken: tokenPayload };
        }
      }

      if (!parsed.userHash || !parsed.xstsToken || !parsed.xuid) {
        throw new Error('Manual token must contain userHash, xstsToken, and xuid.');
      }

      this.account.userHash = parsed.userHash;
      this.account.xstsToken = parsed.xstsToken;
      this.account.xuid = parsed.xuid;
      this.account.authenticated = true;

      const profile = await XboxLiveApi.getProfile({
        userHash: parsed.userHash,
        xstsToken: parsed.xstsToken,
        xuid: parsed.xuid,
      });

      this.account.gamertag = profile.gamertag;
      this.account.displayPic = profile.displayPic;
      this.account.gamerscore = profile.gamerscore;

      this._logActivity('AUTH', `Manual token verified for ${profile.gamertag}`);
      return { success: true, profile };
    } catch (err) {
      throw new Error(`Failed to apply manual token: ${err.message}`);
    }
  }

  async logout() {
    await this.stopBot();
    this.account = {
      authenticated: false,
      gamertag: null,
      displayPic: null,
      gamerscore: '0',
      xuid: null,
      userHash: null,
      xstsToken: null,
    };
    this.pendingLogin = null;
    this.state = 'offline';

    // Wipe cached token directory
    try {
      if (fs.existsSync(this.authCacheDir)) {
        fs.rmSync(this.authCacheDir, { recursive: true, force: true });
        fs.mkdirSync(this.authCacheDir, { recursive: true });
      }
    } catch (_) {}

    this._logActivity('AUTH', 'Logged out and unlinked Microsoft account.');
    return { success: true, message: 'Logged out successfully.' };
  }

  // ---------------------------------------------------------------------------
  // Bot Power Controls: Start, Stop, Restart
  // ---------------------------------------------------------------------------
  async startBot() {
    if (this.state === 'running') {
      return { success: true, message: 'Bot is already running.' };
    }

    if (!this.account.authenticated) {
      throw new Error('Cannot start bot: Please connect a Microsoft Xbox Live account first.');
    }

    const cfg = this.getConfig();
    this.state = 'authenticating';
    this.errorMessage = null;

    try {
      this._logActivity('BOT', `Starting Bedrock Friend Relay on UDP 0.0.0.0:${cfg.listenPort} -> Target ${cfg.targetIp}:${cfg.targetPort}`);

      // 1. Start Bedrock Protocol Listener
      this.server = new bedrock.Server({
        host: '0.0.0.0',
        port: cfg.listenPort,
        offline: true,
        raknetBackend: 'jsp-raknet', // Pure JavaScript RakNet, 100% reliable on Windows Node 24
        version: '1.20.80',
        motd: {
          motd: cfg.serverName,
          levelName: 'World',
        },
      });

      this.server.on('connect', (client) => {
        const clientIp = client.connection?.address || 'Unknown';
        this._logActivity('JOIN', `Player connecting: [${clientIp}]. Sending redirection packet...`);

        client.on('join', () => {
          this.totalRedirects += 1;
          this._logActivity('REDIRECT', `✓ Successfully redirected player from ${clientIp} to ${cfg.targetIp}:${cfg.targetPort}`);

          // Send native Bedrock TransferPacket (0x55)
          try {
            client.write('transfer', {
              server_address: cfg.targetIp,
              port: Number(cfg.targetPort),
            });
          } catch (writeErr) {
            console.error('[XboxBotService] Error writing transfer packet:', writeErr.message);
          }
        });

        client.on('error', (err) => {
          console.debug('[XboxBotService] Client error:', err.message);
        });
      });

      await this.server.listen();
      this.state = 'running';
      this._logActivity('BOT', `✓ Bedrock listener online on port ${cfg.listenPort}`);

      // 2. Set Xbox Live Presence
      await XboxLiveApi.setPresence({
        userHash: this.account.userHash,
        xstsToken: this.account.xstsToken,
        xuid: this.account.xuid,
        state: 'Active',
      });

      // 3. Publish to Xbox Live Multiplayer Session Directory (MPSD)
      this.sessionName = `bsm_bot_${Date.now()}`;
      await XboxLiveApi.publishMultiplayerSession({
        userHash: this.account.userHash,
        xstsToken: this.account.xstsToken,
        xuid: this.account.xuid,
        sessionName: this.sessionName,
        serverAddress: cfg.targetIp,
        serverPort: cfg.listenPort,
        worldName: cfg.serverName,
      });

      this._logActivity('XBOX', `✓ Multiplayer session published on Xbox Live for ${this.account.gamertag}`);

      // 4. Heartbeat presence timer
      this.presenceInterval = setInterval(async () => {
        if (this.state === 'running' && this.account.authenticated) {
          await XboxLiveApi.setPresence({
            userHash: this.account.userHash,
            xstsToken: this.account.xstsToken,
            xuid: this.account.xuid,
            state: 'Active',
          });
        }
      }, 45000);

      // 5. Auto-accept friend requests worker
      if (cfg.autoAcceptFriends) {
        this._syncFriends();
        this.friendSyncInterval = setInterval(() => {
          if (this.state === 'running' && this.getConfig().autoAcceptFriends) {
            this._syncFriends();
          }
        }, 30000);
      }

      return {
        success: true,
        message: `Xbox Live Bot running! Friends can join ${this.account.gamertag} to be redirected.`,
      };
    } catch (err) {
      this.state = 'error';
      this.errorMessage = err.message;
      this._logActivity('ERROR', `Failed to start bot: ${err.message}`);
      await this.stopBot();
      throw err;
    }
  }

  async stopBot() {
    if (this.friendSyncInterval) {
      clearInterval(this.friendSyncInterval);
      this.friendSyncInterval = null;
    }
    if (this.presenceInterval) {
      clearInterval(this.presenceInterval);
      this.presenceInterval = null;
    }

    if (this.server) {
      try {
        await this.server.close();
      } catch (_) {}
      this.server = null;
    }

    // Unregister session from Xbox Live
    if (this.account.authenticated && this.sessionName) {
      try {
        await XboxLiveApi.deleteMultiplayerSession({
          userHash: this.account.userHash,
          xstsToken: this.account.xstsToken,
          sessionName: this.sessionName,
        });
        await XboxLiveApi.setPresence({
          userHash: this.account.userHash,
          xstsToken: this.account.xstsToken,
          xuid: this.account.xuid,
          state: 'Inactive',
        });
      } catch (_) {}
    }

    this.state = 'offline';
    this._logActivity('BOT', 'Bot stopped and Xbox session closed.');
    return { success: true, message: 'Bot stopped successfully.' };
  }

  async restartBot() {
    await this.stopBot();
    return await this.startBot();
  }

  async start() {
    return this.startBot();
  }

  async stop() {
    return this.stopBot();
  }

  async restart() {
    return this.restartBot();
  }

  // ---------------------------------------------------------------------------
  // Social: Friends & Auto-Accept
  // ---------------------------------------------------------------------------
  async _syncFriends() {
    if (!this.account.authenticated) return;
    try {
      const people = await XboxLiveApi.getPeople({
        userHash: this.account.userHash,
        xstsToken: this.account.xstsToken,
      });

      this.friendsList = people;

      // Find people who follow this bot but bot hasn't followed back
      const toAccept = people.filter(p => p.isFollowingCaller && !p.isFollowedByCaller);

      for (const p of toAccept) {
        try {
          await XboxLiveApi.addFriend({
            userHash: this.account.userHash,
            xstsToken: this.account.xstsToken,
            userXuid: this.account.xuid,
            targetXuid: p.xuid,
          });
          p.isFollowedByCaller = true;
          this._logActivity('FRIEND', `✓ Auto-accepted friend request from ${p.gamertag || p.displayName} (${p.xuid})`);
        } catch (addErr) {
          console.warn(`[XboxBotService] Failed to add friend ${p.xuid}:`, addErr.message);
        }
      }
    } catch (err) {
      console.warn('[XboxBotService] Friends sync error:', err.message);
    }
  }

  async getFriends() {
    await this._syncFriends();
    return {
      friendsCount: this.friendsList.length,
      friends: this.friendsList.map(p => ({
        xuid: p.xuid,
        gamertag: p.gamertag || p.displayName,
        displayPic: p.displayPicRaw,
        isFollowed: p.isFollowedByCaller,
        isFollowing: p.isFollowingCaller,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Activity Logging Helper
  // ---------------------------------------------------------------------------
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

// Singleton instance
const xboxBotService = new XboxBotService();
module.exports = xboxBotService;
