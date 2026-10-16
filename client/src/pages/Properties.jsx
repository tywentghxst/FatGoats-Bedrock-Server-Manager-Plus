import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

const PROPERTY_METADATA = {
  'server-name': {
    label: 'Server Display Name',
    category: 'general',
    icon: '🏷️',
    description: 'The server name displayed in the in-game Minecraft Bedrock server browser list.',
  },
  gamemode: {
    label: 'Default Game Mode',
    category: 'general',
    icon: '⚔️',
    description: 'The default game mode applied to players joining the world.',
    options: ['survival', 'creative', 'adventure'],
  },
  difficulty: {
    label: 'World Difficulty',
    category: 'general',
    icon: '💀',
    description: 'Controls hostile mob damage, hunger depletion, and hostile creature spawning.',
    options: ['peaceful', 'easy', 'normal', 'hard'],
  },
  'max-players': {
    label: 'Maximum Player Capacity',
    category: 'general',
    icon: '👥',
    description: 'The maximum number of concurrent players that can join this Bedrock server.',
    min: 1,
    max: 200,
  },
  'server-ram-limit': {
    label: 'Server RAM Allocation (Memory Limit)',
    category: 'general',
    icon: '💾',
    description: 'Target memory limit allocated for Bedrock chunk caching, ticking simulation, and addon scripting (in Megabytes). Presets: 2GB (2048), 4GB (4096), 8GB (8192), 16GB (16384).',
    min: 1024,
    max: 65536,
    presets: ['2048', '4096', '6144', '8192', '12288', '16384', '32768'],
  },
  'level-name': {
    label: 'Active World Name',
    category: 'world',
    icon: '🌍',
    description: 'Directory name of the active world stored inside the worlds/ directory.',
  },
  'level-seed': {
    label: 'World Generation Seed',
    category: 'world',
    icon: '🌱',
    description: 'Seed string or number used by the world generator algorithm.',
  },
  'level-type': {
    label: 'World Terrain Type',
    category: 'world',
    icon: '🏔️',
    description: 'Generation style of the world landscape (DEFAULT, FLAT, or LEGACY).',
    options: ['DEFAULT', 'FLAT', 'LEGACY'],
  },
  'view-distance': {
    label: 'Render View Distance (Chunks)',
    category: 'world',
    icon: '👁️',
    description: 'Maximum chunk view distance sent to connected clients. Higher values require more RAM.',
    min: 4,
    max: 64,
  },
  'tick-distance': {
    label: 'Simulation Tick Distance (Chunks)',
    category: 'world',
    icon: '⏱️',
    description: 'Radius in chunks where entities, crops, and redstone are actively updated.',
    min: 4,
    max: 12,
  },
  'max-chunks-per-tick': {
    label: 'Max Chunks Per Tick',
    category: 'world',
    icon: '📦',
    description: 'Throttle limit on the number of chunks loaded/generated per single server tick.',
    min: 1,
    max: 50,
  },
  'online-mode': {
    label: 'Online Mode (Xbox Authentication)',
    category: 'security',
    icon: '🛡️',
    description: 'When true, all players must authenticate through Xbox Live. When false, allowlists are relaxed.',
  },
  'allow-list': {
    label: 'Enforce Allowlist',
    category: 'security',
    icon: '📋',
    description: 'If enabled, only players listed inside allowlist.json can join.',
  },
  'white-list': {
    label: 'Legacy Whitelist Alias',
    category: 'security',
    icon: '📋',
    description: 'Legacy alias for allow-list in older Bedrock Dedicated Server builds.',
  },
  'allow-cheats': {
    label: 'Allow In-Game Cheats',
    category: 'security',
    icon: '⚡',
    description: 'Enables in-game slash commands like /gamemode, /give, /time, and /tp for players.',
  },
  'default-player-permission-level': {
    label: 'Default Permission Level',
    category: 'security',
    icon: '🔑',
    description: 'Starting permission level assigned to new players joining for the first time.',
    options: ['visitor', 'member', 'operator'],
  },
  'player-idle-timeout': {
    label: 'Idle Player Kick Timeout (Minutes)',
    category: 'security',
    icon: '⏳',
    description: 'Automatically kicks players who are AFK/idle for this many minutes (0 = disabled).',
    min: 0,
    max: 1440,
  },
  'texturepack-required': {
    label: 'Require Server Texture Packs',
    category: 'security',
    icon: '🎨',
    description: 'Forces joining clients to download server resource packs before entering world.',
  },
  'server-port': {
    label: 'IPv4 Server Port',
    category: 'network',
    icon: '🔌',
    description: 'The standard Bedrock UDP port for IPv4 connections (Default: 19132).',
    min: 1024,
    max: 65535,
  },
  'server-portv6': {
    label: 'IPv6 Server Port',
    category: 'network',
    icon: '🌐',
    description: 'The Bedrock UDP port for IPv6 connections (Default: 19133).',
    min: 1024,
    max: 65535,
  },
  'max-threads': {
    label: 'Max CPU Worker Threads',
    category: 'network',
    icon: '💻',
    description: 'Maximum threads utilized by BDS for physics, pathfinding, and ticking (0 = auto-detect).',
    min: 0,
    max: 64,
  },
  'compression-threshold': {
    label: 'Packet Compression Threshold',
    category: 'network',
    icon: '🗜️',
    description: 'Minimum packet size (bytes) before network compression is applied.',
    min: 0,
    max: 65535,
  },
  'content-log-file-enabled': {
    label: 'Enable Content Log File',
    category: 'network',
    icon: '📝',
    description: 'Logs errors from addons, scripting APIs, and behavior packs to a dedicated file.',
  },
  transport: {
    label: 'Network Transport Protocol',
    category: 'network',
    icon: '📡',
    description: 'Network transport protocol. "nethernet" is Mojang\'s required transport protocol in BDS 1.26+. "raknet" is legacy Bedrock UDP routing.',
    options: ['nethernet', 'raknet'],
  },
};

