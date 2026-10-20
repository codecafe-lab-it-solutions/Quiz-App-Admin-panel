import katex from "katex";

// Question/option HTML stores an equation as an EMPTY `<span data-type="math-inline"
// data-latex="...">` (see sanitize-html.ts) - the web app fills it in with KaTeX
// in the browser (RichTextDisplay). A client that only renders the HTML it is
// given - the students' mobile app - therefore shows nothing (or a blank gap)
// where an integral/derivative/fraction should be. This fills the span with
// MathML so the HTML is self-contained: MathML needs no KaTeX stylesheet or
// fonts and is rendered natively by Android/iOS web views. `data-latex` is left
// in place so a client that does its own KaTeX pass keeps working.
const MATH_SPAN = /<span\b([^>]*\bdata-type="math-inline"[^>]*)>[\s\S]*?<\/span>/g;
const LATEX_ATTR = /\bdata-latex="([^"]*)"/;

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
const decodeEntities = (s: string) => s.replace(/&(?:amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m]);

// Uploaded question images are stored as a relative src
// ("/api/uploads/question-images/<uuid>.png"). The web app resolves that against
// its own origin; the mobile app has none, so the image would not load. Passing
// the request origin makes the src absolute.
export function requestOrigin(req: { headers: Headers; nextUrl: { origin: string } }): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return req.nextUrl.origin;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0] ?? req.nextUrl.origin.split(":")[0];
  return `${proto}://${host.split(",")[0].trim()}`;
}

const RELATIVE_IMG_SRC = /(<img\b[^>]*\ssrc=")(\/api\/uploads\/question-images\/)/g;

export function renderMathInHtml(html: string, origin?: string): string {
  if (!html) return html;
  if (origin) html = html.replace(RELATIVE_IMG_SRC, `$1${origin}$2`);
  if (!html.includes("math-inline")) return html;
  return html.replace(MATH_SPAN, (whole, attrs: string) => {
    const match = LATEX_ATTR.exec(attrs);
    if (!match) return whole;
    const latex = decodeEntities(match[1]);
    try {
      const mathml = katex.renderToString(latex || "\\ ", {
        output: "mathml",
        throwOnError: false,
        macros: { "\\placeholder": "\\square" },
      });
      return `<span${attrs}>${mathml}</span>`;
    } catch {
      return whole;
    }
  });
}
