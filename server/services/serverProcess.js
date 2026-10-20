const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, exec } = require('child_process');
const { EventEmitter } = require('events');
const config = require('../config');

class ServerProcess extends EventEmitter {
  constructor() {
    super();
    this.state = 'stopped'; // 'stopped' | 'starting' | 'running' | 'stopping'
    this.startTime = null;
    this.consoleLogs = [];
    this.playerCount = 0;
    this.maxPlayers = 10;
    this.version = 'Unknown';
    try {
      const vPath = path.join(config.BDS_DIR, 'version.txt');
      if (fs.existsSync(vPath)) {
        this.version = fs.readFileSync(vPath, 'utf8').trim();
      }
    } catch (_) {}
    this.tps = 20.0;
    this.port = 19132;
    this.realCpu = 0.0;
    this.realMemoryMb = 0;
    this.allocatedRamMb = 4096;
    this._resourceMonitorTimer = null;
    this._prevCpuTime = null;
    this._prevTimestamp = null;
    this.childProcess = null;
    this.stopTimeout = null;
    this.connectedPlayers = new Set();
  }

  _appendLog(line) {
    if (!line) return;
    const formatted = line.replace(/\r/g, '');
    this.consoleLogs.push(formatted);
    if (this.consoleLogs.length > config.MAX_CONSOLE_LINES) {
      this.consoleLogs.shift();
    }
    this.emit('log', formatted);
  }