const CATEGORIES = [
  { id: 'all', label: 'All Settings', icon: '🌟' },
  { id: 'experiments', label: 'World Experiments (Add-Ons)', icon: '🧪' },
  { id: 'general', label: 'General & Gameplay', icon: '⚔️' },
  { id: 'world', label: 'World & Simulation', icon: '🌍' },
  { id: 'security', label: 'Security & Access', icon: '🛡️' },
  { id: 'network', label: 'Network & Engine', icon: '⚡' },
  { id: 'advanced', label: 'Advanced BDS Raw', icon: '🔧' },
];

export const Properties = () => {
  const navigate = useNavigate();
  const [properties, setProperties] = useState({});
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const [errorMessage, setErrorMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');

  // World Experiments state (for add-on support)
  const [worldExperiments, setWorldExperiments] = useState({});
  const [knownExperiments, setKnownExperiments] = useState([]);
  const [targetWorld, setTargetWorld] = useState('');
  const [activeWorld, setActiveWorld] = useState('');
  const [availableWorlds, setAvailableWorlds] = useState([]);
  const [experimentsLoading, setExperimentsLoading] = useState(false);
  const [experimentsSaving, setExperimentsSaving] = useState(false);
  const [experimentsSaveMsg, setExperimentsSaveMsg] = useState(null);
  const [customExpKey, setCustomExpKey] = useState('');
  const [serverRunning, setServerRunning] = useState(false);
  const [hasLevelDat, setHasLevelDat] = useState(true);

  const debounceTimerRef = useRef(null);
  const propertiesRef = useRef(properties);
  propertiesRef.current = properties;

  const fetchWorldExperiments = useCallback(async (worldToFetch = '') => {
    try {
      setExperimentsLoading(true);
      setExperimentsSaveMsg(null);
      const res = await api.Properties.getExperiments(worldToFetch);
      if (res) {
        setWorldExperiments(res.experiments || {});
        setKnownExperiments(res.knownExperiments || []);
        setTargetWorld(res.targetWorld || '');
        setActiveWorld(res.activeWorld || '');
        setAvailableWorlds(res.availableWorlds || []);
        setServerRunning(Boolean(res.serverRunning));
        setHasLevelDat(res.hasLevelDat !== false);
      }
    } catch (err) {
      console.warn('Failed to fetch world experiments:', err);
    } finally {
      setExperimentsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const fetchProps = async () => {
      try {
        setLoading(true);
        const data = await api.getProperties();
        if (isMounted) {
          const loaded = data && data.properties ? data.properties : data || {};
          setProperties(loaded);
          setLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          setErrorMessage(err.message || 'Failed to load server properties.');
          setLoading(false);
        }
      }
    };

    fetchProps();
    fetchWorldExperiments();
  }, [fetchWorldExperiments]);

  const saveProperties = useCallback(async (dataToSave) => {
    setSaveStatus('saving');
    setErrorMessage('');
    try {
      await api.updateProperties(dataToSave);
      setSaveStatus('saved');
      setTimeout(() => {
        setSaveStatus((current) => (current === 'saved' ? 'idle' : current));
      }, 3000);
    } catch (err) {
      setSaveStatus('error');
      setErrorMessage(err.message || 'Failed to save properties.');
    }
  }, []);

  const handleToggleExperiment = (key, value) => {
    setWorldExperiments((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleEnableAllAddonRecommended = () => {
    const recommendedKeys = [
      'gametest',
      'upcoming_creator_features',
      'experimental_molang_features',
      'experimental_custom_biomes',
      'data_driven_items',
      'creator_features',
    ];
    setWorldExperiments((prev) => {
      const next = { ...prev };
      recommendedKeys.forEach((k) => {
        next[k] = true;
      });
      return next;
    });
  };

  const handleDisableAllExperiments = () => {
    setWorldExperiments((prev) => {
      const next = {};
      Object.keys(prev).forEach((k) => {
        next[k] = false;
      });
      return next;
    });
  };

  const handleAddCustomExperimentTag = (e) => {
    e.preventDefault();
    if (!customExpKey.trim()) return;
    const sanitizedKey = customExpKey.trim().toLowerCase().replace(/\s+/g, '_');
    setWorldExperiments((prev) => ({
      ...prev,
      [sanitizedKey]: true,
    }));
    setCustomExpKey('');
  };

  const handleSaveExperiments = async () => {
    if (!targetWorld) return;
    setExperimentsSaving(true);
    setExperimentsSaveMsg(null);
    try {
      const res = await api.Properties.updateExperiments(worldExperiments, targetWorld);
      setExperimentsSaveMsg({
        type: 'success',
        text: res.message || `Experimental features saved for "${targetWorld}"!`,
      });
      if (res.data?.experiments) {
        setWorldExperiments(res.data.experiments);
      }
      if (typeof res.data?.serverRunning === 'boolean') {
        setServerRunning(res.data.serverRunning);
      }
    } catch (err) {
      setExperimentsSaveMsg({
        type: 'error',
        text: err.message || 'Failed to update experimental features in level.dat.',
      });
    } finally {
      setExperimentsSaving(false);
    }
  };

  const handlePropertyChange = (key, value) => {
    const updated = {
      ...propertiesRef.current,
      [key]: value,
    };
    setProperties(updated);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      saveProperties(updated);
    }, 600);
  };

  const isBooleanValue = (val) => {
    if (typeof val === 'boolean') return true;
    if (typeof val === 'string' && (val.toLowerCase() === 'true' || val.toLowerCase() === 'false')) return true;
    return false;
  };

  const toBool = (val) => {
    if (typeof val === 'boolean') return val;
    return String(val).toLowerCase() === 'true';
  };

  const isOnlineModeDisabled = properties['online-mode'] === false || properties['online-mode'] === 'false';

  // Categorize keys
  const allKeys = Object.keys(properties).sort();

  const getCategoryForProp = (key) => {
    if (PROPERTY_METADATA[key]?.category) {
      return PROPERTY_METADATA[key].category;
    }
    return 'advanced';
  };

  const knownKeys = new Set(knownExperiments.map((k) => k.key));
  const customKeys = Object.keys(worldExperiments).filter(
    (k) => !knownKeys.has(k) && k !== 'experiments_ever_used' && k !== 'saved_with_toggled_experiments'
  );

  const allDisplayExperiments = [
    ...knownExperiments.map((k) => ({
      ...k,
      badgeType: k.recommendedForAddons ? 'essential' : 'gameplay',
    })),
    ...customKeys.map((key) => ({
      key,
      name: key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      badge: 'Custom Tag',
      badgeType: 'custom',
      description: 'Custom experimental gameplay tag present in world level.dat.',
    })),
  ];

  const filteredKeys = allKeys.filter((key) => {
    const meta = PROPERTY_METADATA[key];
    const cat = getCategoryForProp(key);

    // If experiments tab is active, standard server.properties keys are hidden
    if (activeCategory === 'experiments') {
      return false;
    }

    // Filter by tab
    if (activeCategory !== 'all' && cat !== activeCategory) {
      return false;
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchKey = key.toLowerCase().includes(q);
      const matchLabel = meta?.label?.toLowerCase().includes(q);
      const matchDesc = meta?.description?.toLowerCase().includes(q);
      return matchKey || matchLabel || matchDesc;
    }

    return true;
  });

  const renderControl = (key, value) => {
    const meta = PROPERTY_METADATA[key];

    // Options dropdown or visual pill buttons
    if (meta?.options) {
      return (
        <div className="prop-control-options">
          <div className="option-segmented-group">
            {meta.options.map((opt) => (
              <button
                key={opt}
                type="button"
                className={`segmented-btn ${String(value).toLowerCase() === opt.toLowerCase() ? 'active' : ''}`}
                onClick={() => handlePropertyChange(key, opt)}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      );
    }

    // Hardware RAM Presets with custom MB input
    if (meta?.presets) {
      return (
        <div className="prop-control-ram-presets">
          <div className="option-segmented-group" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
            {meta.presets.map((preset) => {
              const gb = Math.round(Number(preset) / 1024);
              const isSelected = String(value) === String(preset);
              return (
                <button
                  key={preset}
                  type="button"
                  className={`segmented-btn ${isSelected ? 'active' : ''}`}
                  onClick={() => handlePropertyChange(key, preset)}
                >
                  {gb} GB ({preset} MB)
                </button>
              );
            })}
          </div>
          <div className="prop-control-numeric" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="number"
              className="input-modern numeric-input"
              min={meta.min ?? 1024}
              max={meta.max ?? 65536}
              value={value ?? 4096}
              onChange={(e) => {
                const val = e.target.value === '' ? '' : e.target.value;
                handlePropertyChange(key, val);
              }}
              style={{ maxWidth: '160px' }}
            />
            <span style={{ fontSize: '0.82rem', color: 'var(--text-sub, #94a3b8)', fontWeight: 600 }}>
              MB ({(Number(value || 4096) / 1024).toFixed(2)} GB Allocated)
            </span>
          </div>
        </div>
      );
    }

    // Boolean toggle switch
    if (isBooleanValue(value) || meta?.type === 'boolean') {
      const checked = toBool(value);
      return (
        <div className="prop-control-toggle">
          <label className="modern-switch-wrapper">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => handlePropertyChange(key, e.target.checked)}
            />
            <span className="modern-switch-slider"></span>
          </label>
          <span className={`switch-state-badge ${checked ? 'state-on' : 'state-off'}`}>
            {checked ? 'TRUE (Enabled)' : 'FALSE (Disabled)'}
          </span>
        </div>
      );
    }

    // Numeric input / slider
    if (typeof value === 'number' || (meta?.min !== undefined && meta?.max !== undefined) || (!isNaN(Number(value)) && typeof value === 'string' && /^\d+$/.test(value))) {
      const numVal = value === '' ? 0 : Number(value);
      return (
        <div className="prop-control-numeric">
          <input
            type="number"
            className="input-modern numeric-input"
            min={meta?.min ?? 0}
            max={meta?.max ?? 65535}
            value={value}
            onChange={(e) => {
              const val = e.target.value === '' ? '' : Number(e.target.value);
              handlePropertyChange(key, val);
            }}
          />
          {meta?.min !== undefined && meta?.max !== undefined && (
            <input
              type="range"
              className="range-slider-modern"
              min={meta.min}
              max={meta.max}
              value={numVal}
              onChange={(e) => handlePropertyChange(key, Number(e.target.value))}
            />
          )}
        </div>
      );
    }

    // Default text input
    return (
      <div className="prop-control-text">
        <input
          type="text"
          className="input-modern text-input"
          value={value ?? ''}
          placeholder="Enter configuration value..."
          onChange={(e) => handlePropertyChange(key, e.target.value)}
        />
      </div>
    );
  };

  if (loading) {
    return (
      <div className="loading-container py-16">
        <div className="spinner"></div>
        <p className="loading-text mt-3">Loading server.properties configuration...</p>
      </div>
    );
  }

  return (
    <div className="page-container properties-overhaul-page">
      {/* Top Banner Header */}
      <div className="section-header-modern">
        <div>
          <div className="title-with-pill">
            <h1 className="page-title">Server Configuration</h1>
            <span className="bds-tag-pill">server.properties</span>
          </div>
          <p className="page-subtitle">
            Fine-tune Minecraft Bedrock engine variables, networking boundaries, gamemodes, and security rules.
          </p>
        </div>

        {/* Save Status & Auto-save Badge */}
        <div className="header-status-group d-flex items-center gap-2">
          {saveStatus === 'saving' && (
            <div className="save-badge-pill saving">
              <span className="spinner-sm"></span> Saving changes...
            </div>
          )}
          {saveStatus === 'saved' && (
            <div className="save-badge-pill saved">
              ✓ Saved &amp; Synced
            </div>
          )}
          {saveStatus === 'error' && (
            <div className="save-badge-pill error">
              ⚠️ Save failed
            </div>
          )}
          {saveStatus === 'idle' && (
            <div className="save-badge-pill idle">
              ⚡ Auto-saves instantly
            </div>
          )}
        </div>
      </div>

      {errorMessage && (
        <div className="toast-banner toast-error mb-4">
          <span>⚠️ {errorMessage}</span>
          <button className="toast-close" onClick={() => setErrorMessage('')}>✕</button>
        </div>
      )}

      {/* Online Mode Disabled Alert Notice */}
      {isOnlineModeDisabled && (
        <div className="alert-box-modern alert-warning-modern">
          <div className="alert-icon-big">⚠️</div>
          <div className="alert-text-body">
            <h4>Online Mode Disabled (online-mode=false)</h4>
            <p>
              Bedrock clients do not authenticate with Xbox Live accounts. Allowlist validation and gamer identity checks cannot be cryptographically verified.
            </p>
          </div>
        </div>
      )}

      {/* Search & Category Filter Navigation */}
      <div className="properties-nav-bar">
        <div className="category-tabs-group">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              className={`cat-tab-btn ${activeCategory === cat.id ? 'active' : ''}`}
              onClick={() => setActiveCategory(cat.id)}
            >
              <span className="cat-icon">{cat.icon}</span>
              <span className="cat-name">{cat.label}</span>
            </button>
          ))}
        </div>

        <div className="prop-search-wrapper">
          <span className="search-glyph">🔍</span>
          <input
            type="text"
            className="search-field-pill"
            placeholder="Search properties (e.g. port, difficulty, cheats)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="clear-search-btn" onClick={() => setSearchQuery('')}>✕</button>
          )}
        </div>
      </div>

      {/* =========================================================================
          WORLD EXPERIMENTAL FEATURES (FOR ADD-ONS)
          ========================================================================= */}
      {(activeCategory === 'experiments' || activeCategory === 'all' || activeCategory === 'world') && (
        <div className="card world-experiments-card mb-6">
          <div className="card-header d-flex justify-between items-center flex-wrap gap-3">
            <div className="d-flex items-center gap-2.5">
              <span className="experiments-title-icon">🧪</span>
              <div>
                <div className="d-flex items-center gap-2">
                  <h3 className="m-0 text-base font-bold text-white">World Experimental Features</h3>
                  <span className="badge badge-emerald text-2xs uppercase tracking-wider font-mono">For Add-Ons</span>
                </div>
                <p className="text-sub text-xs m-0 mt-0.5">
                  Enable experimental creator toggles and scripting APIs in <code>level.dat</code>. Required for add-ons (custom entities, blocks, items, UI, and scripts).
                </p>
              </div>
            </div>

            {/* Target World Selector & Quick Actions */}
            <div className="d-flex items-center gap-2 flex-wrap">
              {availableWorlds.length > 1 && (
                <div className="d-flex items-center gap-1.5">
                  <span className="text-2xs text-sub uppercase font-bold">World:</span>
                  <select
                    className="input-modern select-xs"
                    value={targetWorld}
                    onChange={(e) => {
                      setTargetWorld(e.target.value);
                      fetchWorldExperiments(e.target.value);
                    }}
                  >
                    {availableWorlds.map((w) => (
                      <option key={w} value={w}>
                        {w} {w === activeWorld ? '(Active in server.properties)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={handleEnableAllAddonRecommended}
                title="Enable all recommended creator and scripting toggles for add-ons"
              >
                ⚡ Enable All for Add-Ons
              </button>

              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={handleDisableAllExperiments}
                title="Turn off all experimental toggles"
              >
                Turn All Off
              </button>

              <button
                type="button"
                className="btn btn-primary btn-xs d-flex items-center gap-1"
                onClick={handleSaveExperiments}
                disabled={experimentsSaving || !hasLevelDat}
              >
                {experimentsSaving ? (
                  <>
                    <span className="spinner-sm" /> Saving...
                  </>
                ) : (
                  <>
                    <span>💾</span> Save Experiments
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="card-body p-4">
            {/* Feedback message banner */}
            {experimentsSaveMsg && (
              <div className={`alert-toast alert-${experimentsSaveMsg.type} mb-4`}>
                <span className="toast-icon">
                  {experimentsSaveMsg.type === 'success' ? '✓' : '⚠️'}
                </span>
                <span className="toast-text">{experimentsSaveMsg.text}</span>
                <button
                  type="button"
                  className="toast-dismiss"
                  onClick={() => setExperimentsSaveMsg(null)}
                >
                  ✕
                </button>
              </div>
            )}

            {/* Server running notice */}
            {serverRunning && (
              <div className="experiments-running-banner mb-4">
                <span className="notice-icon">ℹ️</span>
                <span className="notice-text">
                  The server is currently running. After saving experimental features to <code>level.dat</code>, <strong>restart the server</strong> for Bedrock Dedicated Server to load them into the world.
                </span>
              </div>
            )}

            {!hasLevelDat ? (
              <div className="p-4 text-center border-dashed rounded bg-darker">
                <p className="text-secondary text-sm m-0">
                  World <code>{targetWorld}</code> has not been generated or loaded by Bedrock yet. Start the server once with this world to generate its <code>level.dat</code> save file.
                </p>
              </div>
            ) : (
              <>
                <div className="experiments-toggles-grid">
                  {allDisplayExperiments.map((exp) => {
                    const isEnabled = Boolean(worldExperiments[exp.key]);
                    return (
                      <div
                        key={exp.key}
                        className={`experiment-toggle-card ${isEnabled ? 'is-enabled' : ''}`}
                      >
                        <div className="d-flex items-center justify-between gap-2 mb-1.5">
                          <div className="d-flex items-center gap-2">
                            <span className="exp-key-tag font-mono text-2xs">{exp.key}</span>
                            {exp.badge && (
                              <span className={`exp-badge exp-badge-${exp.badgeType || 'recommended'}`}>
                                {exp.badge}
                              </span>
                            )}
                          </div>
                          <label className="modern-switch-wrapper" style={{ width: 44, height: 24, margin: 0 }}>
                            <input
                              type="checkbox"
                              checked={isEnabled}
                              onChange={(e) => handleToggleExperiment(exp.key, e.target.checked)}
                            />
                            <span className="modern-switch-slider" style={{ borderRadius: 24 }} />
                          </label>
                        </div>

                        <h4 className="exp-title m-0">{exp.name}</h4>
                        <p className="exp-desc text-sub text-xs m-0 mt-1">{exp.description}</p>
                      </div>
                    );
                  })}
                </div>

                {/* Custom Experiment Tag Input */}
                <form
                  onSubmit={handleAddCustomExperimentTag}
                  className="custom-exp-form mt-4 pt-3 border-t d-flex items-center gap-2 flex-wrap"
                >
                  <span className="text-2xs text-sub font-bold uppercase tracking-wider">
                    Add Custom Experiment Tag:
                  </span>
                  <input
                    type="text"
                    className="input-modern input-xs"
                    style={{ maxWidth: '240px' }}
                    placeholder="e.g. experimental_cameras"
                    value={customExpKey}
                    onChange={(e) => setCustomExpKey(e.target.value)}
                  />
                  <button
                    type="submit"
                    className="btn btn-secondary btn-xs"
                    disabled={!customExpKey.trim()}
                  >
                    ➕ Add Flag
                  </button>
                  <span className="text-2xs text-sub ml-auto">
                    Target World: <strong>{targetWorld || activeWorld || 'Bedrock level'}</strong>
                  </span>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* Properties Cards Grid */}
      {activeCategory !== 'experiments' && (
        filteredKeys.length === 0 ? (
          <div className="empty-properties-state">
            <div className="empty-icon">🔍</div>
            <h3>No Properties Match "{searchQuery}"</h3>
            <p>Try searching for a different keyword or switch to the "All Settings" category tab.</p>
          </div>
        ) : (
          <div className="properties-modern-grid">
            {filteredKeys.map((key) => {
              const meta = PROPERTY_METADATA[key];
              const val = properties[key];
              const icon = meta?.icon || '⚙️';
              const label = meta?.label || key;
              const desc = meta?.description || 'Raw dedicated server parameter in server.properties.';

              return (
                <div key={key} className="prop-modern-card">
                  <div className="prop-card-head">
                    <div className="prop-title-flex">
                      <span className="prop-icon-glyph">{icon}</span>
                      <div>
                        <h3 className="prop-display-label">{label}</h3>
                        <span className="prop-raw-key">{key}</span>
                      </div>
                    </div>
                    <span className="prop-cat-badge">{getCategoryForProp(key)}</span>
                  </div>

                  <p className="prop-card-desc">{desc}</p>

                  <div className="prop-card-interactive">
                    {renderControl(key, val)}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
};

export default Properties;
