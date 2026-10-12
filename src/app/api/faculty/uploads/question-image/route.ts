import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { created, handleApiError, ApiError } from "@/lib/api-response";
import { getAuthUser, requireRole } from "@/lib/auth";
import {
  detectImageExtension,
  MAX_QUESTION_IMAGE_BYTES,
  QUESTION_IMAGE_DIR,
  QUESTION_IMAGE_URL_PREFIX,
} from "@/lib/question-images";

// Uploads one image for use inside a question/option (the rich-text editor
// inserts the returned `url` as an <img>). Raster images only, max 2 MB.
export async function POST(req: NextRequest) {
  try {
    const user = getAuthUser(req);
    requireRole(user, "faculty", "admin");

    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") throw new ApiError(400, "Upload an image under the 'file' field");
    if (file.size > MAX_QUESTION_IMAGE_BYTES) throw new ApiError(400, "Image is too large - the limit is 2 MB");

    const buffer = Buffer.from(await file.arrayBuffer());
    const extension = detectImageExtension(buffer);
    if (!extension) throw new ApiError(400, "Only PNG, JPG, GIF or WebP images are allowed");

    const name = `${randomUUID()}.${extension}`;
    await mkdir(QUESTION_IMAGE_DIR, { recursive: true });
    await writeFile(path.join(QUESTION_IMAGE_DIR, name), buffer);

    return created({ url: `${QUESTION_IMAGE_URL_PREFIX}${name}` });
  } catch (error) {
    return handleApiError(error);
  }
}
