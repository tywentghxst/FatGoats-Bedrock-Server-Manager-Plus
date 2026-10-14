import React from 'react';

const STAGES = [
  { id: 1, label: 'Safety Backup', icon: '🛡️', desc: 'Backing up SQLite database & world configs' },
  { id: 2, label: 'GitHub Pull', icon: '🐙', desc: 'Pulling latest commits from origin/main' },
  { id: 3, label: 'Dependencies', icon: '📦', desc: 'Verifying & updating packages' },
  { id: 4, label: 'Build Client', icon: '⚡', desc: 'Compiling production frontend with Vite' },
  { id: 5, label: 'Tray Launcher', icon: '🖥️', desc: 'Rebuilding BedrockServerManager.exe' },
];

export const UpdateProgressBar = ({ progress, className = '' }) => {
  const currentStage = progress?.stage || 1;
  const percent = Math.min(100, Math.max(0, progress?.progressPercent || 0));
  const stageName = progress?.stageName || 'Preparing update...';
  const details = progress?.details || 'Starting automated update sequence...';

  return (
    <div className={`update-progress-container ${className}`}>
      {/* Top Header: Current Action & Live Percent */}
      <div className="d-flex items-center justify-between gap-3 mb-2 flex-wrap">
        <div className="d-flex items-center gap-2">
          <div className="spinner spinner-xs" style={{ width: 16, height: 16 }}></div>
          <span className="text-white font-bold text-sm tracking-wide">
            {stageName}
          </span>
        </div>
        <span className="font-mono text-emerald font-extrabold text-sm px-2.5 py-0.5 rounded-full" style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
          {percent}%
        </span>
      </div>

      {/* Main Animated Progress Track */}
      <div
        className="w-full rounded-full overflow-hidden mb-3"
        style={{
          height: 10,
          background: 'rgba(15, 23, 42, 0.8)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.4)',
        }}
      >
        <div
          className="h-full transition-all duration-300 ease-out"
          style={{
            width: `${percent}%`,
            background: 'linear-gradient(90deg, #10b981 0%, #06b6d4 50%, #3b82f6 100%)',
            boxShadow: '0 0 12px rgba(6, 182, 212, 0.6)',
            borderRadius: 9999,
          }}
        />
      </div>

      {/* Real-time Subtext / Detail Message */}
      <p className="text-sub text-xs m-0 mb-3 truncate font-mono" style={{ fontSize: '0.75rem' }} title={details}>
        {details}
      </p>

      {/* Interactive Step-by-Step Stage Pills */}
      <div className="update-stages-grid d-flex justify-between items-center gap-1.5 flex-wrap">
        {STAGES.map((s) => {
          const isDone = currentStage > s.id || percent >= 100;
          const isActive = currentStage === s.id && percent < 100;
          const isPending = currentStage < s.id && percent < 100;

          let pillBg = 'rgba(255, 255, 255, 0.03)';
          let pillBorder = 'rgba(255, 255, 255, 0.08)';
          let pillColor = 'var(--text-sub, #94a3b8)';

          if (isDone) {
            pillBg = 'rgba(16, 185, 129, 0.12)';
            pillBorder = 'rgba(16, 185, 129, 0.35)';
            pillColor = '#34d399';
          } else if (isActive) {
            pillBg = 'rgba(6, 182, 212, 0.18)';
            pillBorder = 'rgba(6, 182, 212, 0.5)';
            pillColor = '#38bdf8';
          }

          return (
            <div
              key={s.id}
              className="update-stage-chip d-flex items-center gap-1 px-2 py-1 rounded text-2xs flex-1 min-w-0"
              style={{
                background: pillBg,
                border: `1px solid ${pillBorder}`,
                color: pillColor,
                transition: 'all 0.2s ease',
              }}
              title={s.desc}
            >
              <span className="shrink-0">
                {isDone ? '✓' : isActive ? '⏳' : s.icon}
              </span>
              <span className="font-semibold truncate text-2xs">
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default UpdateProgressBar;
