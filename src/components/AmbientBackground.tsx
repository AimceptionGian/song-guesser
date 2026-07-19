/**
 * Immersiver Hintergrund: langsam driftende Farb-Blobs (Lime/Pink/Violett),
 * ein feines Filmkorn und eine dezente Equalizer-Silhouette am unteren Rand.
 * Rein dekorativ — pointer-events sind überall aus.
 */

const GRAIN_SVG =
  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")";

// Deterministische Balkenhöhen für die EQ-Silhouette
const EQ_BARS = Array.from({ length: 48 }, (_, i) => {
  const h = 12 + 46 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.55));
  return Math.round(h);
});

export default function AmbientBackground() {
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
      {/* Farb-Blobs */}
      <div
        style={{
          position: 'absolute',
          width: '55vmax',
          height: '55vmax',
          top: '-18vmax',
          left: '-12vmax',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(139,92,246,0.16) 0%, transparent 65%)',
          animation: 'floatDrift 26s ease-in-out infinite',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: '48vmax',
          height: '48vmax',
          bottom: '-20vmax',
          right: '-14vmax',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,79,163,0.11) 0%, transparent 65%)',
          animation: 'floatDrift 32s ease-in-out infinite reverse',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: '34vmax',
          height: '34vmax',
          top: '46%',
          left: '58%',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(214,245,69,0.06) 0%, transparent 60%)',
          animation: 'floatDrift 38s ease-in-out infinite',
          animationDelay: '-12s',
        }}
      />

      {/* Equalizer-Silhouette unten */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 70,
          display: 'flex',
          alignItems: 'flex-end',
          gap: 3,
          opacity: 0.05,
        }}
      >
        {EQ_BARS.map((h, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: `${h}%`,
              borderRadius: '3px 3px 0 0',
              background: i % 7 === 3 ? 'var(--pink)' : 'var(--lime)',
            }}
          />
        ))}
      </div>

      {/* Filmkorn */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: GRAIN_SVG,
          backgroundSize: 180,
          opacity: 0.05,
          mixBlendMode: 'overlay',
        }}
      />
    </div>
  );
}
