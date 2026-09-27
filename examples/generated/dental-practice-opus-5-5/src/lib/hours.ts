export type DayHours = {
  day: string;
  open: string | null;
  close: string | null;
  note?: string;
};

export type OpenStatus = {
  isOpen: boolean;
  headline: string;
  detail: string;
};

// Sample details: replace with the practice's own before publishing.
export const PRACTICE = {
  name: 'Fernbank Dental',
  street: '14 Fernbank Road',
  town: 'Millbrook MB3 2LT',
  phone: '01632 960418',
  phoneHref: 'tel:+441632960418',
  email: 'hello@fernbankdental.example',
  mapHref: 'https://www.openstreetmap.org/search?query=14%20Fernbank%20Road%20Millbrook',
};

// Monday first, 24 hour times.
export const WEEK: DayHours[] = [
  { day: 'Monday', open: '08:00', close: '18:00' },
  { day: 'Tuesday', open: '08:00', close: '18:00' },
  { day: 'Wednesday', open: '08:00', close: '19:30', note: 'Late clinic' },
  { day: 'Thursday', open: '08:00', close: '18:00' },
  { day: 'Friday', open: '08:00', close: '16:00' },
  { day: 'Saturday', open: '09:00', close: '13:00', note: 'Check-ups and hygiene only' },
  { day: 'Sunday', open: null, close: null },
];

export function weekIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

export function formatHours(d: DayHours): string {
  return d.open && d.close ? `${d.open}–${d.close}` : 'Closed';
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function getOpenStatus(now: Date): OpenStatus {
  const today = weekIndex(now);
  const minutes = now.getHours() * 60 + now.getMinutes();
  const todayHours = WEEK[today];

  if (todayHours.open && todayHours.close) {
    const opens = toMinutes(todayHours.open);
    const closes = toMinutes(todayHours.close);
    if (minutes >= opens && minutes < closes) {
      return { isOpen: true, headline: 'Open now', detail: `Until ${todayHours.close} today` };
    }
    if (minutes < opens) {
      return { isOpen: false, headline: 'Closed now', detail: `Opens today at ${todayHours.open}` };
    }
  }

  for (let step = 1; step <= 7; step += 1) {
    const next = WEEK[(today + step) % 7];
    if (next.open) {
      const when = step === 1 ? 'tomorrow' : next.day;
      return { isOpen: false, headline: 'Closed now', detail: `Opens ${when} at ${next.open}` };
    }
  }

  return { isOpen: false, headline: 'Closed now', detail: `Call ${PRACTICE.phone}` };
}
