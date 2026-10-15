import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  { id: 'general', label: 'General & Gameplay', icon: '⚔️' },
  { id: 'world', label: 'World & Simulation', icon: '🌍' },
  { id: 'security', label: 'Security & Access', icon: '🛡️' },
  { id: 'network', label: 'Network & Engine', icon: '⚡' },
  { id: 'advanced', label: 'Advanced BDS Raw', icon: '🔧' },
];

export const Properties = () => {
  const [properties, setProperties] = useState({});
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const [errorMessage, setErrorMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');

  const debounceTimerRef = useRef(null);
  const propertiesRef = useRef(properties);
  propertiesRef.current = properties;

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
  }, []);

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

  const filteredKeys = allKeys.filter((key) => {
    const meta = PROPERTY_METADATA[key];
    const cat = getCategoryForProp(key);

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
        <div className="header-status-group">
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

      {/* Properties Cards Grid */}
      {filteredKeys.length === 0 ? (
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
      )}
    </div>
  );
};

export default Properties;
