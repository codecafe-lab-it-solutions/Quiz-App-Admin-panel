import { NextRequest } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { IMAGE_CONTENT_TYPES, QUESTION_IMAGE_DIR, QUESTION_IMAGE_NAME_PATTERN } from "@/lib/question-images";

// Serves an uploaded question image. Deliberately not behind the session
// middleware: the mobile app renders question HTML where an <img> can't
// carry a Bearer header. File names are random UUIDs (unguessable) and only
// files this app itself wrote - validated against a strict pattern - are
// ever read, so there's no path traversal.
export async function GET(_req: NextRequest, { params }: { params: { name: string } }) {
  if (!QUESTION_IMAGE_NAME_PATTERN.test(params.name)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const data = await readFile(path.join(QUESTION_IMAGE_DIR, params.name));
    const extension = params.name.split(".").pop() as string;
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": IMAGE_CONTENT_TYPES[extension],
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
