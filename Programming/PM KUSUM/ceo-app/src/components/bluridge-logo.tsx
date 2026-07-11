export function BluRidgeLogo({
  size = 40,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size * 3.4}
      height={size}
      viewBox="0 0 136 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="BluRidge"
    >
      <defs>
        {/* 3D face gradients */}
        <linearGradient id="face-left" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#7c93e8" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#3d52c4" stopOpacity="0.85" />
        </linearGradient>
        <linearGradient id="face-right" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1a2660" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#0d1540" stopOpacity="1" />
        </linearGradient>
        <linearGradient id="face-top" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#c0ccf8" stopOpacity="1" />
          <stop offset="100%" stopColor="#8a9fe8" stopOpacity="0.9" />
        </linearGradient>
        <linearGradient id="ridge-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#4a5fc4" stopOpacity="0.5" />
          <stop offset="50%" stopColor="#8a9fe8" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#2a3890" stopOpacity="0.4" />
        </linearGradient>
        {/* Glow for the peak */}
        <filter id="peak-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* ── 3D MOUNTAIN ─────────────────────────────── */}

      {/* Back mountain (smaller, dimmer — gives depth) */}
      <polygon
        points="20,28 27,10 34,28"
        fill="rgba(80,100,200,0.18)"
        stroke="rgba(120,140,220,0.3)"
        strokeWidth="0.8"
        strokeLinejoin="round"
      />

      {/* LEFT face of front mountain */}
      <polygon
        points="8,32 20,6 20,32"
        fill="url(#face-left)"
      />

      {/* RIGHT face of front mountain */}
      <polygon
        points="20,6 32,32 20,32"
        fill="url(#face-right)"
      />

      {/* Highlight edge — peak spine */}
      <line
        x1="20" y1="6.5" x2="20" y2="32"
        stroke="url(#face-top)"
        strokeWidth="1.6"
        filter="url(#peak-glow)"
      />

      {/* Left silhouette edge */}
      <line x1="8" y1="32" x2="20" y2="6.5"
        stroke="rgba(140,165,240,0.7)" strokeWidth="1.2" strokeLinecap="round" />

      {/* Right silhouette edge */}
      <line x1="20" y1="6.5" x2="32" y2="32"
        stroke="rgba(30,45,120,0.6)" strokeWidth="1.2" strokeLinecap="round" />

      {/* Ridge baseline */}
      <line
        x1="5" y1="32" x2="35" y2="32"
        stroke="url(#ridge-grad)"
        strokeWidth="1.4"
        strokeLinecap="round"
      />

      {/* Small reflection/snow cap at peak */}
      <polygon
        points="19,9 20,6 21,9"
        fill="rgba(220,230,255,0.95)"
      />

      {/* ── DIVIDER ─────────────────────────────────── */}
      <line
        x1="42" y1="10" x2="42" y2="32"
        stroke="rgba(255,255,255,0.1)"
        strokeWidth="0.8"
      />

      {/* ── BLU ─────────────────────────────────────── */}
      <text
        x="49"
        y="21"
        fontFamily="'Inter', 'Segoe UI', system-ui, sans-serif"
        fontSize="12"
        fontWeight="800"
        letterSpacing="0.06em"
        fill="rgba(255,255,255,0.95)"
        dominantBaseline="middle"
      >
        BLU
      </text>

      {/* ── RIDGE ───────────────────────────────────── */}
      <text
        x="49"
        y="31"
        fontFamily="'Inter', 'Segoe UI', system-ui, sans-serif"
        fontSize="8.5"
        fontWeight="400"
        letterSpacing="0.35em"
        fill="rgba(160,175,240,0.7)"
        dominantBaseline="middle"
      >
        RIDGE
      </text>
    </svg>
  );
}
