import path from "path";

// Question images are stored on disk (not as base64 inside question_text,
// which is a 64KB TEXT column and would also bloat every question fetch).
// Point UPLOAD_DIR at a folder OUTSIDE the deployed release directory so
// uploads survive redeploys.
export const QUESTION_IMAGE_DIR = path.join(
  process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads"),
  "question-images",
);

export const QUESTION_IMAGE_URL_PREFIX = "/api/uploads/question-images/";
export const MAX_QUESTION_IMAGE_BYTES = 2 * 1024 * 1024;

export const QUESTION_IMAGE_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp)$/;

export const IMAGE_CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

// The declared MIME type / filename come from the client and can't be
// trusted - the extension is decided from the file's own magic bytes, and
// anything that isn't a real raster image (SVG, HTML, ...) is rejected.
export function detectImageExtension(buf: Buffer): "png" | "jpg" | "gif" | "webp" | null {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length >= 8 && buf.subarray(0, 8).equals(pngSignature)) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  const head6 = buf.subarray(0, 6).toString("ascii");
  if (buf.length >= 6 && (head6 === "GIF87a" || head6 === "GIF89a")) return "gif";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") {
    return "webp";
  }
  return null;
}
