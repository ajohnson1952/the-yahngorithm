// Shown while the board's server data (getWeekBoard etc.) is loading — a
// weekly page load or a week-switch, not a full navigation every time
// (unstable_cache keeps most visits instant; this covers the cache-miss case).
export default function Loading() {
  return (
    <>
      <div className="skel-weeknav">
        <div className="skel" />
      </div>
      <div className="skel skel-search" />
      <div className="skel skel-section" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="skel-card" />
      ))}
    </>
  );
}
