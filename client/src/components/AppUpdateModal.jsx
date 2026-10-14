import React, { useState, useEffect, useRef } from 'react';
import api from '../api';
import UpdateProgressBar from './UpdateProgressBar';

export const AppUpdateModal = ({ updateInfo, onClose, onUpdateSuccess }) => {
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState(null);
  const [successResult, setSuccessResult] = useState(null);
  const [liveProgress, setLiveProgress] = useState(null);
  const pollTimerRef = useRef(null);

  if (!updateInfo || !updateInfo.updateAvailable) return null;

  // Poll progress while updating
  useEffect(() => {
    if (updating) {
      pollTimerRef.current = setInterval(async () => {
        try {
          const p = await api.Updates.getProgress();
          if (p) setLiveProgress(p);
        } catch (_) {}
      }, 500);
    } else {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    }
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [updating]);

  const handleUpdateNow = async () => {
    setUpdating(true);
    setError(null);
    setLiveProgress({
      stage: 1,
      progressPercent: 10,
      stageName: 'Initializing update',
      details: 'Connecting to update engine...',
    });

    try {
      const res = await api.Updates.apply();
      setSuccessResult(res);
      if (onUpdateSuccess) onUpdateSuccess(res);
    } catch (err) {
      console.error('Failed to apply update:', err);
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

  return (
    <div className="modal-overlay" onClick={() => !updating && onClose()}>
      <div className="modal app-update-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 580 }}>
        <div className="modal-header d-flex justify-between items-center">
          <div className="d-flex items-center gap-2">
            <span className="text-xl">🚀</span>
            <h3 className="modal-title font-bold text-white m-0">App Update Available</h3>
          </div>
          {!updating && (
            <button type="button" className="modal-close-btn" onClick={onClose}>
              ✕
            </button>
          )}
        </div>

        <div className="modal-body p-5">
          {successResult ? (
            <div className="text-center py-4">
              <div className="text-4xl mb-2">🎉</div>
              <h4 className="text-white font-bold text-lg mb-1">Update Installed Successfully!</h4>
              <p className="text-sub text-sm mb-4">
                The application has been safely updated to commit <strong>#{successResult.newCommit || updateInfo.remoteCommit}</strong>. All worlds, database records, custom addons, and configurations were 100% preserved.
              </p>
              <button
                type="button"
                className="btn btn-primary font-bold px-6 py-2.5"
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

              <p className="text-white text-sm mb-3">
                A new version of <strong>Bedrock Dedicated Server Manager</strong> has been published to your GitHub repository.
              </p>

              {/* Version Comparison Box */}
              <div className="p-3 bg-darker rounded mb-3 d-flex justify-between items-center font-mono text-xs">
                <div>
                  <span className="text-sub d-block text-2xs uppercase font-sans">Current Version</span>
                  <span className="text-white font-bold">#{updateInfo.currentCommit || 'local'}</span>
                  {updateInfo.currentCommitDate && (
                    <span className="text-sub text-2xs d-block">{updateInfo.currentCommitDate}</span>
                  )}
                </div>
                <div className="text-sub text-lg font-sans">➔</div>
                <div>
                  <span className="text-emerald d-block text-2xs uppercase font-sans font-bold">New Available Version</span>
                  <span className="text-emerald font-bold">#{updateInfo.remoteCommit}</span>
                  {updateInfo.remoteCommitDate && (
                    <span className="text-sub text-2xs d-block">{updateInfo.remoteCommitDate}</span>
                  )}
                </div>
              </div>

              {/* Commit Details / Changelog */}
              {updateInfo.remoteCommitSubject && (
                <div className="mb-3 p-3 rounded" style={{ background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                  <span className="text-sub text-2xs d-block uppercase font-semibold mb-1">Latest Commit:</span>
                  <p className="text-white text-xs m-0 font-medium">{updateInfo.remoteCommitSubject}</p>
                </div>
              )}

              {/* Changelog List */}
              {updateInfo.changelog && updateInfo.changelog.length > 0 && (
                <div className="mb-3">
                  <span className="text-sub text-2xs d-block uppercase font-semibold mb-1">
                    What's New ({updateInfo.commitsBehind} commit{updateInfo.commitsBehind !== 1 ? 's' : ''}):
                  </span>
                  <div className="max-h-32 overflow-y-auto bg-darker p-2.5 rounded text-xs space-y-1.5">
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

              {/* Multi-Step Real-time Progress Bar when Updating */}
              {updating ? (
                <div className="p-4 rounded-xl mb-4" style={{ background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(6, 182, 212, 0.3)' }}>
                  <UpdateProgressBar progress={liveProgress} />
                </div>
              ) : (
                /* Data Safety Guarantee Shield */
                <div className="p-3 rounded mb-4" style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)' }}>
                  <div className="d-flex items-center gap-2 text-emerald font-semibold text-xs mb-0.5">
                    <span>🛡️</span>
                    <span>Zero Data Loss Protection</span>
                  </div>
                  <p className="text-sub text-xs m-0" style={{ fontSize: '0.72rem' }}>
                    Updating pulls only source code changes. Your database, active worlds, player inventories, backups, custom addons, and login credentials are never touched.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {!successResult && (
          <div className="modal-footer d-flex justify-between items-center gap-2 flex-wrap">
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
                ⏰ Ask Again Later
              </button>
            </div>

            <button
              type="button"
              className="btn btn-primary btn-sm font-bold px-5"
              onClick={handleUpdateNow}
              disabled={updating}
            >
              {updating ? 'Applying Update...' : '🚀 Update Now'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AppUpdateModal;
