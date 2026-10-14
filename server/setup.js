const path = require('path');
const fs = require('fs');
const config = require('./config');

async function setup() {
  // Create required directories
  const dirs = [
    config.BACKUPS_DIR,
    path.dirname(config.DB_PATH),
    config.BDS_DIR,
    config.UPLOAD_DIR,
    path.join(config.BDS_DIR, 'worlds'),
    path.join(config.BDS_DIR, 'behavior_packs'),
    path.join(config.BDS_DIR, 'resource_packs'),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }
  }

  // Initialise database (creates tables + seeds default admin)
  const db = require('./database');
  await db.init();

  console.log('\n========================================');
  console.log('  Setup complete!');
  console.log('  Default login:  admin / admin');
  console.log('  Run "npm run dev" to start.');
  console.log('========================================\n');
  process.exit(0);
}

setup().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
