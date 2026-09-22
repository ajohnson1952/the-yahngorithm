// Shown while a single game's detail data is loading (getGameDetail pulls
// lines, weather, injuries, Kalshi, trends — several queries, uncached).
export default function Loading() {
  return (
    <div className="gpage">
      <div className="skel" style={{ width: 90, height: 14, margin: "18px 0 10px" }} />
      <div className="skel skel-ghero" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="skel skel-row" />
      ))}
    </div>
  );
}
