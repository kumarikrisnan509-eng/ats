/* eslint-disable */
/* Lightweight chart primitives: sparkline, area, candles, donut, bar */

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

/* deterministic seeded-ish data generator */
function seriesRandom(seed, n, min = 0, max = 100, trend = 0) {
  let s = seed;
  const rand = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  const out = [];
  let v = (min + max) / 2;
  for (let i = 0; i < n; i++) {
    v += (rand() - 0.5) * (max - min) * 0.08 + trend;
    v = Math.max(min, Math.min(max, v));
    out.push(v);
  }
  return out;
}

/* ===== Sparkline (small) ===== */
const Sparkline = ({ data, width = 120, height = 36, color, fill = true, strokeW = 1.5 }) => {
  const min = Math.min(...data), max = Math.max(...data);
  const rng = max - min || 1;
  const step = width / (data.length - 1);
  const pts = data.map((d, i) => [i * step, height - ((d - min) / rng) * (height - 4) - 2]);
  const path = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const area = path + ` L ${width} ${height} L 0 ${height} Z`;
  const lastUp = data[data.length - 1] >= data[0];
  const c = color || (lastUp ? "var(--up)" : "var(--down)");
  const id = "sg" + Math.random().toString(36).slice(2, 8);
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {fill && (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c} stopOpacity="0.22"/>
              <stop offset="100%" stopColor={c} stopOpacity="0"/>
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${id})`}/>
        </>
      )}
      <path d={path} fill="none" stroke={c} strokeWidth={strokeW} strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
};

/* ===== Area chart with axes ===== */
const AreaChart = ({ data, height = 240, color = "var(--accent)", formatter = (v) => v.toFixed(0), labels = [] }) => {
  const ref = useRef(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(entries => setW(entries[0].contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const pad = { t: 12, r: 12, b: 22, l: 44 };
  const W = w, H = height;
  const min = Math.min(...data), max = Math.max(...data);
  const rng = max - min || 1;
  const n = data.length;
  const step = n > 1 ? (W - pad.l - pad.r) / (n - 1) : 0;
  const yOf = (v) => pad.t + (1 - (v - min) / rng) * (H - pad.t - pad.b);
  const xOf = (i) => pad.l + i * step;
  const pts = data.map((d, i) => [xOf(i), yOf(d)]);
  const path = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const area = path + ` L ${xOf(n - 1)} ${H - pad.b} L ${pad.l} ${H - pad.b} Z`;
  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => min + (rng * i) / ticks);
  const id = "ag" + Math.random().toString(36).slice(2, 8);
  return (
    <div ref={ref} style={{ width: "100%" }}>
      <svg width={W} height={H}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22"/>
            <stop offset="100%" stopColor={color} stopOpacity="0"/>
          </linearGradient>
        </defs>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={yOf(t)} y2={yOf(t)} stroke="var(--border)" strokeDasharray="2 3"/>
            <text className="tick" x={pad.l - 8} y={yOf(t) + 3} textAnchor="end">{formatter(t)}</text>
          </g>
        ))}
        {labels.map((l, i) => (
          <text key={i} className="tick" x={xOf(Math.round(((labels.length > 1 ? i / (labels.length - 1) : 0)) * (n - 1)))} y={H - pad.b + 14} textAnchor="middle">{l}</text>
        ))}
        <path d={area} fill={`url(#${id})`}/>
        <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        {pts.length > 0 && <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="4" fill={color} stroke="var(--surface)" strokeWidth="2"/>}
      </svg>
    </div>
  );
};

