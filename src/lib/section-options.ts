// A course only offers the sections its own quizzes were run for; "all" lists every section.
export function sectionsForCourse<T extends { courseCode: string; name: string }>(sections: T[], courseCode: string): T[] {
  const seen = new Set<string>();
  return sections.filter((s) => {
    if ((courseCode !== "all" && s.courseCode !== courseCode) || seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });
}
