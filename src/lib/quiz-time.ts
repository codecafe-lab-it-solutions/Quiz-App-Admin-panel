// Helpers for the quiz Start/End/Duration fields. All values are the
// "YYYY-MM-DDTHH:mm" strings a <input type="datetime-local"> uses (local time).

// How long after the start the end time is pre-filled with, and so what the
// duration auto-fills to, until the faculty member edits either field.
export const DEFAULT_WINDOW_MINUTES = 5;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function toLocalInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Returns `value` moved forward by `minutes`, or "" when `value` isn't a valid
// date (the field is cleared / half typed).
export function addMinutes(value: string, minutes: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return toLocalInputValue(new Date(date.getTime() + minutes * 60_000));
}

// Whole minutes from start to end, or null when either is invalid or end is
// not after start.
export function minutesBetween(start: string, end: string): number | null {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return null;
  return Math.max(1, Math.round((e - s) / 60_000));
}
