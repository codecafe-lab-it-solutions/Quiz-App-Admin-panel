export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { autoStopOverdueQuizzes } = await import("@/lib/quiz-auto-stop");
  setInterval(() => {
    autoStopOverdueQuizzes()
      .then((ids) => ids.length && console.log("[auto-stop] stopped quizzes", ids.join(",")))
      .catch((error) => console.error("[auto-stop] sweep failed", error));
  }, 60_000);
}
