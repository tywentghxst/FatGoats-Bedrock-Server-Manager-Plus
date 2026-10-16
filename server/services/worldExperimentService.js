const fs = require('fs');
const path = require('path');
const nbt = require('prismarine-nbt');
const config = require('../config');
const { parseProperties } = require('../utils/propertyParser');

const KNOWN_EXPERIMENTS = [
  {
    key: 'gametest',
    name: 'Beta APIs (Scripting & GameTest)',
    badge: 'Essential for Add-Ons',
    category: 'scripting',
    description: 'Enables @minecraft/server, @minecraft/server-ui, and modern JS/TS script modules. Required by most interactive add-ons, custom bosses, backpacks, and city UIs.',
    recommendedForAddons: true,
  },
  {
    key: 'upcoming_creator_features',
    name: 'Upcoming Creator Features',
    badge: 'Essential for Add-Ons',
    category: 'creator',
    description: 'Enables modern custom block components, entity properties, client animations, and events. Required by custom weapons, armor, and block packs.',
    recommendedForAddons: true,
  },
  {
    key: 'experimental_molang_features',
    name: 'Experimental Molang Features',
    badge: 'Recommended',
    category: 'molang',
    description: 'Enables advanced Molang math expressions and queries for custom mob behaviors and render controllers.',
    recommendedForAddons: true,
  },
  {
    key: 'experimental_custom_biomes',
    name: 'Custom Biomes',
    badge: 'Worldgen',
    category: 'worldgen',
    description: 'Enables custom biome generation, custom surface rules, and terrain features from add-ons.',
    recommendedForAddons: true,
  },
  {
    key: 'data_driven_items',
    name: 'Data-Driven Items',
    badge: 'Recommended',
    category: 'items',
    description: 'Enables data-driven item definitions, handheld 3D models, and wearable equipment components.',
    recommendedForAddons: true,
  },
  {
    key: 'creator_features',
    name: 'Holiday Creator Features',
    badge: 'Legacy Add-Ons',
    category: 'creator',
    description: 'Enables classic creator components, custom blocks, and recipes used by older Bedrock add-ons.',
    recommendedForAddons: true,
  },
  {
    key: 'creator_cameras',
    name: 'Creator Cameras',
    badge: 'Cinematics',
    category: 'camera',
    description: 'Enables custom camera perspectives, transitions, and cinematic scripts for adventure maps and add-ons.',
    recommendedForAddons: false,
  },
  {
    key: 'villager_trades',
    name: 'Villager Trade Rebalance',
    badge: 'Gameplay',
    category: 'gameplay',
    description: 'Experimental biome-dependent villager trades and enchanted book rework.',
    recommendedForAddons: false,
  },
  {
    key: 'sniffer',
    name: 'Sniffer & Archeology',
    badge: 'Gameplay',
    category: 'gameplay',
    description: 'Experimental sniffer egg hatching and ancient plant seed features.',
    recommendedForAddons: false,
  },
  {
    key: 'update_addons',
    name: 'Add-On Creators Features',
    badge: 'Creator',
    category: 'creator',
    description: 'Experimental runtime flags and hooks for latest Minecraft Bedrock add-on updates.',
    recommendedForAddons: false,
  },
];

function getWorldsDir() {
  return config.WORLDS_DIR || path.join(config.BDS_DIR, 'worlds');
}

function getActiveWorldName() {
  try {
    const propsPath = path.join(config.BDS_DIR, 'server.properties');
    const properties = parseProperties(propsPath);
    return properties['level-name'] || 'Bedrock level';
  } catch (_) {
    return 'Bedrock level';
  }
}

function getAvailableWorlds() {
  const worldsDir = getWorldsDir();
  if (!fs.existsSync(worldsDir)) return [];
  try {
    return fs.readdirSync(worldsDir, { withFileTypes: true })
      .filter((ent) => ent.isDirectory())
      .map((ent) => ent.name);
  } catch (_) {
    return [];
  }
}

/**
 * Read experimental toggles from a world's level.dat
 */
