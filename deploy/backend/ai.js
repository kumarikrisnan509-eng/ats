// ai.js -- Anthropic Claude wrapper for news sentiment, position review, strategy explanation.
//
// Activated only when env ANTHROPIC_API_KEY is set. Otherwise endpoints return a friendly
// 503 with { ok: false, reason: 'ai_disabled' }.
//
// Uses raw HTTPS (Node 18+ global fetch) -- no @anthropic-ai/sdk dependency.

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 1024;

class ClaudeAI {
  constructor({ apiKey, model, audit } = {}) {
    this.apiKey = apiKey || process.env.ANTHROPIC_API_KEY || '';
    this.model  = model  || process.env.ANTHROPIC_MODEL  || DEFAULT_MODEL;
    this.audit  = audit  || (() => {});
    this._dailyCount = 0;
    this._dailyResetAt = this._tomorrowMs();
    this._maxDaily = parseInt(process.env.ANTHROPIC_DAILY_CAP || '500', 10);
  }

  enabled() { return !!this.apiKey; }

  _tomorrowMs() {
    const d = new Date(); d.setUTCDate(d.getUTCDate() + 1); d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  }

  stats() {
    return {
      enabled:        this.enabled(),
      model:          this.model,
      dailyCalls:     this._dailyCount,
      dailyCap:       this._maxDaily,
      dailyResetAt:   new Date(this._dailyResetAt).toISOString(),
    };
  }

  async _call(systemPrompt, userPrompt) {
    if (!this.enabled()) throw new Error('ai_disabled: ANTHROPIC_API_KEY not set');
    if (Date.now() > this._dailyResetAt) { this._dailyCount = 0; this._dailyResetAt = this._tomorrowMs(); }
    if (this._dailyCount >= this._maxDaily) throw new Error(`ai_quota: daily cap (${this._maxDaily}) reached`);
    this._dailyCount++;

    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: MAX_TOKENS,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
        signal: ctrl.signal,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(`anthropic_${res.status}: ${body.error && body.error.message || res.statusText}`);
      const text = (body.content || []).map(b => b.text || '').join('').trim();
      this.audit('ai.call', { ok: true, in_tokens: body.usage && body.usage.input_tokens, out_tokens: body.usage && body.usage.output_tokens });
      return { text, usage: body.usage };
    } finally { clearTimeout(to); }
  }

  /**
   * Classify news items as bullish/bearish/neutral for their tagged symbols.
   * @param {Array<{title:string, summary?:string, symbols:string[]}>} items
   * @returns {Promise<Array<{title:string, sentiment:'bullish'|'bearish'|'neutral', rationale:string}>>}
   */
  async newsSentiment(items) {
    if (!Array.isArray(items) || !items.length) return [];
    const trimmed = items.slice(0, 20).map((it, i) => ({
      i, title: String(it.title || '').slice(0, 200),
      summary: String(it.summary || '').slice(0, 300),
      symbols: Array.isArray(it.symbols) ? it.symbols.slice(0, 5) : [],
    }));
    const sys = 'You are a financial news classifier for Indian equity markets. Output ONLY a JSON array, no prose. Each element: {"i": int, "sentiment": "bullish"|"bearish"|"neutral", "rationale": "<= 60 chars"}.';
    const usr = 'Classify each news item for impact on its tagged symbol(s). Items:\n' + JSON.stringify(trimmed);
    const { text } = await this._call(sys, usr);
    // Try to extract JSON array
    let parsed;
    try {
      const m = text.match(/\[[\s\S]*\]/);
      parsed = JSON.parse(m ? m[0] : text);
    } catch { parsed = []; }
    const byI = new Map(parsed.filter(p => Number.isInteger(p.i)).map(p => [p.i, p]));
    return items.slice(0, 20).map((it, i) => ({
      title: it.title,
      sentiment: (byI.get(i) && byI.get(i).sentiment) || 'neutral',
      rationale: (byI.get(i) && byI.get(i).rationale) || '',
    }));
  }

  /**
   * Brief commentary on each open paper position.
   * @param {Array<{symbol, qty, avgPrice, ltp, unrealizedPnl}>} positions
   * @returns {Promise<Array<{symbol, commentary}>>}
   */
  async positionReview(positions) {
    if (!Array.isArray(positions) || !positions.length) return [];
    const trimmed = positions.slice(0, 30);
    const sys = 'You are a portfolio risk reviewer. Output ONLY a JSON array, no prose. Each element: {"symbol": str, "commentary": "<= 100 chars about whether to hold/trim/exit and why"}.';
    const usr = 'Review these open positions in Indian equities:\n' + JSON.stringify(trimmed);
    const { text } = await this._call(sys, usr);
    let parsed;
    try { const m = text.match(/\[[\s\S]*\]/); parsed = JSON.parse(m ? m[0] : text); }
    catch { parsed = []; }
    const bySym = new Map(parsed.filter(p => p.symbol).map(p => [p.symbol, p.commentary || '']));
    return positions.map(p => ({ symbol: p.symbol, commentary: bySym.get(p.symbol) || '' }));
  }

  /**
   * Human-readable rationale for a strategy's parameters + backtest outcome.
   * @param {object} arg  { strategy, params, stats: {totalPnl, winRate, maxDrawdownPct}, symbol }
   * @returns {Promise<{summary: string}>}
   */
  async strategyExplain(arg) {
    const sys = 'You are explaining a quantitative trading strategy result to an Indian retail trader. Output 4 short bullet lines starting with "- ". No preamble, no JSON.';
    const usr = 'Explain this backtest result simply:\n' + JSON.stringify(arg);
    const { text } = await this._call(sys, usr);
    return { summary: text };
  }

  /**
   * Tier 18: AI-generated monthly P&L review narrative.
   * Input: { month, realizedPnl, trades:[], winRate, topWinners, topLosers, byStrategy }
   * Output: { narrative: '... markdown bullets ...' }
   * Per master spec §4 Stage 4: 'AI-generated monthly review by Claude'.
   */
  async monthlyReview(arg) {
    const sys = 'You are a calm, evidence-based portfolio review writer for an Indian retail trader. Output 6-10 short markdown bullets covering: (1) overall verdict, (2) what worked, (3) what did not work, (4) one behavioural pattern visible in the trade timestamps or hold-times if data permits, (5) one actionable change for next month. Indian rupees only (₹). No advice, no recommendations, no emojis, no preamble.';
    const usr = 'Review this trader\'s month:\n' + JSON.stringify(arg);
    const { text } = await this._call(sys, usr);
    return { narrative: text };
  }
}

module.exports = { ClaudeAI };