/* ===== Candles ===== */
const Candles = ({ data, height = 260 }) => {
  const ref = useRef(null);
  const [w, setW] = useState(700);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(e => setW(e[0].contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const pad = { t: 12, r: 12, b: 22, l: 52 };
  const W = w, H = height;
  const highs = data.map(d => d.h), lows = data.map(d => d.l);
  const min = Math.min(...lows), max = Math.max(...highs);
  const rng = max - min || 1;
  const bw = (W - pad.l - pad.r) / data.length;
  const yOf = (v) => pad.t + (1 - (v - min) / rng) * (H - pad.t - pad.b);
  const ticks = 5;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => min + (rng * i) / ticks);
  return (
    <div ref={ref} style={{ width: "100%" }}>
      <svg width={W} height={H}>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={yOf(t)} y2={yOf(t)} stroke="var(--border)" strokeDasharray="2 3"/>
            <text className="tick" x={pad.l - 8} y={yOf(t) + 3} textAnchor="end">{t.toFixed(1)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const up = d.c >= d.o;
          const color = up ? "var(--up)" : "var(--down)";
          const cx = pad.l + i * bw + bw / 2;
          const bodyTop = yOf(Math.max(d.o, d.c));
          const bodyBot = yOf(Math.min(d.o, d.c));
          return (
            <g key={i}>
              <line x1={cx} x2={cx} y1={yOf(d.h)} y2={yOf(d.l)} stroke={color} strokeWidth="1"/>
              <rect x={cx - bw * 0.32} width={bw * 0.64} y={bodyTop} height={Math.max(1, bodyBot - bodyTop)} fill={color} rx="1"/>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

/* ===== Donut ===== */
const Donut = ({ data, size = 180, thickness = 16, children }) => {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = size / 2;
  const C = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} className="ring">
        <circle cx={c} cy={c} r={r} stroke="var(--bg-sunk)" strokeWidth={thickness} fill="none"/>
        {data.map((d, i) => {
          const len = (d.value / total) * C;
          const dash = `${len} ${C - len}`;
          const off = -acc;
          acc += len;
          return <circle key={i} cx={c} cy={c} r={r} stroke={d.color} strokeWidth={thickness} strokeDasharray={dash} strokeDashoffset={off} fill="none" strokeLinecap="butt"/>;
        })}
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>{children}</div>
    </div>
  );
};

/* ===== Horizontal bar row ===== */
const BarRow = ({ label, value, max, right, color = "var(--accent)", sub }) => (
  <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 90px", alignItems: "center", gap: 12, padding: "6px 0" }}>
    <div style={{ fontSize: 12, color: "var(--text-2)" }}>
      {label}
      {sub && <div style={{ fontSize: 10, color: "var(--text-3)" }}>{sub}</div>}
    </div>
    <div style={{ height: 8, background: "var(--bg-sunk)", borderRadius: 999, overflow: "hidden" }}>
      <div style={{ height: "100%", width: Math.min(100, (value / max) * 100) + "%", background: color, borderRadius: 999 }}/>
    </div>
    <div className="mono" style={{ fontSize: 12, textAlign: "right" }}>{right}</div>
  </div>
);

/* ===== Heatmap (strategy returns grid) ===== */
const Heatmap = ({ rows, cols, values, min, max }) => {
  const rng = (max - min) || 1;
  const colorFor = (v) => {
    if (v == null) return "var(--bg-sunk)";
    const t = (v - min) / rng;
    if (v >= 0) return `oklch(${75 - t * 15}% ${0.05 + t * 0.12} 155)`;
    return `oklch(${75 + (1 - t) * 5}% ${0.05 + (1 - t) * 0.1} 25)`;
  };
  return (
    <div style={{ display: "grid", gridTemplateColumns: `100px repeat(${cols.length}, 1fr)`, gap: 4 }}>
      <div/>
      {cols.map(c => <div key={c} style={{ fontSize: 10, color: "var(--text-3)", textAlign: "center", fontFamily: "var(--mono)" }}>{c}</div>)}
      {rows.map((r, ri) => (
        <React.Fragment key={r}>
          <div style={{ fontSize: 11, color: "var(--text-2)", padding: "6px 0" }}>{r}</div>
          {cols.map((c, ci) => {
            const v = values[ri][ci];
            return (
              <div key={ci} style={{ background: colorFor(v), borderRadius: 4, height: 28, display: "grid", placeItems: "center",
                fontFamily: "var(--mono)", fontSize: 10, color: "var(--text)" }}>
                {v == null ? "" : (v >= 0 ? "+" : "") + v.toFixed(1)}
              </div>
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
};

/* ===== LiveSparkline — scrolls left every tick, pulses on the right edge ===== */
const LiveSparkline = ({ symbol, width = 120, height = 36, samples = 40, color, fill = true, strokeW = 1.5, seed = 0 }) => {
  const [buf, setBuf] = useState(() => {
    // seed buffer with a plausible drift so it renders something on first paint
    const base = 100;
    const arr = [];
    let v = base;
    for (let i = 0; i < samples; i++) {
      v += (Math.sin((seed + i) * 0.31) + (Math.random() - 0.5)) * 0.8;
      arr.push(v);
    }
    return arr;
  });
  useEffect(() => {
    let cancelled = false;
    const handler = (e) => {
      if (cancelled) return;
      if (symbol && e.detail?.symbol !== symbol) return;
      const px = e.detail?.last;
      if (px == null) return;
      setBuf(prev => {
        const next = prev.slice(1);
        next.push(px);
        return next;
      });
    };
    window.addEventListener("tick", handler);
    // also tick on a slow timer so the line keeps shifting even without ticks
    const t = setInterval(() => {
      setBuf(prev => {
        const last = prev[prev.length - 1];
        const drift = (Math.random() - 0.5) * Math.abs(last) * 0.0008;
        const next = prev.slice(1);
        next.push(last + drift);
        return next;
      });
    }, 1200);
    return () => { cancelled = true; window.removeEventListener("tick", handler); clearInterval(t); };
  }, [symbol]);

  const data = buf;
  const min = Math.min(...data), max = Math.max(...data);
  const rng = max - min || 1;
  const step = width / (data.length - 1);
  const pts = data.map((d, i) => [i * step, height - ((d - min) / rng) * (height - 4) - 2]);
  const path = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const area = path + ` L ${width} ${height} L 0 ${height} Z`;
  const lastUp = data[data.length - 1] >= data[0];
  const c = color || (lastUp ? "var(--up)" : "var(--down)");
  const id = "lg" + Math.random().toString(36).slice(2, 8);
  const lastPt = pts[pts.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {fill && (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c} stopOpacity="0.22"/>
              <stop offset="100%" stopColor={c} stopOpacity="0"/>
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${id})`}/>
        </>
      )}
      <path d={path} fill="none" stroke={c} strokeWidth={strokeW} strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx={lastPt[0]} cy={lastPt[1]} r="2.4" fill={c}>
        <animate attributeName="r" values="2.4;4.2;2.4" dur="1.6s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="1;0.35;1" dur="1.6s" repeatCount="indefinite"/>
      </circle>
    </svg>
  );
};

Object.assign(window, { Sparkline, LiveSparkline, AreaChart, Candles, Donut, BarRow, Heatmap, seriesRandom });
