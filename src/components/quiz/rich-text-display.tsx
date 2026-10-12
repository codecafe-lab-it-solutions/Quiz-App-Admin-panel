"use client";

import { useEffect, useRef } from "react";
import { renderKatexSafely } from "@/lib/katex-render";
import { cn } from "@/lib/utils";

interface RichTextDisplayProps {
  html: string;
  className?: string;
}

// Renders saved question/option/reference-answer HTML read-only, rendering
// any `<span data-type="math-inline" data-latex="...">` equations with KaTeX
// in place (see math-inline-extension.ts - the saved HTML never contains
// pre-rendered KaTeX markup, only the compact source span). `html` is
// expected to already be sanitized server-side before storage.
export function RichTextDisplay({ html, className }: RichTextDisplayProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const mathSpans = ref.current.querySelectorAll<HTMLElement>('span[data-type="math-inline"]');
    mathSpans.forEach((span) => {
      const latex = span.getAttribute("data-latex") ?? "";
      span.innerHTML = renderKatexSafely(latex);
    });
  }, [html]);

  return <div ref={ref} className={cn("text-sm [&_p]:my-1 [&_img]:inline-block [&_img]:h-auto [&_img]:max-h-64 [&_img]:max-w-full", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
