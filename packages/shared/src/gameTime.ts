import type { TimeOfDay } from './types/scene';

export interface GameTime {
  hour: number;
  minute: number;
}

export const DEFAULT_GAME_TIME: GameTime = { hour: 12, minute: 0 };

export function normalizeGameTime(time: GameTime): GameTime {
  let total = time.hour * 60 + time.minute;
  total = ((total % 1440) + 1440) % 1440;
  return { hour: Math.floor(total / 60), minute: total % 60 };
}

export function addGameMinutes(time: GameTime, deltaMinutes: number): GameTime {
  return normalizeGameTime({ hour: time.hour, minute: time.minute + deltaMinutes });
}

export function formatGameTime(time: GameTime, use24Hour = false): string {
  const t = normalizeGameTime(time);
  if (use24Hour) {
    return `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
  }
  const h12 = t.hour % 12 || 12;
  const ampm = t.hour < 12 ? 'AM' : 'PM';
  return `${h12}:${String(t.minute).padStart(2, '0')} ${ampm}`;
}

export function gameTimeToInputValue(time: GameTime): string {
  const t = normalizeGameTime(time);
  return `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
}

export function parseGameTimeInput(value: string): GameTime | null {
  const trimmed = value.trim();
  const match24 = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (match24) {
    const hour = Number(match24[1]);
    const minute = Number(match24[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return normalizeGameTime({ hour, minute });
    }
    return null;
  }
  const match12 = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(trimmed);
  if (match12) {
    let hour = Number(match12[1]) % 12;
    const minute = Number(match12[2]);
    if (minute < 0 || minute > 59) return null;
    if (match12[3]!.toLowerCase() === 'pm') hour += 12;
    return normalizeGameTime({ hour, minute });
  }
  return null;
}

/** Map clock time to atmosphere preset for map lighting. */
export function gameTimeToTimeOfDay(time: GameTime): TimeOfDay {
  const h = normalizeGameTime(time).hour;
  if (h >= 5 && h < 7) return 'dawn';
  if (h >= 7 && h < 17) return 'day';
  if (h >= 17 && h < 19) return 'golden-hour';
  if (h >= 19 && h < 21) return 'dusk';
  if (h >= 21 || h < 1) return 'night';
  return 'midnight';
}

export const TIME_OF_DAY_TO_GAME_TIME: Record<TimeOfDay, GameTime> = {
  dawn: { hour: 6, minute: 0 },
  day: { hour: 12, minute: 0 },
  'golden-hour': { hour: 17, minute: 30 },
  dusk: { hour: 19, minute: 30 },
  night: { hour: 22, minute: 0 },
  midnight: { hour: 2, minute: 0 },
};