async function getWorldExperiments(targetWorld) {
  const activeWorld = getActiveWorldName();
  const worldName = (targetWorld && typeof targetWorld === 'string' && targetWorld.trim())
    ? targetWorld.trim()
    : activeWorld;

  const worldsDir = getWorldsDir();
  const worldDir = path.join(worldsDir, worldName);
  const levelDatPath = path.join(worldDir, 'level.dat');
  const availableWorlds = getAvailableWorlds();

  if (!fs.existsSync(worldDir)) {
    return {
      activeWorld,
      targetWorld: worldName,
      availableWorlds,
      exists: false,
      hasLevelDat: false,
      experiments: {},
      experimentsEverUsed: false,
      savedWithToggledExperiments: false,
      knownExperiments: KNOWN_EXPERIMENTS,
    };
  }

  if (!fs.existsSync(levelDatPath)) {
    return {
      activeWorld,
      targetWorld: worldName,
      availableWorlds,
      exists: true,
      hasLevelDat: false,
      experiments: {},
      experimentsEverUsed: false,
      savedWithToggledExperiments: false,
      knownExperiments: KNOWN_EXPERIMENTS,
    };
  }

  const rawBuf = fs.readFileSync(levelDatPath);
  if (rawBuf.length < 8) {
    throw new Error('Invalid level.dat file: file size too small');
  }

  const formatVersion = rawBuf.readInt32LE(0);
  const parsedData = await nbt.parse(rawBuf.subarray(8), 'little');
  const root = parsedData?.parsed?.value;
  const experimentsCompound = root?.experiments?.value;

  const experiments = {};
  let experimentsEverUsed = false;
  let savedWithToggledExperiments = false;

  if (experimentsCompound && typeof experimentsCompound === 'object') {
    for (const [key, tag] of Object.entries(experimentsCompound)) {
      if (key === 'experiments_ever_used') {
        experimentsEverUsed = tag.value === 1 || tag.value === true;
      } else if (key === 'saved_with_toggled_experiments') {
        savedWithToggledExperiments = tag.value === 1 || tag.value === true;
      } else {
        experiments[key] = tag.value === 1 || tag.value === true;
      }
    }
  }

  return {
    activeWorld,
    targetWorld: worldName,
    availableWorlds,
    exists: true,
    hasLevelDat: true,
    formatVersion,
    experiments,
    experimentsEverUsed,
    savedWithToggledExperiments,
    knownExperiments: KNOWN_EXPERIMENTS,
  };
}

/**
 * Save experimental toggles into a world's level.dat
 */
async function saveWorldExperiments(targetWorld, newExperiments = {}) {
  const activeWorld = getActiveWorldName();
  const worldName = (targetWorld && typeof targetWorld === 'string' && targetWorld.trim())
    ? targetWorld.trim()
    : activeWorld;

  const worldsDir = getWorldsDir();
  const worldDir = path.join(worldsDir, worldName);
  const levelDatPath = path.join(worldDir, 'level.dat');
  const levelDatOldPath = path.join(worldDir, 'level.dat_old');
  const levelDatBakPath = path.join(worldDir, 'level.dat.bak');

  if (!fs.existsSync(worldDir)) {
    throw new Error(`World folder "${worldName}" does not exist in ${worldsDir}`);
  }

  if (!fs.existsSync(levelDatPath)) {
    throw new Error(`World level.dat not found in "${worldName}". Start the server once with this world to generate level.dat before editing experiments.`);
  }

  const rawBuf = fs.readFileSync(levelDatPath);
  if (rawBuf.length < 8) {
    throw new Error('Invalid level.dat file: file size too small');
  }

  const formatVersion = rawBuf.readInt32LE(0);
  const parsedData = await nbt.parse(rawBuf.subarray(8), 'little');
  const root = parsedData?.parsed?.value;

  if (!root) {
    throw new Error('Failed to parse NBT root in level.dat');
  }

  // Backup existing level.dat
  try {
    fs.copyFileSync(levelDatPath, levelDatBakPath);
    fs.copyFileSync(levelDatPath, levelDatOldPath);
  } catch (bakErr) {
    console.warn('[WorldExperiments] Could not create backup copies:', bakErr.message);
  }

  // Ensure experiments compound tag exists
  if (!root.experiments || root.experiments.type !== 'compound') {
    root.experiments = {
      type: 'compound',
      value: {
        experiments_ever_used: { type: 'byte', value: 0 },
        saved_with_toggled_experiments: { type: 'byte', value: 0 },
      },
    };
  }

  const expCompound = root.experiments.value;

  // Apply new experiment settings
  let anyEnabled = false;
  for (const [key, val] of Object.entries(newExperiments)) {
    const isEnabled = Boolean(val);
    if (isEnabled) anyEnabled = true;
    expCompound[key] = {
      type: 'byte',
      value: isEnabled ? 1 : 0,
    };
  }

  // Also verify existing experiment flags if any are active
  for (const [key, tag] of Object.entries(expCompound)) {
    if (key !== 'experiments_ever_used' && key !== 'saved_with_toggled_experiments') {
      if (tag.value === 1) anyEnabled = true;
    }
  }

  if (anyEnabled) {
    expCompound.experiments_ever_used = { type: 'byte', value: 1 };
    expCompound.saved_with_toggled_experiments = { type: 'byte', value: 1 };
  }

  // Serialize back to little-endian NBT
  const serialized = nbt.writeUncompressed(parsedData.parsed, 'little');
  const finalBuf = Buffer.alloc(8 + serialized.length);
  finalBuf.writeInt32LE(formatVersion, 0);
  finalBuf.writeInt32LE(serialized.length, 4);
  serialized.copy(finalBuf, 8);

  // Write new level.dat
  fs.writeFileSync(levelDatPath, finalBuf);
  try {
    fs.writeFileSync(levelDatOldPath, finalBuf);
  } catch (_) {}

  return await getWorldExperiments(worldName);
}

module.exports = {
  KNOWN_EXPERIMENTS,
  getWorldExperiments,
  saveWorldExperiments,
  getActiveWorldName,
  getAvailableWorlds,
};
