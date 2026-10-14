const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const db = require('./database');

async function main() {
  // ---- Initialise database (async – loads WASM engine) ----
  await db.init();

  // ---- Sync & safeguard installed custom addons ----
  const addonService = require('./services/addonService');
  addonService.syncSystemPacksFlag();

  // ---- Initialise server process manager ----
  const serverProcess = require('./services/serverProcess');

  const app = express();

  // Ensure all required directories exist on startup
  const requiredDirs = [
    config.BDS_DIR,
    config.BACKUPS_DIR,
    config.UPLOAD_DIR,
    config.WORLDS_DIR || path.join(config.BDS_DIR, 'worlds'),
    path.join(config.BDS_DIR, 'behavior_packs'),
    path.join(config.BDS_DIR, 'resource_packs'),
    path.dirname(config.DB_PATH),
  ];

  for (const dir of requiredDirs) {
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`[Init] Created directory: ${dir}`);
      } catch (err) {
        console.error(`[Init] Failed to create directory ${dir}:`, err.message);
      }
    }
  }

  // Global Middlewares
  app.use(cors());
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ extended: true, limit: '100mb' }));

  // Helper to safely load route modules
  function registerRoute(mountPath, moduleRelativePath) {
    try {
      const routeModule = require(moduleRelativePath);
      app.use(mountPath, routeModule);
      console.log(`[Routes] Registered ${mountPath}`);
    } catch (err) {
      if (err.code === 'MODULE_NOT_FOUND') {
        console.warn(`[Routes] ${moduleRelativePath} not found – fallback registered.`);
        const fallbackRouter = express.Router();
        fallbackRouter.all('*', (_req, res) => {
          res.status(501).json({ error: `Route ${mountPath} not yet implemented` });
        });
        app.use(mountPath, fallbackRouter);
      } else {
        console.error(`[Routes] Error loading ${moduleRelativePath}:`, err);
        throw err;
      }
    }
  }

  // Register API Routes
  registerRoute('/api/auth',       './routes/auth');
  registerRoute('/api/server',     './routes/server');
  registerRoute('/api/console',    './routes/console');
  registerRoute('/api/properties', './routes/properties');
  registerRoute('/api/worlds',     './routes/worlds');
  registerRoute('/api/backups',    './routes/backups');
  registerRoute('/api/addons',     './routes/addons');
  registerRoute('/api/users',      './routes/users');
  registerRoute('/api/versions',   './routes/versions');
  registerRoute('/api/audit',      './routes/audit');
  registerRoute('/api/players',    './routes/players');
  registerRoute('/api/portal',     './routes/portal');
  registerRoute('/api/xbox',       './routes/xbox');
  registerRoute('/api/tunnel',     './routes/tunnel');
  registerRoute('/api/tray',       './routes/tray');
  registerRoute('/api/updates',    './routes/updates');

  // Start auto-backup scheduler
  const backupService = require('./services/backupService');
  backupService.initAutoBackupScheduler(serverProcess);

  // Serve client in production
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  if (process.env.NODE_ENV === 'production' || fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      const indexPath = path.join(clientDist, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Client not built. Run "npm run build".');
      }
    });
  }

  // Global error handler
  app.use((err, _req, res, _next) => {
    console.error('[ServerError]', err);
    res.status(err.status || 500).json({
      error: err.message || 'Internal Server Error',
    });
  });

  // Start HTTP server
  const server = app.listen(config.PORT, () => {
    console.log('====================================================');
    console.log(' Bedrock Dedicated Server Manager');
    console.log(` Port        : ${config.PORT}`);
    console.log(` BDS Dir     : ${config.BDS_DIR}`);
    console.log(` Database    : ${config.DB_PATH}`);
    console.log(` Environment : ${process.env.NODE_ENV || 'development'}`);
    console.log('====================================================');
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`\n[Shutdown] ${signal} received – shutting down…`);
    try {
      if (serverProcess && (serverProcess.state === 'running' || serverProcess.state === 'starting')) {
        console.log('[Shutdown] Stopping Bedrock server…');
        await serverProcess.stop();
      }
    } catch (err) {
      console.error('[Shutdown] BDS stop error:', err.message);
    }

    db.close();

    server.close(() => {
      console.log('[Shutdown] Done.');
      process.exit(0);
    });

    setTimeout(() => {
      console.error('[Shutdown] Forced exit after timeout.');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// ---- Boot ----
main().catch((err) => {
  console.error('[Fatal] Server failed to start:', err);
  process.exit(1);
});
