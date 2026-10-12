"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import { toast } from "sonner";
import { MathInline } from "@/components/quiz/math-inline-extension";
import { QuestionImage } from "@/components/quiz/question-image-extension";
import { apiClient, ApiClientError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  Bold,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Undo2,
  Redo2,
  Sigma,
  Code2,
  ImagePlus,
} from "lucide-react";

// MathLive touches `document`/`customElements` at import time, so it's loaded
// client-only. ssr:false is required here (a bare dynamic import inside
// useEffect isn't enough for the *component* itself, since MathFieldInput's
// own module graph must never be evaluated during the server render pass).
const MathFieldInput = dynamic(
  () => import("@/components/quiz/math-field-input").then((m) => m.MathFieldInput),
  { ssr: false, loading: () => <div className="h-12 animate-pulse rounded-md border bg-muted/30" /> }
);

// Any element mathlive renders outside this component's own DOM - its virtual
// on-screen keyboard AND its symbol/context menu (the "Insert" panel with
// derivatives, matrices, etc.) are both portaled straight to document.body,
// wrapped in an unstyled `[role="presentation"]` scrim - clicks there must
// not count as "outside" the equation Popover/Dialog they were opened from,
// or Radix closes the popover before mathlive can register the click as a
// menu selection (symbol never gets inserted, Insert button stays disabled).
export function isMathliveElement(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return !!target.closest(
    '.ML__keyboard, [id^="mathlive-"], math-field, .ui-menu-container, [role="menu"], [role="menuitem"], [role="presentation"]'
  );
}

