# 🚀 Minecraft Bedrock Dedicated Server (BDS) Manager

A modern, full-stack self-hosted administration panel designed to operate, monitor, configure, update, and manage a Minecraft Bedrock Dedicated Server instance directly from a web browser.

---

## 💾 Quick Installation (Windows Standalone Setup)

Download the one-click installer executable from GitHub Releases:
**[⬇️ Download BedrockServerManager-Setup.exe (v1.1.0)](https://github.com/tywentghxst/FatGoats-Bedrock-Server-Manager-Plus/releases/latest/download/BedrockServerManager-Setup.exe)**

The setup wizard automatically:
1. **Runtime Verification**: Checks for Node.js runtime (and automatically downloads/configures the official Node.js LTS runtime if missing).
2. **Automated Dependencies**: Installs all required packages (`npm install`) and packages pre-compiled client assets.
3. **Windows Tray App**: Builds and registers `BedrockServerManager.exe` (sits in Windows system tray overflow area).
4. **Shortcuts & Auto-Launch**: Generates Desktop & Start Menu shortcuts with the custom Bedrock icon, auto-starts the background server, and opens your browser to `http://localhost:3001`.

## 🌟 Core Features Overview

### 1. Unified Control & Power Engine
* **Subprocess Management**: Spawns and supervises the native `bedrock_server.exe` binary in real-time.
* **Graceful Halts**: Sends the `stop` command directly to the server's standard input pipe (`stdin`), preventing world corruption. Includes a safety timeout fallback.
* **Auto-Sanitization**: Automatically detects offline mode (`online-mode=false`) and forces `allow-list=false` to prevent BDS engine startup crashes.
* **Telemetry**: Tracks Uptime, RAM usage, CPU ticks, player counts, and state transitions (`stopped`, `starting`, `running`, `stopping`).

### 2. Interactive Console Stream & Command Prompts
* **Real-Time Log Stream**: Polling terminal stream with automatic regex timestamp sanitizer that strips redundant bracket tags (`[YYYY-MM-DD HH:MM:SS:MS INFO]`).
* **Color-Coded Events**: Highlights warnings (yellow), errors (red), info (white), and player join/disconnect notices (green).
* **Command Interceptor**: Administrators can dispatch BDS commands directly with automatic `/` prefix trimming.

### 3. Server Upgrades & Deployment Center
* **Official Scraper**: Scrapes official Mojang Bedrock Dedicated Server distribution channels for one-click updates.
* **Custom Zip Ingestion**: Drag-and-drop server package uploader.
* **Config & World Preservation**: Upgrading or deploying replaces binaries while automatically preserving `server.properties`, `allowlist.json`, `permissions.json`, and existing worlds.

### 4. World & Backup Archive Managers
* **World Selector**: Switch active worlds seamlessly by updating `level-name`.
* **Backup Manifests**: Compiles world databases, config files, and permission lists into timestamped `.zip` archives.
* **One-Click Restore**: Gracefully stops the server, restores target world files and configurations, and prepares for boot.

### 5. Advanced Addons & Pack Injections Engine
* **Format Support**: Upload `.zip`, `.mcpack`, or `.mcaddon` packages directly.
* **Manifest Parsing**: Automatically unpacks and extracts `manifest.json` UUIDs, semantic versions, and pack types (`behavior` vs `resource`).
* **Active Load Order Hierarchy**: Visual drag-and-drop and arrow priority controls.
* **Automatic JSON Config Generation**: Generates `world_behavior_packs.json` and `world_resource_packs.json` inside the active world folder.
* **Multi-Version Library**: Indexed in SQLite database with UUID-matching updates.

### 6. Users & Permissions Vault
* **Role-Based Access Control (RBAC)**: Distinguishes between `admin` (full execution privileges) and `viewer` (read-only monitoring).
* **Single-Use Invite Tokens**: Issue role-specific invite tokens so team members can register safely.
* **System Audit Trail**: Complete timestamped audit logging for power cycles, commands, config changes, backups, and pack modifications.

---

## 🔑 Default Credentials

* **URL**: [http://localhost:3001](http://localhost:3001) (or dev server at [http://localhost:5173](http://localhost:5173))
* **Username**: `admin`
* **Password**: `admin`

*(Remember to change the admin password or create custom accounts in production.)*

---

## 📁 Directory Structure

```text
bedrock-server-manager/
├── bds/                     # Bedrock Dedicated Server binary root
│   ├── behavior_packs/      # Global behavior packs folder
│   ├── resource_packs/      # Global resource packs folder
│   ├── worlds/              # Server worlds folder
│   └── server.properties    # Active server configuration
├── client/                  # React 18 SPA (Vite + Dark UI Theme)
│   ├── dist/                # Production build
│   └── src/
│       ├── components/      # Layout, ProtectedRoute, Navigation
│       ├── pages/           # Dashboard, Console, Addons, Worlds, Backups, Properties, Users, Versions, Audit
│       └── styles/          # Minecraft-inspired dark theme CSS
├── data/
│   ├── db/manager.db        # SQLite database (sql.js WASM engine)
│   ├── backups/             # Server world zip archives
│   └── uploads/             # Temporary ingestion buffer
└── server/                  # Node.js Express backend
    ├── middleware/          # JWT auth & RBAC
    ├── routes/              # All API route modules
    ├── services/            # Process manager, Addon engine, Backups, Versions, Audit
    └── utils/               # Property parser & sanitization
```

---

## 🛠️ Quick Commands

```bash
# Start both backend and frontend concurrently in development mode:
npm run dev

# Or start backend only (serves built client on http://localhost:3001):
node server/index.js

# Rebuild frontend:
npm run build
```
