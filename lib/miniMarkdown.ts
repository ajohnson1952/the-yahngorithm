// Tiny Markdown -> HTML renderer. Deliberately minimal — just enough for
// docs/INTERPRETATION_GUIDE.md (headings, tables, lists, blockquotes, fenced
// code, inline code, bold, links, hr). Not a general-purpose parser.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inline(s: string): string {
  let out = escapeHtml(s);
  // inline code first so its contents aren't further processed
  out = out.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, href) => {
    // only allow safe schemes / relative / anchor links (defense in depth —
    // the source is a trusted repo file, but keep javascript: etc. out)
    const ok = /^(https?:\/\/|\/|#|mailto:)/i.test(href.trim());
    return ok ? `<a href="${href.trim()}">${text}</a>` : text;
  });
  return out;
}

function renderTable(rows: string[]): string {
  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());
  const header = cells(rows[0]);
  const body = rows.slice(2).map(cells);
  const th = header.map((c) => `<th>${inline(c)}</th>`).join("");
  const trs = body
    .map(
      (r) =>
        `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`
    )
    .join("");
  return `<div class="table-scroll"><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`;
}

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let i = 0;

  const flushParagraph = (buf: string[]) => {
    if (buf.length) {
      html.push(`<p>${inline(buf.join(" "))}</p>`);
      buf.length = 0;
    }
  };

  let para: string[] = [];

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    if (line.startsWith("```")) {
      flushParagraph(para);
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++; // closing fence
      html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    // heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushParagraph(para);
      const level = h[1].length;
      html.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // hr
    if (/^---+\s*$/.test(line)) {
      flushParagraph(para);
      html.push("<hr />");
      i++;
      continue;
    }

    // table (line with | followed by a separator row)
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:|-]+\|[\s:|-]+$/.test(lines[i + 1])
    ) {
      flushParagraph(para);
      const tbl: string[] = [];
      while (i < lines.length && lines[i].includes("|")) {
        tbl.push(lines[i]);
        i++;
      }
      html.push(renderTable(tbl));
      continue;
    }

    // blockquote
    if (line.startsWith(">")) {
      flushParagraph(para);
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quote.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      html.push(`<blockquote>${inline(quote.join(" "))}</blockquote>`);
      continue;
    }

    // list (unordered or ordered)
    const listMatch = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (listMatch) {
      flushParagraph(para);
      const ordered = /\d+\./.test(listMatch[2]);
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (m) {
          items.push(m[3]);
          i++;
        } else if (/^\s+\S/.test(lines[i]) && items.length) {
          // continuation line
          items[items.length - 1] += " " + lines[i].trim();
          i++;
        } else {
          break;
        }
      }
      const tag = ordered ? "ol" : "ul";
      html.push(
        `<${tag}>${items.map((it) => `<li>${inline(it)}</li>`).join("")}</${tag}>`
      );
      continue;
    }

    // blank line ends a paragraph
    if (line.trim() === "") {
      flushParagraph(para);
      i++;
      continue;
    }

    para.push(line.trim());
    i++;
  }
  flushParagraph(para);

  return html.join("\n");
}
