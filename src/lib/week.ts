export type WeekPlanDay = {
  /** Local date key, e.g. "2026-10-14". */
  key: string;
  /** Short weekday label, e.g. "вт" / "Tue". */
  weekdayShort: string;
  /** Short date label, e.g. "14 окт." / "Oct 14". */
  dateLabel: string;
};

/** Local calendar date key (never UTC — plans are shown in the user's zone). */
export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * The seven days a weekly plan covers: tomorrow through +7 days. Dates are
 * always computed locally and injected into the prompt — the model only fills
 * in sessions, so it can never hallucinate a calendar.
 */
export function getWeekPlanDays(from: Date, lang: 'ru' | 'en' = 'ru'): WeekPlanDay[] {
  const locale = lang === 'ru' ? 'ru-RU' : 'en-US';
  const days: WeekPlanDay[] = [];
  for (let offset = 1; offset <= 7; offset++) {
    const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
    days.push({
      key: dateKey(date),
      weekdayShort: date.toLocaleDateString(locale, { weekday: 'short' }),
      dateLabel: date.toLocaleDateString(locale, { day: '2-digit', month: 'short' }),
    });
  }
  return days;
}
