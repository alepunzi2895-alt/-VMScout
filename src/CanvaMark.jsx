// Marchio Canva riconoscibile (cerchio con gradiente + "C" bianca) al posto
// del vecchio glifo "✦", che a #555 nella navbar era praticamente invisibile.
// SVG inline, nessuna dipendenza, scala nitido a qualsiasi dimensione.
export default function CanvaMark({ size = 18, style = {} }) {
  const gid = "canvaMarkGrad";
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label="Canva"
      style={{ display: "block", flexShrink: 0, ...style }}>
      <defs>
        <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00C4CC" />
          <stop offset="55%" stopColor="#3A7BD5" />
          <stop offset="100%" stopColor="#6420FF" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="20" fill={`url(#${gid})`} />
      <path
        d="M26.5 25.4c-1.7 2-4 3.2-6.7 3.2-4.7 0-8-3.7-8-8.7 0-5.6 3.7-9.6 8.6-9.6 3.4 0 5.7 1.9 5.7 4.3 0 1.5-.9 2.6-2.3 2.6-1.1 0-1.9-.7-1.9-1.8 0-.5.2-1 .2-1.4 0-.9-.7-1.4-1.8-1.4-2.4 0-4.1 2.7-4.1 6.4 0 3.4 1.6 5.6 4.2 5.6 1.7 0 3.2-.9 4.4-2.4.4-.5.8-.7 1.1-.5.4.2.5.8.6 1.4z"
        fill="#fff"
      />
    </svg>
  );
}
