import { Node, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    questionImage: {
      setQuestionImage: (src: string) => ReturnType;
    };
  }
}

/**
 * Inline image node for question/option text. Serializes to a plain
 * `<img src="/api/uploads/question-images/<uuid>.<ext>">` - the sanitizer
 * (sanitizeQuestionHtml) only lets through that exact URL shape, so an image
 * can only ever reference a file uploaded through the question-image route.
 */
export const QuestionImage = Node.create({
  name: "questionImage",
  group: "inline",
  inline: true,
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "img[src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["img", mergeAttributes({ class: "my-1 inline-block max-h-64 max-w-full" }, HTMLAttributes)];
  },

  addCommands() {
    return {
      setQuestionImage:
        (src: string) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { src } }),
    };
  },
});
