import DOMPurify from "isomorphic-dompurify";

/**
 * Sanitizes rich-text HTML from the question/option/reference-answer editors
 * before it's stored. Runs server-side (via the zod schemas in
 * validators/quiz.ts) so every write path - the dialog, bulk import, a
 * future mobile client - is covered regardless of which UI produced the HTML.
 */
// Equations are stored as a compact `<span data-type="math-inline"
// data-latex="...">` (see math-inline-extension.ts) - never as KaTeX's own
// (much larger, harder-to-safely-allow-list) rendered HTML/MathML/SVG
// output, which is only ever generated transiently client-side for display.
const QUESTION_IMAGE_SRC = /^\/api\/uploads\/question-images\/[0-9a-f-]{36}\.(png|jpg|gif|webp)$/;

export function sanitizeQuestionHtml(html: string): string {
  // DOMPurify always lets `data:` URIs through on <img>, whatever
  // ALLOWED_URI_REGEXP says - so an image's `src` is checked here instead:
  // only an image uploaded through the question-image route may be
  // referenced (no external URLs, no data: URIs), anything else is dropped.
  const dropForeignImageSrc = (node: Element, data: { attrName: string; attrValue: string; keepAttr: boolean }) => {
    if (node.nodeName === "IMG" && data.attrName === "src" && !QUESTION_IMAGE_SRC.test(data.attrValue)) {
      data.keepAttr = false;
    }
  };

  DOMPurify.addHook("uponSanitizeAttribute", dropForeignImageSrc);
  try {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ["p", "br", "strong", "em", "b", "i", "u", "span", "img"],
      ALLOWED_ATTR: ["style", "data-type", "data-latex", "src", "alt"],
    })
      .replace(/<img(?![^>]*\ssrc=)[^>]*>/g, "") // an image whose src was dropped is just a broken box
      .trim();
  } finally {
    DOMPurify.removeHook("uponSanitizeAttribute");
  }
}

/** Strips tags for "is this rich-text field actually empty" checks (e.g. TipTap's empty doc serializes to `<p></p>`, not `""`). Equation nodes count as content even though they carry no visible text. */
export function stripHtml(html: string): string {
  return html
    .replace(/<span[^>]*data-type="math-inline"[^>]*>.*?<\/span>/g, " ∫ ")
    .replace(/<img[^>]*>/g, " [image] ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escapes plain text (e.g. an Excel cell from bulk question import) so it's
 * safe to store/render through the same RichTextDisplay used for the rich-text
 * editor's HTML - the source has no intended formatting, so this renders as
 * literal text rather than being parsed as markup.
 */
export function escapePlainText(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}