  _parseLine(line) {
    // Check for server started
    if (line.includes('Server started') || line.includes('IPv4 supported')) {
      if (this.state === 'starting') {
        this.state = 'running';
        this.startTime = Date.now();
        this.emit('started');
      }
    }

    // Version parsing: e.g. "Version: 1.26.52.03" or "Version 1.26.52" or "Bedrock Dedicated Server 1.26.52"
    const versionMatch = line.match(/Version:?\s*([\d.]+)/i) || line.match(/Bedrock\s+Dedicated\s+Server:?\s*([\d.]+)/i);
    if (versionMatch) {
      this.version = versionMatch[1];
    }

    // Player connected: e.g., "Player connected: PlayerName, xuid: 123456"
    const connectMatch = line.match(/Player\s+connected:\s*([^,\n]+)(?:,\s*xuid:\s*(\d+))?/i);
    if (connectMatch) {
      const playerName = connectMatch[1].trim();
      const xuid = connectMatch[2] ? connectMatch[2].trim() : null;

      // Check if player is banned; if so, kick immediately
      try {
        const playerService = require('./playerService');
        const banCheck = playerService.isPlayerBanned(playerName, xuid);
        if (banCheck && banCheck.isBanned) {
          const reason = (banCheck.reason || 'You are banned from this server.').replace(/["\n\r]/g, '');
          console.warn(`[ServerProcess] Banned player "${playerName}" attempted to join. Kicking immediately: ${reason}`);
          this.sendCommand(`kick "${playerName}" "${reason}"`);
          return;
        }
      } catch (banErr) {
        console.warn('[ServerProcess] Ban check error during connect:', banErr.message);
      }

      this.connectedPlayers.add(playerName);
      this.playerCount = this.connectedPlayers.size;
      this.emit('player_join', { name: playerName, xuid });
      try {
        const playerService = require('./playerService');
        playerService.recordPlayerJoin(playerName, xuid);
      } catch (_) {}
    }

    // Player disconnected: e.g., "Player disconnected: PlayerName, xuid: 123456"
    const disconnectMatch = line.match(/Player\s+disconnected:\s*([^,\n]+)(?:,\s*xuid:\s*(\d+))?/i);
    if (disconnectMatch) {
      const playerName = disconnectMatch[1].trim();
      const xuid = disconnectMatch[2] ? disconnectMatch[2].trim() : null;
      this.connectedPlayers.delete(playerName);
      this.playerCount = this.connectedPlayers.size;
      this.emit('player_leave', { name: playerName, xuid });
      try {
        const playerService = require('./playerService');
        playerService.recordPlayerLeave(playerName, xuid);
      } catch (_) {}
    }
  }

  _readMaxPlayersFromProperties() {
    try {
      const propsPath = path.join(config.BDS_DIR, 'server.properties');
      if (fs.existsSync(propsPath)) {
        const content = fs.readFileSync(propsPath, 'utf8');
        const match = content.match(/^max-players\s*=\s*(\d+)/m);
        if (match) {
          this.maxPlayers = parseInt(match[1], 10);
        }
      }
    } catch (err) {
      console.error('[ServerProcess] Failed reading server.properties:', err.message);
    }
  }

  _readAllocatedRamFromProperties() {
    try {
      const propsPath = path.join(config.BDS_DIR, 'server.properties');
      if (fs.existsSync(propsPath)) {
        const content = fs.readFileSync(propsPath, 'utf8');
        const match = content.match(/^server-ram-limit\s*=\s*(\d+)/im);
        if (match) {
          this.allocatedRamMb = parseInt(match[1], 10);
        }
      }
    } catch (_) {}
  }

  _readPortFromProperties() {
    try {
      const propsPath = path.join(config.BDS_DIR, 'server.properties');
      if (fs.existsSync(propsPath)) {
        const content = fs.readFileSync(propsPath, 'utf8');
        const match = content.match(/^server-port\s*=\s*(\d+)/m);
        if (match) {
          this.port = parseInt(match[1], 10);
        }
      }
    } catch (_) {}
  }

  _startResourceMonitoring(pid) {
    this._stopResourceMonitoring();
    this._prevCpuTime = null;
    this._prevTimestamp = null;

    this._resourceMonitorTimer = setInterval(() => {
      if (!this.childProcess || this.state === 'stopped') {
        this._stopResourceMonitoring();
        return;
      }

      if (process.platform === 'win32') {
        exec(`powershell -NoProfile -Command "Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object -Property CPU, WorkingSet64 | ConvertTo-Json -Compress"`, (err, stdout) => {
          if (err || !stdout || !stdout.trim()) return;
          try {
            const data = JSON.parse(stdout.trim());
            if (data && data.WorkingSet64) {
              this.realMemoryMb = Math.round(Number(data.WorkingSet64) / (1024 * 1024));
            }
            if (data && data.CPU !== undefined && data.CPU !== null) {
              const currentCpuSec = Number(data.CPU);
              const now = Date.now();
              if (this._prevCpuTime !== null && this._prevTimestamp !== null) {
                const deltaCpu = currentCpuSec - this._prevCpuTime;
                const deltaWall = (now - this._prevTimestamp) / 1000;
                const cores = os.cpus().length || 1;
                if (deltaWall > 0.5) {
                  const pct = ((deltaCpu / deltaWall) / cores) * 100;
                  this.realCpu = Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
                }
              }
              this._prevCpuTime = currentCpuSec;
              this._prevTimestamp = now;
            }
          } catch (_) {}
        });
      } else {
        // Linux /proc statistics
        try {
          const statPath = `/proc/${pid}/status`;
          if (fs.existsSync(statPath)) {
            const statusContent = fs.readFileSync(statPath, 'utf8');
            const vmrssMatch = statusContent.match(/VmRSS:\s+(\d+)\s+kB/i);
            if (vmrssMatch) {
              this.realMemoryMb = Math.round(parseInt(vmrssMatch[1], 10) / 1024);
            }
          }
        } catch (_) {}
      }
    }, 1500);
  }

  _stopResourceMonitoring() {
    if (this._resourceMonitorTimer) {
      clearInterval(this._resourceMonitorTimer);
      this._resourceMonitorTimer = null;
    }
    this.realCpu = 0.0;
    this.realMemoryMb = 0;
    this._prevCpuTime = null;
    this._prevTimestamp = null;
  }

  async start() {
    if (this.state === 'running' || this.state === 'starting') {
      throw new Error(`Server is already ${this.state}`);
    }

    const exeName = process.platform === 'win32' ? 'bedrock_server.exe' : 'bedrock_server';
    const exePath = path.join(config.BDS_DIR, exeName);

    if (!fs.existsSync(exePath)) {
      const db = require('../database');
      const autoUpdate = db.getSetting('auto_update_server', 'false') === 'true';

      if (autoUpdate) {
        this._appendLog('[ServerManager] Bedrock server binary missing. Auto-installing official release...');
        const versionService = require('./versionService');
        await versionService.installLatest();
      }

      if (!fs.existsSync(exePath)) {
        throw new Error(`Bedrock Dedicated Server is not installed yet. Please click "Install Official Bedrock Server" or enable "Auto-Update" to automatically download and configure Mojang's release.`);
      }
    }

    // Backup on start if enabled
    if (config.BACKUP_ON_START) {
      try {
        const backupService = require('./backupService');
        if (backupService && typeof backupService.createBackup === 'function') {
          this._appendLog('[ServerManager] Executing pre-start backup...');
          await backupService.createBackup('auto-pre-start');
        }
      } catch (err) {
        console.error('[ServerProcess] Auto-backup before start failed:', err.message);
        this._appendLog(`[ServerManager] Pre-start backup error: ${err.message}`);
      }
    }

    this._readMaxPlayersFromProperties();
    this.connectedPlayers.clear();
    this.playerCount = 0;
    this.state = 'starting';
    this.startTime = null;

    try {
      this.childProcess = spawn(exePath, [], {
        cwd: config.BDS_DIR,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // Linux bedrock server needs LD_LIBRARY_PATH=. if applicable
          LD_LIBRARY_PATH: config.BDS_DIR
        }
      });
    } catch (err) {
      this.state = 'stopped';
      throw new Error(`Failed to spawn server process: ${err.message}`);
    }

    this._appendLog(`[ServerManager] Server process started (PID: ${this.childProcess.pid})`);
    this._startResourceMonitoring(this.childProcess.pid);

    let stdoutBuffer = '';
    this.childProcess.stdout.on('data', (data) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop(); // keep partial line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          this._appendLog(trimmed);
          this._parseLine(trimmed);
        }
      }
    });

    let stderrBuffer = '';
    this.childProcess.stderr.on('data', (data) => {
      stderrBuffer += data.toString();
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          this._appendLog(`[STDERR] ${trimmed}`);
        }
      }
    });

    this.childProcess.on('error', (err) => {
      console.error('[ServerProcess] Child process error:', err);
      this._appendLog(`[ServerManager] Process error: ${err.message}`);
      this._stopResourceMonitoring();
      this.state = 'stopped';
      this.startTime = null;
      this.childProcess = null;
      this.emit('error', err);
    });

    this.childProcess.on('close', (code, signal) => {
      this._stopResourceMonitoring();
      if (this.stopTimeout) {
        clearTimeout(this.stopTimeout);
        this.stopTimeout = null;
      }

      const prevRunning = this.state === 'running' || this.state === 'starting';
      this._appendLog(`[ServerManager] Server stopped (code: ${code}, signal: ${signal})`);
      this.state = 'stopped';
      this.startTime = null;
      this.playerCount = 0;
      this.connectedPlayers.clear();
      this.childProcess = null;

      try {
        const playerService = require('./playerService');
        playerService.handleServerStopped();
      } catch (_) {}

      // Handle unexpected crash recovery notification
      if (prevRunning && code !== 0 && code !== null) {
        console.warn(`[ServerProcess] Server process crashed with exit code ${code}`);
        this.emit('crash', { code, signal });
      }

      this.emit('stopped', { code, signal });
    });

    // Auto-start Playit.gg internet tunnel if configured
    try {
      const playitService = require('./playitService');
      const tunnelConfig = playitService.getConfig();
      if (tunnelConfig.autoStart && playitService.isClaimed()) {
        playitService.start().catch((err) => {
          console.warn('[ServerProcess] Tunnel auto-start notice:', err.message);
        });
      }
    } catch (_) {}

    return { success: true, message: 'Server is starting', pid: this.childProcess.pid };
  }

  async stop() {
    if (this.state === 'stopped') {
      return { success: true, message: 'Server is already stopped' };
    }

    if (this.state === 'stopping') {
      return { success: true, message: 'Server is already in stopping state' };
    }

    this.state = 'stopping';
    this._appendLog('[ServerManager] Stopping server gracefully...');

    return new Promise((resolve) => {
      const cleanupAndResolve = () => {
        if (this.stopTimeout) {
          clearTimeout(this.stopTimeout);
          this.stopTimeout = null;
        }
        resolve({ success: true, message: 'Server stopped successfully' });
      };

      if (!this.childProcess) {
        this.state = 'stopped';
        this.startTime = null;
        return cleanupAndResolve();
      }

      // Timeout for forced kill after 30 seconds
      this.stopTimeout = setTimeout(() => {
        if (this.childProcess) {
          this._appendLog('[ServerManager] Server did not stop in 30 seconds. Forcing shutdown (kill)...');
          const pid = this.childProcess.pid;
          try {
            if (process.platform === 'win32' && pid) {
              exec(`taskkill /F /T /PID ${pid}`, () => {});
            } else {
              this.childProcess.kill('SIGKILL');
            }
          } catch (e) {
            console.error('[ServerProcess] Error force-killing process:', e.message);
          }
          // Fallback if close event didn't trigger
          setTimeout(() => {
            if (this.state !== 'stopped') {
              this._stopResourceMonitoring();
              this.state = 'stopped';
              this.startTime = null;
              this.playerCount = 0;
              this.connectedPlayers.clear();
              this.childProcess = null;
              this.emit('stopped', { code: -1, signal: 'SIGKILL' });
              cleanupAndResolve();
            }
          }, 3000);
        }
      }, 30000);

      this.once('stopped', () => {
        cleanupAndResolve();
      });

      // Send stop command to stdin
      try {
        if (this.childProcess.stdin && !this.childProcess.stdin.destroyed) {
          this.childProcess.stdin.write('stop\n');
        } else {
          this.childProcess.kill('SIGTERM');
        }
      } catch (err) {
        console.error('[ServerProcess] Failed writing stop to stdin:', err);
        try {
          this.childProcess.kill('SIGTERM');
        } catch (_) {}
      }
    });
  }

  async kill() {
    if (this.state === 'stopped' && !this.childProcess) {
      return { success: true, message: 'Server is already stopped' };
    }

    this._appendLog('[ServerManager] Force-killing server process immediately...');
    const pid = this.childProcess ? this.childProcess.pid : null;
    this._stopResourceMonitoring();
    if (this.stopTimeout) {
      clearTimeout(this.stopTimeout);
      this.stopTimeout = null;
    }

    if (pid) {
      try {
        if (process.platform === 'win32') {
          exec(`taskkill /F /T /PID ${pid}`, () => {});
        } else {
          this.childProcess.kill('SIGKILL');
        }
      } catch (_) {}
    }

    this.state = 'stopped';
    this.startTime = null;
    this.playerCount = 0;
    this.connectedPlayers.clear();
    this.childProcess = null;
    this.emit('stopped', { code: -1, signal: 'SIGKILL' });
    return { success: true, message: 'Server process forcefully terminated' };
  }

  async restart() {
    if (this.state !== 'stopped') {
      await this.stop();
    }
    // Small delay to ensure resources/ports release cleanly
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return await this.start();
  }

  sendCommand(cmd) {
    if (!this.childProcess || this.state === 'stopped') {
      throw new Error('Cannot send command: Server is not running');
    }

    let sanitized = (cmd || '').trim();
    if (sanitized.startsWith('/')) {
      sanitized = sanitized.slice(1);
    }

    if (!sanitized) {
      throw new Error('Command cannot be empty');
    }

    this._appendLog(`> ${sanitized}`);
    this.childProcess.stdin.write(`${sanitized}\n`);
    return { success: true, command: sanitized };
  }

  setTime(timeVal) {
    if (this.state !== 'running') {
      throw new Error('Server must be running to change in-game time.');
    }
    const valStr = String(timeVal).trim().toLowerCase();
    const cmd = `time set ${valStr}`;
    this.sendCommand(cmd);
    return { success: true, time: valStr, command: cmd };
  }

  setWeather(weatherType) {
    if (this.state !== 'running') {
      throw new Error('Server must be running to change weather.');
    }
    const valStr = String(weatherType).trim().toLowerCase();
    const cmd = `weather ${valStr}`;
    this.sendCommand(cmd);
    return { success: true, weather: valStr, command: cmd };
  }

  setDaylightCycle(enabled) {
    if (this.state !== 'running') {
      throw new Error('Server must be running to change daylight cycle.');
    }
    const cmd = `gamerule dodaylightcycle ${Boolean(enabled)}`;
    this.sendCommand(cmd);
    return { success: true, daylightCycle: Boolean(enabled), command: cmd };
  }

  getStatus() {
    let uptime = 0;
    if (this.state === 'running' && this.startTime) {
      uptime = Math.floor((Date.now() - this.startTime) / 1000);
    }

    this._readMaxPlayersFromProperties();
    this._readAllocatedRamFromProperties();
    this._readPortFromProperties();

    const exeName = process.platform === 'win32' ? 'bedrock_server.exe' : 'bedrock_server';
    const exePath = path.join(config.BDS_DIR, exeName);
    const installed = fs.existsSync(exePath);

    let autoUpdate = false;
    try {
      const db = require('../database');
      autoUpdate = db.getSetting('auto_update_server', 'false') === 'true';
    } catch (_) {}

    const totalHostRamMb = Math.round(os.totalmem() / (1024 * 1024));
    const freeHostRamMb = Math.round(os.freemem() / (1024 * 1024));

    return {
      state: this.state,
      uptime,
      pid: this.childProcess ? this.childProcess.pid : null,
      port: this.port || 19132,
      playerCount: this.playerCount,
      maxPlayers: this.maxPlayers,
      version: this.version,
      tps: this.tps,
      cpu: this.state === 'running' ? this.realCpu : 0,
      memory: this.state === 'running' ? this.realMemoryMb : 0, // In MB
      allocatedRam: this.allocatedRamMb || 4096, // In MB
      systemMemory: {
        totalMb: totalHostRamMb,
        freeMb: freeHostRamMb,
        usedMb: totalHostRamMb - freeHostRamMb
      },
      installed,
      autoUpdate,
      exePath
    };
  }

  getConsoleLogs() {
    return [...this.consoleLogs];
  }
}

// Export singleton instance
const serverProcessInstance = new ServerProcess();
module.exports = serverProcessInstance;
