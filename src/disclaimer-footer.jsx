/* eslint-disable */
/* T99-H3: SEBI advisory disclaimer footer.
   Mounted on every AI-generated output (advisor card, monthly review, signal critique).
   Mandatory per Master Plan v11 — even though ATS is BYOK and never executes trades on
   the user's behalf, any AI-generated trading suggestion legally requires a "not advice"
   disclaimer in India unless the entity is SEBI-registered as RA/RIA.
   Compact and unobtrusive — always renders below AI output, never competes for attention.
*/

window.SebiDisclaimer = function SebiDisclaimer({ compact = false, style = {} }) {
  const baseStyle = {
    marginTop: compact ? 8 : 12,
    padding: compact ? '6px 10px' : '8px 12px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--surface-2, rgba(0,0,0,0.02))',
    fontSize: compact ? 11 : 12,
    lineHeight: 1.5,
    color: 'var(--text-2, #555)',
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    ...style,
  };
  return (
    <div style={baseStyle} role="note" aria-label="SEBI advisory disclaimer">
      <span style={{ fontSize: compact ? 12 : 14, flexShrink: 0, marginTop: 1 }} aria-hidden="true">⚠</span>
      <span>
        <strong>Advisory only. Not investment advice.</strong>{' '}
        ATS is not registered with SEBI as a Research Analyst or Investment Adviser.
        All AI-generated views are for educational use; you remain solely responsible
        for any trade you place. Past performance does not predict future results.
      </span>
    </div>
  );
};
