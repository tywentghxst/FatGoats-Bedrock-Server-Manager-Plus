const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const https = require('https');
const EventEmitter = require('events');
const db = require('../database');

class PlayitService extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.exchangeProcess = null;
    this.state = 'stopped'; // 'stopped' | 'starting' | 'awaiting_claim' | 'running' | 'error'
    this.errorMessage = null;

    this.claimCode = null;
    this.claimUrl = null;
    this.publicAddress = null;
    this.publicHost = null;
    this.publicIp = null;
    this.publicPort = null;
    this.tunnels = [];
    this.logs = [];

    this.toolsDir = path.join(__dirname, '..', '..', 'data', 'tools', 'playit');
    this.binaryPath = path.join(this.toolsDir, 'playit.exe');
    this.secretPath = path.join(this.toolsDir, 'playit.toml');

    // Ensure directory exists
    if (!fs.existsSync(this.toolsDir)) {
      try {
        fs.mkdirSync(this.toolsDir, { recursive: true });
      } catch (_) {}
    }

    // Check if secret already exists
    this._checkExistingConfig();
  }

  _checkExistingConfig() {
    try {
      if (fs.existsSync(this.secretPath)) {
        const content = fs.readFileSync(this.secretPath, 'utf8').trim();
        if (content.length > 10 && content.includes('secret')) {
          return true;
        }
      }
    } catch (_) {}
    return false;
  }

  isClaimed() {
    return this._checkExistingConfig();
  }

  _addLog(msg, type = 'info') {
    const entry = {
      id: Date.now() + Math.random(),
      timestamp: new Date().toISOString(),
      type,
      message: String(msg).trim(),
    };
    this.logs.unshift(entry);
    if (this.logs.length > 80) {
      this.logs.pop();
    }
    console.log(`[PlayitService] [${type.toUpperCase()}] ${msg}`);
  }

  getConfig() {
    return {
      autoStart: db.getSetting('tunnel_auto_start', 'false') === 'true',
      targetPort: parseInt(db.getSetting('tunnel_target_port', '19132'), 10) || 19132,
      targetIp: db.getSetting('tunnel_target_ip', '127.0.0.1'),
      showInPortal: db.getSetting('portal_show_tunnel', 'true') === 'true',
    };
  }

  updateConfig(newConfig) {
    if (newConfig.autoStart !== undefined) {
      db.setSetting('tunnel_auto_start', String(Boolean(newConfig.autoStart)));
    }
    if (newConfig.targetPort !== undefined) {
      db.setSetting('tunnel_target_port', String(parseInt(newConfig.targetPort, 10) || 19132));
    }
    if (newConfig.targetIp !== undefined) {
      db.setSetting('tunnel_target_ip', String(newConfig.targetIp).trim() || '127.0.0.1');
    }
    if (newConfig.showInPortal !== undefined) {
      db.setSetting('portal_show_tunnel', String(Boolean(newConfig.showInPortal)));
    }
    return this.getConfig();
  }

  getTunnelInfo() {
    const isDaemonActive = Boolean(this.process && !this.process.killed);
    const effectiveState = isDaemonActive ? 'running' : this.state;
    return {
      isRunning: effectiveState === 'running',
      publicAddress: this.publicAddress,
      publicHost: this.publicHost,
      publicIp: this.publicIp,
      publicPort: this.publicPort,
    };
  }

  getStatus() {
    const isDaemonActive = Boolean(this.process && !this.process.killed);
    const effectiveState = isDaemonActive ? 'running' : this.state;
    if (effectiveState === 'running' && !this.publicAddress && this.isClaimed()) {
      try {
        this.refreshTunnels();
      } catch (_) {}
    }
    return {
      state: effectiveState,
      isRunning: effectiveState === 'running',
      isClaimed: this.isClaimed(),
      claimCode: this.claimCode,
      claimUrl: this.claimUrl,
      publicAddress: this.publicAddress,
      publicHost: this.publicHost,
      publicIp: this.publicIp,
      publicPort: this.publicPort,
      tunnels: this.tunnels,
      hasTunnels: Boolean(this.publicAddress || (this.tunnels && this.tunnels.length > 0)),
      logs: this.logs.slice(0, 30),
      errorMessage: this.errorMessage,
      config: this.getConfig(),
    };
  }

  async ensureBinary() {
    if (fs.existsSync(this.binaryPath)) {
      return true;
    }
    this._addLog('Downloading official signed Playit.gg agent for Windows...', 'process');
    this.state = 'starting';

    const url = 'https://github.com/playit-cloud/playit-agent/releases/download/v0.15.26/playit-windows-x86_64-signed.exe';
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(this.binaryPath);
      const download = (targetUrl) => {
        https.get(targetUrl, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return download(res.headers.location);
          }
          if (res.statusCode !== 200) {
            fs.unlink(this.binaryPath, () => {});
            return reject(new Error(`Failed to download playit binary: HTTP ${res.statusCode}`));
          }
          res.pipe(file);
          file.on('finish', () => {
            file.close(() => {
              this._addLog('Playit.gg binary downloaded successfully!', 'info');
              resolve(true);
            });
          });
        }).on('error', (err) => {
          fs.unlink(this.binaryPath, () => {});
          reject(err);
        });
      };
      download(url);
    });
  }

  async startClaimFlow() {
    try {
      await this.ensureBinary();
      this.stop();

      // Clear any previous unverified secret
      try {
        if (fs.existsSync(this.secretPath)) {
          fs.unlinkSync(this.secretPath);
        }
      } catch (_) {}

      this.claimCode = null;
      this.claimUrl = null;
      this.state = 'awaiting_claim';

      // Start daemon which connects as agent and produces claim URL
      await this.start();

      // Wait up to 3 seconds for claim URL to appear from daemon stdout
      for (let i = 0; i < 30; i++) {
        if (this.claimUrl) break;
        await new Promise((r) => setTimeout(r, 100));
      }

      return this.getStatus();
    } catch (err) {
      console.error('[PlayitService] Claim generation error:', err);
      this.state = 'error';
      this.errorMessage = err.message || 'Failed to start Playit claim flow';
      this._addLog(`Claim setup failed: ${this.errorMessage}`, 'error');
      throw err;
    }
  }

  async start() {
    try {
      await this.ensureBinary();

      if (this.process && !this.process.killed) {
        return this.getStatus();
      }

      this.errorMessage = null;
      this._addLog('Starting Playit.gg internet tunnel daemon...', 'process');

      this.process = spawn(
        this.binaryPath,
        ['-s', '--secret_path', this.secretPath, 'start'],
        {
          cwd: this.toolsDir,
          windowsHide: true,
        }
      );

      this.process.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        const lines = text.split('\n').filter((l) => l.trim().length > 0);
        for (const line of lines) {
          this._handleProcessLog(line);
        }
      });

      this.process.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        const lines = text.split('\n').filter((l) => l.trim().length > 0);
        for (const line of lines) {
          this._handleProcessLog(line, 'stderr');
        }
      });

      this.process.on('error', (err) => {
        console.error('[PlayitService] Process error:', err);
        this.state = 'error';
        this.errorMessage = err.message;
        this._addLog(`Process error: ${err.message}`, 'error');
      });

      this.process.on('close', (code) => {
        this.process = null;
        if (this.state !== 'stopped') {
          this.state = 'stopped';
        }
        this._addLog(`Playit tunnel daemon stopped (code: ${code})`, 'process');
      });

      // Poll tunnels after startup to fetch assigned public address
      setTimeout(() => this.refreshTunnels(), 2500);
      setTimeout(() => this.refreshTunnels(), 6000);

      // Brief pause to allow initial output
      await new Promise((r) => setTimeout(r, 400));

      return this.getStatus();
    } catch (err) {
      console.error('[PlayitService] Start failed:', err);
      this.state = 'error';
      this.errorMessage = err.message;
      this._addLog(`Start failed: ${err.message}`, 'error');
      throw err;
    }
  }

  _handleProcessLog(rawLine, stream = 'stdout') {
    const line = rawLine.trim();
    if (!line) return;

    const lower = line.toLowerCase();
    let type = 'info';
    if (lower.includes('error') || lower.includes('failed')) type = 'error';
    else if (lower.includes('warn')) type = 'warn';
    else if (lower.includes('tunnel') || lower.includes('claim')) type = 'tunnel';

    this._addLog(line, type);

    // 1. Detect 1-click claim URL
    const claimMatch = line.match(/https:\/\/playit\.gg\/claim\/([a-zA-Z0-9]+)/i);
    if (claimMatch) {
      this.claimCode = claimMatch[1];
      this.claimUrl = claimMatch[0];
      this.state = 'awaiting_claim';
      this._addLog(`✓ 1-Click Playit Claim Link Ready: ${this.claimUrl}`, 'auth');
      return;
    }

    // 2. Look for connection confirmations
    if (
      lower.includes('tunnel running') ||
      lower.includes('secret key valid') ||
      lower.includes('tunnel registered') ||
      lower.includes('setup tunnel') ||
      lower.includes('connected') ||
      lower.includes('got initial pong')
    ) {
      this.state = 'running';
      this.claimCode = null;
      this.claimUrl = null;
      this.refreshTunnels();
    }

    // 3. Look for public address pattern (e.g. *.ply.gg:port or *.playit.gg)
    const match = line.match(/([a-zA-Z0-9_\-\.]+\.(?:ply\.gg|playit\.gg):\d+)/i);
    if (match) {
      const prevAddr = this.publicAddress;
      this.publicAddress = match[1];
      const parts = this.publicAddress.split(':');
      this.publicHost = parts[0];
      this.publicPort = parseInt(parts[1], 10);
      this.state = 'running';
      this.claimCode = null;
      this.claimUrl = null;
      this._addLog(`✓ Live Public Bedrock Tunnel Address: ${this.publicAddress}`, 'tunnel');
      if (prevAddr !== this.publicAddress) {
        this.emit('tunnelUpdate', this.getTunnelInfo());
      }
    }
  }

  refreshTunnels() {
    if (!this.isClaimed()) return;

    try {
      const output = execSync(`"${this.binaryPath}" --secret_path "${this.secretPath}" tunnels list`, {
        cwd: this.toolsDir,
        encoding: 'utf8',
        windowsHide: true,
      });

      // 1. Try parsing JSON
      try {
        const data = JSON.parse(output);
        if (data && Array.isArray(data.tunnels)) {
          this.tunnels = data.tunnels;
          for (const t of data.tunnels) {
            const alloc = t.alloc?.data || t.assigned || {};
            const host = alloc.assigned_domain || alloc.ip_hostname || t.ip_hostname || t.hostname;
            const ip = alloc.tunnel_ip || alloc.static_ip4 || alloc.ip;
            const port = alloc.port_start || t.port || alloc.port;
            if (host && port) {
              const prevAddr = this.publicAddress;
              this.publicHost = host;
              this.publicIp = ip || null;
              this.publicPort = parseInt(port, 10);
              this.publicAddress = `${host}:${port}`;
              this.state = 'running';
              this._addLog(`✓ Live Public Bedrock Tunnel Address: ${this.publicAddress} (IP: ${ip || host})`, 'tunnel');
              if (prevAddr !== this.publicAddress) {
                this.emit('tunnelUpdate', this.getTunnelInfo());
              }
              return;
            }
          }
        }
      } catch (_) {}

      // 2. Fallback table line parsing
      const lines = output.split('\n').filter((l) => l.trim().length > 0);
      const parsed = [];

      for (const line of lines) {
        const tokens = line.trim().split(/\s+/);
        if (tokens.length >= 4 && !line.includes('{') && !line.includes('}')) {
          parsed.push({
            id: tokens[0],
            proto: tokens[1],
            count: tokens[2],
            address: tokens[3],
          });
        }
      }

      if (parsed.length > 0) {
        this.tunnels = parsed;
        const udpTunnel = parsed.find((t) => t.proto.toLowerCase().includes('udp')) || parsed[0];
        if (udpTunnel && udpTunnel.address) {
          this.publicAddress = udpTunnel.address;
          const [host, port] = this.publicAddress.split(':');
          this.publicHost = host;
          this.publicPort = parseInt(port, 10) || 19132;
          this.state = 'running';
          return;
        }
      }

      // 3. Fallback regex search for any *.ply.gg:port or *.playit.gg:port
      const match = output.match(/([a-zA-Z0-9_\-\.]+\.(?:ply\.gg|playit\.gg):\d+)/i);
      if (match) {
        this.publicAddress = match[1];
        const [host, port] = this.publicAddress.split(':');
        this.publicHost = host;
        this.publicPort = parseInt(port, 10) || 19132;
        this.state = 'running';
      }
    } catch (err) {
      // Ignore if process is starting
    }
  }

  stop() {
    this._addLog('Stopping Playit tunnel...', 'process');

    if (this.exchangeProcess) {
      try {
        this.exchangeProcess.kill();
      } catch (_) {}
      this.exchangeProcess = null;
    }

    if (this.process) {
      try {
        this.process.kill();
      } catch (_) {}
      this.process = null;
    }

    const prevAddr = this.publicAddress;
    this.state = 'stopped';
    this.claimCode = null;
    this.claimUrl = null;
    this.publicAddress = null;
    this.publicHost = null;
    this.publicIp = null;
    this.publicPort = null;
    if (prevAddr) {
      this.emit('tunnelUpdate', this.getTunnelInfo());
    }
    return this.getStatus();
  }

  restart() {
    this.stop();
    return new Promise((resolve) => {
      setTimeout(async () => {
        try {
          const res = await this.start();
          resolve(res);
        } catch (err) {
          resolve(this.getStatus());
        }
      }, 1000);
    });
  }

  reset() {
    this._addLog('Resetting Playit agent configuration...', 'warn');
    this.stop();

    try {
      if (fs.existsSync(this.secretPath)) {
        fs.unlinkSync(this.secretPath);
      }
    } catch (_) {}

    this.publicAddress = null;
    this.publicHost = null;
    this.publicPort = null;
    this.tunnels = [];
    this.claimCode = null;
    this.claimUrl = null;

    return this.startClaimFlow();
  }

  setSecretKey(secretKey) {
    if (!secretKey || typeof secretKey !== 'string' || secretKey.trim().length < 8) {
      throw new Error('Invalid Playit Secret Key format.');
    }

    const cleanSecret = secretKey.trim();
    this.stop();

    fs.writeFileSync(this.secretPath, `secret_key = "${cleanSecret}"\n`, 'utf8');
    this._addLog('✓ Playit Secret Key saved manually from dashboard.', 'auth');

    this.claimCode = null;
    this.claimUrl = null;

    return this.start();
  }
}

// Export singleton instance
const playitService = new PlayitService();
module.exports = playitService;
