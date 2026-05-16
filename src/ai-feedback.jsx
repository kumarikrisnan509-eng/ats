/* eslint-disable */
/* T-I5: thumbs up/down widget for AI output.
   Mount under every AI-generated card with the call_id returned by the endpoint.
   The component handles the optimistic update + the PUT call itself; parents
   just need to pass {callId, workflow}.
*/

window.AiFeedback = function AiFeedback({ callId, workflow, compact = false }) {
  const [verdict, setVerdict] = React.useState(null);       // 'up' | 'down' | null
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);

  if (!callId) return null;     // nothing to attach feedback to

  const send = async (v) => {
    if (busy || verdict === v) return;
    setBusy(true);
    setError(null);
    const previous = verdict;
    setVerdict(v);    // optimistic
    try {
      const r = await fetch(`/api/me/ai-workflows/feedback/${callId}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: v }),
      }).then(r => r.json());
      if (!r.ok) {
        setVerdict(previous);
        setError(r.reason || r.detail || 'failed');
      }
    } catch (e) {
      setVerdict(previous);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const baseBtnStyle = (active) => ({
    padding: compact ? '2px 6px' : '4px 10px',
    fontSize: compact ? 12 : 13,
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: active ? 'var(--accent, #3b82f6)' : 'var(--surface, transparent)',
    color: active ? 'white' : 'var(--text-2, #555)',
    cursor: busy ? 'wait' : 'pointer',
    opacity: busy ? 0.6 : 1,
    transition: 'background 120ms ease, color 120ms ease',
    lineHeight: 1,
  });

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontSize: compact ? 11 : 12, color: 'var(--text-3)',
    }}>
      <span>Helpful?</span>
      <button
        onClick={() => send('up')}
        disabled={busy}
        title="This output was useful"
        style={baseBtnStyle(verdict === 'up')}
      >👍</button>
      <button
        onClick={() => send('down')}
        disabled={busy}
        title="This output was not useful"
        style={baseBtnStyle(verdict === 'down')}
      >👎</button>
      {verdict && !error && (
        <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 4 }}>thanks</span>
      )}
      {error && (
        <span style={{ fontSize: 11, color: 'var(--danger, #c53030)', marginLeft: 4 }}>{error}</span>
      )}
    </div>
  );
};
