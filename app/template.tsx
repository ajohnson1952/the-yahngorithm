// A template (unlike layout) remounts on every route change, so the
// .page-fade animation replays as you move between pages. Opacity only — a
// transform here would make this wrapper a containing block and could upset
// the sticky headers inside it. Disabled under prefers-reduced-motion.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-fade">{children}</div>;
}
