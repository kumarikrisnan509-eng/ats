/* eslint-disable */
/* News & Sentiment — multi-source feed scored by LLM, drives sentiment overlay on signals.
   Sources: NewsAPI, RSS (Mint, ET, MoneyControl), official: NSE/BSE corp announcements,
   Reuters India, Bloomberg Quint, social: StockTwits/Twitter (rate-limited). */

const NewsScreen = () => {
  // ---- live /api/news ----
  const [liveNews, setLiveNews] = React.useState(null);
  React.useEffect(() => {
    if (window.MockData && window.MockData.isDemoOn && window.MockData.isDemoOn()) return;
    let cancelled = false;
    (async () => {
      try {
        const d = await window.fetchApi('/api/news?limit=15');
        if (!cancelled && d && d.ok) setLiveNews(d);
      } catch (e) {}
    })();
    return () => { cancelled = true; };
  }, []);
  const [filter, setFilter] = React.useState("all");
  const [selectedSym, setSelectedSym] = React.useState(null);

  const __mock_items = [
    { sym: "INFY",       hl: "Infosys raises FY27 revenue guidance to 6-8% on AI deal momentum", src: "Mint",         when: "12m ago", senti: 0.78,  impact: "high",   summary: "Management cited 14 large AI deals signed in Q4. Operating margin guidance unchanged at 22%. Brokerages likely to upgrade." },
    { sym: "RELIANCE",   hl: "Reliance Jio crosses 500M subscribers, ARPU up 4.2% QoQ",            src: "ET",            when: "28m ago", senti: 0.62,  impact: "medium", summary: "Subscriber growth driven by 5G migrations. Tariff hike rumored for July." },
    { sym: "HDFCBANK",   hl: "RBI flags concerns on HDFC Bank's unsecured loan portfolio",         src: "Reuters",       when: "1h ago",  senti: -0.54, impact: "high",   summary: "Unsecured book grew 18% YoY vs banking sector 11%. RBI letter not formal action, but watch space." },
    { sym: "TCS",        hl: "TCS bags ₹4,200 cr digital transformation deal from German automaker", src: "BloombergQuint",when: "2h ago",  senti: 0.71, impact: "medium", summary: "5-year contract starting Q1 FY27. Adds ~0.8% to FY27 revenue." },
    { sym: "TATAMOTORS", hl: "JLR Q4 wholesales drop 12% on chip shortage",                         src: "MoneyControl",  when: "3h ago",  senti: -0.68, impact: "high",   summary: "Chip shortage worse than guidance. India CV sales remain strong but JLR is 65% of profit pool." },
    { sym: "MARKET",     hl: "FII inflows ₹4,820 cr — largest single-day in 6 weeks",              src: "NSE official",  when: "3h ago",  senti: 0.58,  impact: "medium", summary: "Bond inflows ₹2,100 cr, equity ₹2,720 cr. Rupee likely to strengthen." },
    { sym: "ICICIBANK",  hl: "ICICI Bank Q4 NII grows 11% YoY beats estimates by 3%",              src: "ET",            when: "4h ago",  senti: 0.81,  impact: "medium", summary: "NIM at 4.42% vs 4.35% expected. Slippages contained at 0.39%. Strong setup." },
    { sym: "BANKNIFTY",  hl: "PSU bank index hits 52-week high, valuation gap with private narrows", src: "Mint",        when: "5h ago",  senti: 0.42,  impact: "low",    summary: "PSB index up 1.8%. SBI, BoB leading. Rotation play, not fundamental." },
    { sym: "GOLD",       hl: "Gold rally pauses as Fed rate-cut bets fade after strong jobs print", src: "Reuters",      when: "6h ago",  senti: -0.32, impact: "low",    summary: "Spot gold -0.4%. MCX likely to follow. Tactical pullback not trend reversal." },
    { sym: "NIFTY",      hl: "Q4 earnings season: 78% of NIFTY-50 beat estimates so far",          src: "BloombergQuint",when: "8h ago",  senti: 0.65,  impact: "medium", summary: "IT in line, Banks beat, Auto mixed (JLR drag), FMCG soft. Margin expansion theme intact." },
  ];
  const items = (liveNews && Array.isArray(liveNews.items) && liveNews.items.length > 0)
    ? liveNews.items.slice(0, 12).map((n, i) => ({
        id: n.id || i,
        time: n.pubDate ? new Date(n.pubDate).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '',
        source: n.source || 'RSS',
        title: n.title,
        summary: n.summary,
        symbols: n.symbols || [],
        link: n.link,
        live: true,
      }))
    : __mock_items;


  const filtered = filter === "all" ? items :
    filter === "positive" ? items.filter(i => i.senti > 0.3) :
    filter === "negative" ? items.filter(i => i.senti < -0.3) :
    filter === "high" ? items.filter(i => i.impact === "high") :
    items;

  const symbolImpact = {
    "HDFCBANK":  { senti: -0.54, items: 1, recent: "1h ago",  signalImpact: "Confidence reduced 82 → 71" },
    "INFY":      { senti: 0.78,  items: 1, recent: "12m ago", signalImpact: "Confidence boosted 75 → 88" },
    "TCS":       { senti: 0.71,  items: 1, recent: "2h ago",  signalImpact: "Confidence boosted 68 → 76" },
    "RELIANCE":  { senti: 0.62,  items: 1, recent: "28m ago", signalImpact: "Confidence boosted 70 → 81" },
    "TATAMOTORS":{ senti: -0.68, items: 1, recent: "3h ago",  signalImpact: "Signal blocked (bearish news + long signal)" },
    "ICICIBANK": { senti: 0.81,  items: 1, recent: "4h ago",  signalImpact: "Confidence boosted 72 → 84" },
  };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>
            News & sentiment feed
          </div>
          <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 4, maxWidth: 720 }}>
            Multi-source news scored by Claude on a -1 to +1 sentiment scale and weighted into signal confidence. High-impact stories can block signals or trigger position exits.
          </div>
        </div>
        <button className="btn btn-ghost"><I.refresh size={14}/> Refresh</button>
      </div>

      {/* Stats */}
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Items today"      value="142"  sub="across 11 sources"/>
        <Stat label="High-impact"      value="8"    sub="auto-flagged"/>
        <Stat label="Signal adjustments" value="24" sub="conf ± from sentiment"/>
        <Stat label="Avg sentiment"    value="+0.31" sub="market-wide bullish lean"/>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
        {/* News feed */}
        <div>
          <Card title="News stream" sub="Sorted by recency · sentiment scored by Claude Haiku 4.6">
            <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
              {[
                { v: "all",      l: "All", c: items.length },
                { v: "positive", l: "Bullish", c: items.filter(i => i.senti > 0.3).length },
                { v: "negative", l: "Bearish", c: items.filter(i => i.senti < -0.3).length },
                { v: "high",     l: "High impact", c: items.filter(i => i.impact === "high").length },
              ].map(o => (
                <button key={o.v} onClick={() => setFilter(o.v)} className={filter === o.v ? "btn btn-primary" : "btn btn-ghost"}
                  style={{ fontSize: 11, padding: "4px 10px" }}>
                  {o.l} <span style={{ opacity: 0.7 }}>· {o.c}</span>
                </button>
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {filtered.map((it, i) => {
                const senti = it.senti;
                const sentColor = senti > 0.3 ? "var(--up)" : senti < -0.3 ? "var(--down)" : "var(--text-3)";
                const sentBg = senti > 0.3 ? "var(--up-soft)" : senti < -0.3 ? "var(--down-soft)" : "var(--bg-soft)";
                return (
                  <div key={i} style={{
                    padding: "12px 0", borderTop: i ? "1px solid var(--border)" : "none",
                    display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 12, alignItems: "flex-start",
                  }}>
                    {/* Sentiment dial */}
                    <div style={{
                      width: 56, padding: "6px 4px", borderRadius: "var(--r-sm)",
                      background: sentBg, color: sentColor, textAlign: "center",
                    }}>
                      <div className="mono" style={{ fontSize: 14, fontWeight: 700 }}>
                        {senti > 0 ? "+" : ""}{senti.toFixed(2)}
                      </div>
                      <div style={{ fontSize: 9, marginTop: 2, textTransform: "uppercase", letterSpacing: 0.5 }}>
                        {senti > 0.5 ? "v.bull" : senti > 0.3 ? "bull" : senti > -0.3 ? "neut" : senti > -0.5 ? "bear" : "v.bear"}
                      </div>
                    </div>
                    {/* Headline + summary */}
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                        <Chip variant="info" style={{ fontFamily: "var(--mono)", fontSize: 10 }}>{it.sym}</Chip>
                        {it.impact === "high" && <Chip variant="warn">HIGH IMPACT</Chip>}
                        <span style={{ fontSize: 10, color: "var(--text-3)" }}>{it.src} · {it.when}</span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>{it.hl}</div>
                      <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4, lineHeight: 1.5 }}>{it.summary}</div>
                    </div>
                    {/* Action */}
                    <button className="btn btn-ghost" style={{ fontSize: 10, padding: "4px 8px" }}
                      onClick={() => setSelectedSym(it.sym)}>
                      View →
                    </button>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        {/* Sentiment summary side */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Aggregate symbol sentiment */}
          <Card title="Symbols with active sentiment" sub="How news is moving signal confidence">
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {Object.entries(symbolImpact).map(([sym, d], i) => (
                <div key={sym} style={{
                  padding: "10px 0", borderTop: i ? "1px solid var(--border)" : "none",
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Chip variant="info" style={{ fontFamily: "var(--mono)", fontSize: 10 }}>{sym}</Chip>
                      <span style={{ fontSize: 10, color: "var(--text-3)" }}>{d.recent}</span>
                    </div>
                    <span className="mono" style={{
                      fontSize: 12, fontWeight: 700,
                      color: d.senti > 0 ? "var(--up)" : "var(--down)",
                    }}>
                      {d.senti > 0 ? "+" : ""}{d.senti.toFixed(2)}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-2)" }}>{d.signalImpact}</div>
                  {/* sentiment bar */}
                  <div style={{ height: 4, background: "var(--border)", borderRadius: 2, marginTop: 6, overflow: "hidden", position: "relative" }}>
                    <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "var(--text-3)" }}/>
                    <div style={{
                      position: "absolute",
                      left: d.senti > 0 ? "50%" : `${50 + d.senti * 50}%`,
                      width: `${Math.abs(d.senti) * 50}%`, top: 0, bottom: 0,
                      background: d.senti > 0 ? "var(--up)" : "var(--down)",
                    }}/>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Sources */}
          <Card title="Active sources" sub="Health & ingestion rate">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { src: "Mint",         items: 28, rate: "ok", lag: "2m" },
                { src: "Economic Times", items: 34, rate: "ok", lag: "1m" },
                { src: "Reuters India",  items: 18, rate: "ok", lag: "3m" },
                { src: "BloombergQuint",items: 22, rate: "ok", lag: "4m" },
                { src: "MoneyControl",  items: 24, rate: "ok", lag: "2m" },
                { src: "NSE corp announcements", items: 12, rate: "ok", lag: "<1m" },
                { src: "BSE corp announcements", items: 4,  rate: "ok", lag: "<1m" },
                { src: "StockTwits (rate-limited)", items: 0, rate: "throttled", lag: "—" },
              ].map((s, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{
                      width: 6, height: 6, borderRadius: "50%",
                      background: s.rate === "ok" ? "var(--up)" : "var(--warn)",
                    }}/>
                    <span style={{ color: "var(--text)" }}>{s.src}</span>
                  </div>
                  <span style={{ color: "var(--text-3)" }}>{s.items} items · {s.lag}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* Methodology */}
          <Card title="How sentiment scoring works">
            <ol style={{ fontSize: 11, color: "var(--text-2)", lineHeight: 1.7, paddingLeft: 18, margin: 0 }}>
              <li><strong>Ingest</strong> headline + body from RSS / API every 60s</li>
              <li><strong>Dedupe</strong> by SHA-256 of normalized headline (stops cross-source duplicates)</li>
              <li><strong>Score</strong> with Claude Haiku 4.6: <code style={{ fontSize: 10 }}>sentiment ∈ [-1, +1]</code> + <code style={{ fontSize: 10 }}>impact ∈ {`{`}low, med, high{`}`}</code></li>
              <li><strong>Tag</strong> symbols mentioned (NER + ticker dictionary)</li>
              <li><strong>Apply</strong> to live signals: <code style={{ fontSize: 10 }}>conf' = conf × (1 + 0.2 × senti)</code></li>
              <li><strong>Block</strong> signals where direction conflicts with senti × impact &gt; 0.5</li>
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
};

window.NewsScreen = NewsScreen;
