import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api';

export const Console = () => {
  const { isAdmin } = useAuth();
  const [logs, setLogs] = useState([]);
  const [command, setCommand] = useState('');
  const [sending, setSending] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const terminalEndRef = useRef(null);
  const terminalContainerRef = useRef(null);

  // Poll logs every 2 seconds
  useEffect(() => {
    let isMounted = true;

    const fetchLogs = async () => {
      try {
        const data = await api.getLogs();
        if (isMounted) {
          let logLines = [];
          if (Array.isArray(data)) {
            logLines = data;
          } else if (typeof data === 'string') {
            logLines = data.split('\n');
          } else if (data && Array.isArray(data.logs)) {
            logLines = data.logs;
          } else if (data && typeof data.logs === 'string') {
            logLines = data.logs.split('\n');
          }
          setLogs(logLines.filter((line) => line !== undefined && line !== null));
        }
      } catch (err) {
        // Silent poll error
      }
    };

    fetchLogs();
    const interval = setInterval(fetchLogs, 2000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Auto scroll to bottom
  useEffect(() => {
    if (autoScroll && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const handleScroll = () => {
    if (!terminalContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = terminalContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  const handleSendCommand = async (e) => {
    e.preventDefault();
    if (!command.trim() || sending) return;

    // Strip leading slash from commands (e.g. /say Hello -> say Hello)
    const cleanCmd = command.trim().replace(/^\//, '');
    setSending(true);
    setErrorMsg('');

    try {
      await api.sendCommand(cleanCmd);
      setCommand('');
      // Trigger log refresh immediately
      const refreshed = await api.getLogs();
      let logLines = [];
      if (Array.isArray(refreshed)) {
        logLines = refreshed;
      } else if (typeof refreshed === 'string') {
        logLines = refreshed.split('\n');
      } else if (refreshed && Array.isArray(refreshed.logs)) {
        logLines = refreshed.logs;
      } else if (refreshed && typeof refreshed.logs === 'string') {
        logLines = refreshed.logs.split('\n');
      }
      setLogs(logLines.filter((line) => line !== undefined && line !== null));
      setAutoScroll(true);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to send command to server.');
    } finally {
      setSending(false);
    }
  };

  // Strip timestamp and bracket prefix
  const cleanLogLine = (rawLine) => {
    if (typeof rawLine !== 'string') return String(rawLine);
    // Regex for [2026-06-17 17:10:02:079 INFO] or [2026-06-17 17:10:02 INFO]
    const cleaned = rawLine.replace(/^\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?::\d+)?\s*(?:INFO|WARN|WARNING|ERROR|FATAL|DEBUG)?\]\s*/i, '');
    return cleaned;
  };

  // Determine line style based on contents
  const getLineClass = (rawLine) => {
    if (typeof rawLine !== 'string') return 'log-info';
    const lower = rawLine.toLowerCase();
    if (lower.includes('error') || lower.includes('fatal') || lower.includes('exception') || lower.includes('failed')) {
      return 'log-error';
    }
    if (lower.includes('warn') || lower.includes('warning')) {
      return 'log-warn';
    }
    if (
      lower.includes('joined the game') ||
      lower.includes('left the game') ||
      lower.includes('player connected') ||
      lower.includes('player disconnected')
    ) {
      return 'log-player';
    }
    return 'log-info';
  };

  return (
    <div className="console-page">
      <div className="console-header">
        <div>
          <h1 className="page-title">Server Console</h1>
          <p className="page-subtitle">Real-time Minecraft Bedrock logs and command interface</p>
        </div>
        <div className="console-actions">
          <button
            type="button"
            className={`btn btn-sm ${autoScroll ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => {
              setAutoScroll(true);
              if (terminalEndRef.current) {
                terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
              }
            }}
          >
            {autoScroll ? 'Auto-scroll: ON' : 'Scroll to Bottom'}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setLogs([])}
          >
            Clear Screen
          </button>
        </div>
      </div>

      {errorMsg && <div className="alert alert-danger console-alert">{errorMsg}</div>}

      {/* Terminal View */}
      <div
        className="terminal-window"
        ref={terminalContainerRef}
        onScroll={handleScroll}
      >
        <div className="terminal-logs">
          {logs.length === 0 ? (
            <div className="log-line log-muted">Waiting for server output...</div>
          ) : (
            logs.map((rawLine, index) => {
              const displayLine = cleanLogLine(rawLine);
              const lineClass = getLineClass(rawLine);
              return (
                <div key={index} className={`log-line ${lineClass}`}>
                  <span className="log-text">{displayLine}</span>
                </div>
              );
            })
          )}
          <div ref={terminalEndRef} />
        </div>
      </div>

      {/* Command Input or Viewer Notice */}
      {isAdmin ? (
        <div className="console-input-section">
          {/* Mobile-Friendly Quick Command Chips */}
          <div className="console-quick-chips">
            <span className="chips-label">Quick:</span>
            {[
              { label: '👥 list', cmd: 'list' },
              { label: '💾 save-all', cmd: 'save-all' },
              { label: '☀️ day', cmd: 'time set day' },
              { label: '🌙 night', cmd: 'time set night' },
              { label: '🌤️ clear', cmd: 'weather clear' },
              { label: '❓ help', cmd: 'help' },
            ].map((chip) => (
              <button
                key={chip.cmd}
                type="button"
                className="btn-quick-chip"
                onClick={() => setCommand(chip.cmd)}
                title={`Insert "${chip.cmd}"`}
              >
                {chip.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSendCommand} className="console-command-form">
            <span className="command-prompt-symbol">&gt;</span>
            <input
              type="text"
              className="command-input"
              placeholder="Type command (e.g. list, say Hello, op player)..."
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              disabled={sending}
            />
            <button type="submit" className="btn btn-primary" disabled={sending || !command.trim()}>
              {sending ? '...' : 'Send'}
            </button>
          </form>
        </div>
      ) : (
        <div className="console-viewer-notice">
          <span>🔒 You are viewing console in read-only mode. Administrator permissions required to send commands.</span>
        </div>
      )}
    </div>
  );
};

export default Console;
