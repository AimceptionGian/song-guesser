export default function AmbientBackground() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
        background: `
          radial-gradient(ellipse 60% 40% at 30% 20%, rgba(124,58,237,0.12) 0%, transparent 70%),
          radial-gradient(ellipse 50% 35% at 70% 80%, rgba(247,37,133,0.08) 0%, transparent 70%)
        `,
      }}
    />
  );
}