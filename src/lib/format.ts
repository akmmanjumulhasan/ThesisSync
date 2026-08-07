/** "A.K.M Manjumul Hasan Maksud" -> "A.K.M"; "Dr. Farhana Islam" -> "Dr. Farhana" (titles keep their name). */
export function firstName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length > 1 && /\.$/.test(parts[0]) && parts[0].length <= 4) {
    return `${parts[0]} ${parts[1]}`;
  }
  return parts[0];
}

/** Formal address for titled names: "Dr. Farhana Islam" -> "Dr. Islam" (title + surname). */
export function formalGreetingName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length > 1 && /\.$/.test(parts[0]) && parts[0].length <= 4) {
    return `${parts[0]} ${parts[parts.length - 1]}`;
  }
  return parts[0];
}

/** "morning" / "afternoon" / "evening", for a time-of-day greeting. */
export function timeOfDayGreeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
