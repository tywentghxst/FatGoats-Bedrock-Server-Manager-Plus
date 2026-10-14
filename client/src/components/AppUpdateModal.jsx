import React, { useState, useEffect, useRef } from 'react';
import api from '../api';

export const AppUpdateModal = ({ updateInfo, onClose, onUpdateSuccess }) => {
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState(null);
  const [successResult, setSuccessResult] = useState(null);
  const [progressData, setProgressData] = useState({
    percent: 10,
    stage: 1,
    progress: 'Preparing application update environment...',
  });
  const pollIntervalRef = useRef(null);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  if (!updateInfo || !updateInfo.updateAvailable) return null;

  const startProgressPolling = () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await api.Updates.getProgress();
        if (res) {
          setProgressData((prev) => ({
            percent: Math.max(prev.percent, res.percent || 10),
            stage: res.stage || prev.stage || 1,
            progress: res.progress || prev.progress,
          }));
        }
      } catch (_) {}
    }, 600);
  };

  const stopProgressPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const handleUpdateNow = async () => {
    setUpdating(true);
    setError(null);
    setProgressData({
      percent: 15,
      stage: 1,
      progress: 'Creating safety backup of database...',
    });
    startProgressPolling();

    try {
      const res = await api.Updates.apply();
      stopProgressPolling();
      setProgressData({
        percent: 100,
        stage: 5,
        progress: 'App successfully updated to latest version!',
      });
      setSuccessResult(res);
      if (onUpdateSuccess) onUpdateSuccess(res);
    } catch (err) {
      console.error('Failed to apply update:', err);
      stopProgressPolling();
      setError(err.message || 'Failed to apply update.');
      setUpdating(false);
    }
  };

  const handleAskLater = async () => {
    try {
      await api.Updates.setPreferences({ askLater: true });
    } catch (_) {}
    onClose();
  };

  const handleIgnore = async () => {
    try {
      await api.Updates.setPreferences({ ignoredCommit: updateInfo.remoteCommitFull || updateInfo.remoteCommit });
    } catch (_) {}
    onClose();
  };

  const updateSteps = [
    { num: 1, label: 'Safety Backup', icon: '🛡️' },
    { num: 2, label: 'Pull Commits', icon: '📥' },
    { num: 3, label: 'Dependencies', icon: '📦' },
    { num: 4, label: 'Build Client', icon: '⚡' },
    { num: 5, label: 'Launcher Binary', icon: '🪟' },
  ];

  return (
    <div className="modal-overlay" onClick={() => !updating && onClose()}>
      <div className="modal app-update-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 580 }}>
        {/* Modal Header */}
        <div className="modal-header d-flex justify-between items-center">
          <div className="d-flex items-center gap-2.5">
            <span className="text-2xl">🚀</span>
            <div>
              <h3 className="modal-title font-bold text-white m-0">Application Update Available</h3>
              <span className="text-xs text-sub">FatGoats Bedrock Server Manager Plus</span>
            </div>
          </div>
          {!updating && (
            <button type="button" className="modal-close-btn" onClick={onClose} title="Close">
              ✕
            </button>
          )}
        </div>

        {/* Modal Body */}
        <div className="modal-body p-5">
          {successResult ? (
            <div className="text-center py-4">
              <div className="text-5xl mb-3">🎉</div>
              <h4 className="text-white font-bold text-xl mb-1">Update Installed Successfully!</h4>
              <p className="text-sub text-sm mb-4">
                The application has been safely upgraded to commit{' '}
                <strong className="text-emerald">#{successResult.newCommit || updateInfo.remoteCommit}</strong>.
                All active worlds, database tables, player inventories, and server configurations were 100% preserved.
              </p>

              <div className="p-3 bg-darker rounded font-mono text-xs text-sub mb-4">
                Installed commit: #{successResult.newCommit || updateInfo.remoteCommit} &bull; Safe Zero Data Loss
              </div>

              <button
                type="button"
                className="btn btn-primary font-bold px-6 py-2.5 text-sm"
                onClick={() => window.location.reload()}
              >
                🔄 Reload App Now
              </button>
            </div>
          ) : (
            <>
              {error && (
                <div className="alert-toast alert-error mb-4">
                  ⚠️ {error}
                </div>
              )}

              {/* Real-time Update Progress Bar & Steps when updating */}
              {updating ? (
                <div className="update-progress-container mb-4">
                  <div className="update-progress-header">
                    <div>
                      <span className="text-xs uppercase font-bold text-sub d-block">Applying Update</span>
                      <strong className="text-white text-sm">Automated Pipeline in Progress</strong>
                    </div>
                    <span className="update-progress-percentage">{progressData.percent}%</span>
                  </div>

                  {/* Visual Progress Track */}
                  <div className="update-progress-track">
                    <div
                      className="update-progress-fill"
                      style={{ width: `${progressData.percent}%` }}
                    />
                  </div>

                  {/* Step Pills */}
                  <div className="update-steps-stepper">
                    {updateSteps.map((s) => {
                      const isDone = progressData.stage > s.num;
                      const isActive = progressData.stage === s.num;
                      return (
                        <div
                          key={s.num}
                          className={`update-step-pill ${isActive ? 'is-active' : ''} ${isDone ? 'is-done' : ''}`}
                        >
                          <span>{isDone ? '✓' : s.icon}</span>
                          <span className="truncate">{s.label}</span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Live Status Line */}
                  <div className="update-status-live-line">
                    <span className="update-status-dot" />
                    <span className="truncate flex-1">{progressData.progress}</span>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-white text-sm mb-3">
                    A newer release has been pushed to the GitHub repository. Updating synchronizes your app with the latest features, enhancements, and stability improvements.
                  </p>

                  {/* Version Comparison Box */}
                  <div className="p-3 bg-darker rounded-xl mb-3 d-flex justify-between items-center font-mono text-xs border border-white/5">
                    <div>
                      <span className="text-sub d-block text-2xs uppercase font-sans">Current Version</span>
                      <span className="text-white font-bold text-sm">#{updateInfo.currentCommit || 'local'}</span>
                      {updateInfo.currentCommitDate && (
                        <span className="text-sub text-2xs d-block">{updateInfo.currentCommitDate}</span>
                      )}
                    </div>
                    <div className="text-sub text-xl font-sans px-2">➔</div>
                    <div>
                      <span className="text-emerald d-block text-2xs uppercase font-sans font-bold">New Available Version</span>
                      <span className="text-emerald font-bold text-sm">#{updateInfo.remoteCommit}</span>
                      {updateInfo.remoteCommitDate && (
                        <span className="text-sub text-2xs d-block">{updateInfo.remoteCommitDate}</span>
                      )}
                    </div>
                  </div>

                  {/* Latest commit subject */}
                  {updateInfo.remoteCommitSubject && (
                    <div className="mb-3 p-3 rounded-lg" style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                      <span className="text-sub text-2xs d-block uppercase font-semibold mb-1">Latest Commit Subject:</span>
                      <p className="text-white text-xs m-0 font-medium">"{updateInfo.remoteCommitSubject}"</p>
                    </div>
                  )}

                  {/* Changelog List */}
                  {updateInfo.changelog && updateInfo.changelog.length > 0 && (
                    <div className="mb-3">
                      <span className="text-sub text-2xs d-block uppercase font-semibold mb-1.5">
                        What's New ({updateInfo.commitsBehind} commit{updateInfo.commitsBehind !== 1 ? 's' : ''}):
                      </span>
                      <div className="max-h-36 overflow-y-auto bg-darker p-2.5 rounded-lg text-xs space-y-1.5 border border-white/5">
                        {updateInfo.changelog.map((c, idx) => (
                          <div key={idx} className="d-flex items-baseline gap-2">
                            <span className="font-mono text-emerald text-2xs shrink-0">#{c.hash}</span>
                            <span className="text-white text-xs truncate flex-1">{c.subject}</span>
                            <span className="text-sub text-2xs shrink-0">{c.date}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Zero Data Loss Guarantee Shield */}
                  <div className="p-3 rounded-xl mb-2" style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
                    <div className="d-flex items-center gap-2 text-emerald font-semibold text-xs mb-1">
                      <span>🛡️</span>
                      <span>Zero Data Loss Protection Guarantee</span>
                    </div>
                    <p className="text-sub text-xs m-0 leading-relaxed" style={{ fontSize: '0.74rem' }}>
                      Updates execute git fast-forward pulls and rebuild the client interface. Worlds (<code>worlds/</code>), SQLite database (<code>data/db/manager.db</code>), player data, backups, and custom addons are completely preserved.
                    </p>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Modal Footer Controls */}
        {!successResult && (
          <div className="modal-footer d-flex justify-between items-center gap-2 flex-wrap p-4 border-top">
            <div className="d-flex items-center gap-2">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleIgnore}
                disabled={updating}
                title="Do not show notification again for this commit"
              >
                🚫 Ignore
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleAskLater}
                disabled={updating}
                title="Remind me again in 24 hours"
              >
                ⏰ Ask Later
              </button>
            </div>

            <button
              type="button"
              className="btn btn-primary btn-sm font-bold px-5 py-2"
              onClick={handleUpdateNow}
              disabled={updating}
            >
              {updating ? 'Applying Update...' : '🚀 Update Now (Zero Data Loss)'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AppUpdateModal;
