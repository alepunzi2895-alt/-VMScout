// src/AnalyticsCharts.jsx — grafici leggeri in SVG puro (nessuna libreria di
// charting: coerente con la regola "niente dipendenze senza motivo concreto").
// Palette categorica per il grafico formato validata per superficie scura
// (#141414) con scripts/validate_palette.js della skill dataviz: passa
// lightness band, chroma floor, separazione CVD e contrasto ≥3:1.
export const FORMAT_COLORS = {
  IMAGE: "#3987e5",
  VIDEO: "#d95926",
  CAROUSEL_ALBUM: "#199e70",
};

const GOLD   = "#C9A96E";
const INK    = "#F8F4EE";
const MUTED  = "#8A8070";
const GRID   = "#2a2a2a";
const SURF   = "#141414";

function niceMaxOf(values, step = 5) {
  const max = Math.max(...values, 0.01);
  return Math.ceil(max / step) * step || step;
}

// ── Line chart: andamento engagement nel tempo ──────────────────────────────
export function EngagementTrendChart({ data }) {
  if (!data?.length) return null;
  const W = 600, H = 180, PAD_L = 34, PAD_R = 14, PAD_T = 16, PAD_B = 24;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const niceMax = niceMaxOf(data.map(d => d.value));
  const x = i => PAD_L + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = v => PAD_T + plotH - (v / niceMax) * plotH;
  const ticks = [0, niceMax / 2, niceMax];

  const linePath = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const baseY = (PAD_T + plotH).toFixed(1);
  const areaPath = `${linePath} L${x(data.length - 1).toFixed(1)},${baseY} L${x(0).toFixed(1)},${baseY} Z`;
  const last = data[data.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H, display: "block" }}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth="1" />
          <text x={PAD_L - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill={MUTED} fontFamily="'JetBrains Mono', monospace">{t.toFixed(0)}%</text>
        </g>
      ))}
      <path d={areaPath} fill={GOLD} opacity="0.1" />
      <path d={linePath} fill="none" stroke={GOLD} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => (
        <circle key={i} cx={x(i)} cy={y(d.value)} r="4" fill={GOLD} stroke={SURF} strokeWidth="2">
          <title>{`${d.label}: ${d.value.toFixed(1)}% engagement`}</title>
        </circle>
      ))}
      <text x={x(data.length - 1)} y={Math.max(y(last.value) - 10, 10)} textAnchor="end" fontSize="11" fontWeight="700" fill={GOLD} fontFamily="'Montserrat', sans-serif">
        {last.value.toFixed(1)}%
      </text>
      <text x={x(0)} y={H - 4} textAnchor="start" fontSize="9" fill={MUTED} fontFamily="'JetBrains Mono', monospace">{data[0].label}</text>
      <text x={x(data.length - 1)} y={H - 4} textAnchor="end" fontSize="9" fill={MUTED} fontFamily="'JetBrains Mono', monospace">{last.label}</text>
    </svg>
  );
}

// ── Bar chart generico: usato per formato e per giorno della settimana ─────
export function MiniBarChart({ data, highlightBest = false }) {
  if (!data?.length) return null;
  const W = 600, H = 180, PAD_L = 34, PAD_R = 14, PAD_T = 26, PAD_B = 24;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const niceMax = niceMaxOf(data.map(d => d.value));
  const bandW = plotW / data.length;
  const barW = Math.min(44, bandW * 0.55);
  const y = v => PAD_T + plotH - (v / niceMax) * plotH;
  const baseY = PAD_T + plotH;
  const bestIdx = highlightBest ? data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0) : -1;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H, display: "block" }}>
      <line x1={PAD_L} x2={W - PAD_R} y1={baseY} y2={baseY} stroke={GRID} strokeWidth="1" />
      {data.map((d, i) => {
        const cx = PAD_L + bandW * i + bandW / 2;
        const barH = Math.max((d.value / niceMax) * plotH, d.value > 0 ? 2 : 0);
        const barY = baseY - barH;
        const color = d.color || (i === bestIdx ? GOLD : `${GOLD}80`);
        return (
          <g key={i}>
            <rect x={(cx - barW / 2).toFixed(1)} y={barY.toFixed(1)} width={barW.toFixed(1)} height={barH.toFixed(1)} rx="4" fill={color}>
              <title>{`${d.label}: ${d.value.toFixed(1)}% engagement medio${d.count != null ? ` (${d.count} post)` : ""}`}</title>
            </rect>
            {d.value > 0 && (
              <text x={cx} y={barY - 6} textAnchor="middle" fontSize="10" fontWeight="700" fill={INK} fontFamily="'Montserrat', sans-serif">
                {d.value.toFixed(1)}%
              </text>
            )}
            <text x={cx} y={baseY + 15} textAnchor="middle" fontSize="9" fill={i === bestIdx ? GOLD : MUTED} fontWeight={i === bestIdx ? 700 : 400} fontFamily="'JetBrains Mono', monospace">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
