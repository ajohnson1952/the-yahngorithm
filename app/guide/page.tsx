import { readFile } from "fs/promises";
import path from "path";
import { renderMarkdown } from "../../lib/miniMarkdown";

export const dynamic = "force-static";

export const metadata = {
  title: "Interpretation guide · the yahngorithm",
};

export default async function GuidePage() {
  const raw = await readFile(
    path.join(process.cwd(), "docs", "INTERPRETATION_GUIDE.md"),
    "utf8"
  );
  // the page already has its own <h1> + intro; drop the file's leading title
  const md = raw.replace(/^#\s+.*\n+/, "");
  const html = renderMarkdown(md);

  return (
    <>
      <h1>Interpretation guide</h1>
      <p className="subhead">The cheat sheet — what every number on this site means and how much to trust it.</p>
      <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />
      <p className="foot">
        Source: <code>docs/INTERPRETATION_GUIDE.md</code>. Decision support, not
        a guarantee.
      </p>
    </>
  );
}
