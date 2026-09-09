// Bandierine SVG inline: le flag-emoji (🇮🇹…) non si vedono su Windows
// (mostra le lettere regionali). Questi SVG si vedono ovunque.
const FLAGS = {
  it: (
    <>
      <rect width="8" height="16" x="0" fill="#009246" />
      <rect width="8" height="16" x="8" fill="#fff" />
      <rect width="8" height="16" x="16" fill="#CE2B37" />
    </>
  ),
  fr: (
    <>
      <rect width="8" height="16" x="0" fill="#0055A4" />
      <rect width="8" height="16" x="8" fill="#fff" />
      <rect width="8" height="16" x="16" fill="#EF4135" />
    </>
  ),
  es: (
    <>
      <rect width="24" height="16" fill="#AA151B" />
      <rect width="24" height="8" y="4" fill="#F1BF00" />
    </>
  ),
  de: (
    <>
      <rect width="24" height="16" fill="#000" />
      <rect width="24" height="11" y="5" fill="#DD0000" />
      <rect width="24" height="5" y="11" fill="#FFCE00" />
    </>
  ),
  en: (
    <>
      <rect width="24" height="16" fill="#012169" />
      <path d="M0 0 L24 16 M24 0 L0 16" stroke="#fff" strokeWidth="3.2" />
      <path d="M0 0 L24 16 M24 0 L0 16" stroke="#C8102E" strokeWidth="1.8" />
      <path d="M12 0 V16 M0 8 H24" stroke="#fff" strokeWidth="5.4" />
      <path d="M12 0 V16 M0 8 H24" stroke="#C8102E" strokeWidth="3.2" />
    </>
  ),
};

export default function Flag({ code, size = 18 }) {
  const f = FLAGS[code] || FLAGS.en;
  return (
    <svg width={size} height={size * (2 / 3)} viewBox="0 0 24 16"
      style={{ display: "block", borderRadius: 2, boxShadow: "0 0 0 1px rgba(255,255,255,0.14)" }}
      preserveAspectRatio="none" aria-label={code}>
      {f}
    </svg>
  );
}
