import { prisma } from "@/lib/db";
import { stopLiveQuiz } from "@/lib/quiz-stop";

// Faculty often forget to stop a quiz, so every quiz still live at 7:30 PM
// (India time) is stopped automatically. Cutoff is configurable for tests.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const [CUTOFF_HOUR, CUTOFF_MINUTE] = (process.env.QUIZ_AUTO_STOP_TIME ?? "19:30").split(":").map(Number);

// The most recent 19:30 IST at or before `now`.
export function latestCutoff(now: Date): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  ist.setUTCHours(CUTOFF_HOUR, CUTOFF_MINUTE, 0, 0);
  let cutoff = ist.getTime() - IST_OFFSET_MS;
  if (cutoff > now.getTime()) cutoff -= 24 * 60 * 60 * 1000;
  return new Date(cutoff);
}

// A quiz that went live after the latest cutoff is left alone until the next one.
export async function autoStopOverdueQuizzes(now = new Date()): Promise<number[]> {
  const cutoff = latestCutoff(now);
  const live = await prisma.quiz.findMany({
    where: { status: "live", deletedAt: null },
    select: { id: true, actualStartTime: true, startTime: true },
  });
  const stopped: number[] = [];
  for (const q of live) {
    if ((q.actualStartTime ?? q.startTime) >= cutoff) continue;
    try {
      if (await stopLiveQuiz(q.id, "auto_stopped_730pm")) stopped.push(q.id);
    } catch (error) {
      console.error("[auto-stop] quiz", q.id, "failed", error);
    }
  }
  return stopped;
}