function ToolbarButton({
  onClick,
  icon: Icon,
  label,
  active,
  disabled,
}: {
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded hover:bg-accent disabled:pointer-events-none disabled:opacity-40",
        active && "bg-accent text-accent-foreground"
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: string;
  // Shows the "insert image" toolbar button (uploads via the question-image route).
  allowImages?: boolean;
}

// Rich text editor for question/option/reference-answer fields - Bold/Italic,
// alignment, LaTeX equation insertion (rendered with KaTeX), and a raw-HTML
// source view, matching the legacy panel's question editor.
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeight = "110px",
  allowImages = false,
}: RichTextEditorProps) {
  const [uploading, setUploading] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceHtml, setSourceHtml] = useState(value);
  const [equationOpen, setEquationOpen] = useState(false);
  const [equationLatex, setEquationLatex] = useState("");

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: false }),
      TextAlign.configure({ types: ["paragraph"] }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
      MathInline,
      QuestionImage,
    ],
    content: value,
    editorProps: {
      attributes: {
        class: "max-w-none text-sm leading-relaxed focus:outline-none [&_p]:my-1 [&_strong]:font-semibold [&_em]:italic",
      },
    },
    onUpdate: ({ editor }: { editor: Editor }) => onChange(editor.getHTML()),
  });

  useEffect(() => {
    if (editor && !editor.isFocused && value !== editor.getHTML()) {
      editor.commands.setContent(value || "");
    }
  }, [value, editor]);

  if (!editor) {
    return <div className="rounded-md border bg-muted/20" style={{ minHeight }} />;
  }

  const insertEquation = () => {
    if (!equationLatex.trim()) return;
    if (/\\placeholder\s*\{/.test(equationLatex)) {
      toast.error("Fill in every blank in the equation (the small boxes) before inserting it.");
      return;
    }
    // Inserted as an atomic mathInline node - renders live via KaTeX right
    // here in the editor (its NodeView), and serializes to a compact
    // `<span data-type="math-inline" data-latex="...">` (no rendered markup
    // in the saved HTML - RichTextDisplay re-renders it wherever the
    // question is shown, see math-inline-extension.ts).
    editor.chain().focus().insertMath(equationLatex).insertContent(" ").run();
    setEquationLatex("");
    setEquationOpen(false);
  };

  const handleImageSelected = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Image is too large - the limit is 2 MB");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const { url } = await apiClient.post<{ url: string }>("/api/faculty/uploads/question-image", formData);
      editor.chain().focus().setQuestionImage(url).run();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Image upload failed");
    } finally {
      setUploading(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  };

  const closeEquationPopover = (open: boolean) => {
    setEquationOpen(open);
    if (!open) setEquationLatex("");
  };

  const toggleSource = () => {
    if (sourceMode) {
      editor.commands.setContent(sourceHtml || "");
      onChange(sourceHtml);
    } else {
      setSourceHtml(editor.getHTML());
    }
    setSourceMode((v) => !v);
  };

  return (
    <div className="rounded-md border">
      <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 p-1">
        <ToolbarButton onClick={() => editor.chain().focus().undo().run()} icon={Undo2} label="Undo" disabled={sourceMode} />
        <ToolbarButton onClick={() => editor.chain().focus().redo().run()} icon={Redo2} label="Redo" disabled={sourceMode} />
        <div className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          icon={Bold}
          label="Bold"
          active={editor.isActive("bold")}
          disabled={sourceMode}
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          icon={Italic}
          label="Italic"
          active={editor.isActive("italic")}
          disabled={sourceMode}
        />
        <div className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
          icon={AlignLeft}
          label="Align left"
          active={editor.isActive({ textAlign: "left" })}
          disabled={sourceMode}
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
          icon={AlignCenter}
          label="Align center"
          active={editor.isActive({ textAlign: "center" })}
          disabled={sourceMode}
        />
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
          icon={AlignRight}
          label="Align right"
          active={editor.isActive({ textAlign: "right" })}
          disabled={sourceMode}
        />
        <div className="mx-1 h-5 w-px bg-border" />
        <Popover open={equationOpen} onOpenChange={closeEquationPopover}>
          <PopoverTrigger asChild>
            <span>
              <ToolbarButton onClick={() => setEquationOpen(true)} icon={Sigma} label="Equation" disabled={sourceMode} />
            </span>
          </PopoverTrigger>
          <PopoverContent
            className="w-[26rem] space-y-2"
            onPointerDownOutside={(e) => {
              if (isMathliveElement(e.target)) e.preventDefault();
            }}
            onInteractOutside={(e) => {
              if (isMathliveElement(e.target)) e.preventDefault();
            }}
          >
            <p className="text-xs font-medium text-muted-foreground">
              Insert an equation - type naturally (e.g. &quot;int&quot;, &quot;alpha&quot;, &quot;sqrt&quot;) or click the
              keyboard icon for symbols, fractions, integrals, Greek letters and more.
            </p>
            <MathFieldInput value={equationLatex} onChange={setEquationLatex} />
            {/\\placeholder\s*\{/.test(equationLatex) && (
              <p className="text-xs text-warning-foreground">
                Fill in the blanks (the small boxes) in the template before inserting.
              </p>
            )}
            <Button
              type="button"
              size="sm"
              onClick={insertEquation}
              disabled={!equationLatex.trim() || /\\placeholder\s*\{/.test(equationLatex)}
            >
              Insert
            </Button>
          </PopoverContent>
        </Popover>
        {allowImages && (
          <>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleImageSelected(file);
              }}
            />
            <ToolbarButton
              onClick={() => imageInputRef.current?.click()}
              icon={ImagePlus}
              label={uploading ? "Uploading image..." : "Insert image"}
              disabled={sourceMode || uploading}
            />
          </>
        )}
        <div className="ml-auto">
          <ToolbarButton onClick={toggleSource} icon={Code2} label="HTML source" active={sourceMode} />
        </div>
      </div>

      {sourceMode ? (
        <textarea
          className="w-full resize-y bg-background p-3 font-mono text-xs focus:outline-none"
          style={{ minHeight }}
          value={sourceHtml}
          onChange={(e) => setSourceHtml(e.target.value)}
        />
      ) : (
        <div className="cursor-text p-3" style={{ minHeight }} onClick={() => editor.commands.focus()}>
          <EditorContent editor={editor} />
        </div>
      )}
    </div>
  );
}
