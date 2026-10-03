const saturdaySchedule = [
  { time: '11:00 AM', event: 'Gates open, all stations fire up', location: 'Main gate' },
  { time: '12:00 PM', event: 'Whole hog carving at Smoke & Slaw', location: 'Station 03' },
  { time: '2:00 PM', event: 'Taco throwdown competition', location: 'Main stage' },
  { time: '5:00 PM', event: 'Night market opens with lantern lighting', location: 'East yard' },
  { time: '8:00 PM', event: 'Fire stage: Smoke & Slaw live set', location: 'Fire stage' },
  { time: '10:00 PM', event: 'Gates close', location: 'All areas' },
];

const sundaySchedule = [
  { time: '11:00 AM', event: 'Gates open, brunch over embers', location: 'Main gate' },
  { time: '12:00 PM', event: 'Coal roast demo at Coal Roast', location: 'Station 07' },
  { time: '2:00 PM', event: 'Vendor awards ceremony', location: 'Main stage' },
  { time: '4:00 PM', event: 'Kimchi and grilled meat pairing at Flame & Ferment', location: 'Station 09' },
  { time: '6:00 PM', event: 'Final fire pit gathering', location: 'Central fire pit' },
  { time: '8:00 PM', event: 'Gates close', location: 'All areas' },
];

export default function Schedule() {
  return (
    <div>
      <section className="border-2 border-foreground bg-secondary p-6 md:p-12 shadow-hard">
        <p className="font-mono text-sm uppercase tracking-widest">Two days, one rail yard</p>
        <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl uppercase leading-none mt-2">Schedule</h1>
        <p className="mt-4 text-lg font-medium max-w-2xl">
          Gates open at 11:00 AM both days. Live fire runs all afternoon, and the night market opens Saturday at 5:00 PM.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="font-display text-2xl sm:text-3xl uppercase mb-4">Saturday, June 14</h2>
        <div className="hidden md:block border-2 border-foreground shadow-hard">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-foreground text-background">
                <th className="p-3 font-mono text-sm uppercase">Time</th>
                <th className="p-3 font-mono text-sm uppercase">Event</th>
                <th className="p-3 font-mono text-sm uppercase">Location</th>
              </tr>
            </thead>
            <tbody>
              {saturdaySchedule.map((item) => (
                <tr key={item.time} className="border-t-2 border-foreground odd:bg-background even:bg-secondary">
                  <td className="p-3 font-mono text-sm whitespace-nowrap">{item.time}</td>
                  <td className="p-3 font-medium">{item.event}</td>
                  <td className="p-3 text-sm">{item.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="md:hidden grid gap-2">
          {saturdaySchedule.map((item) => (
            <div key={item.time} className="border-2 border-foreground p-3 bg-background shadow-hard-sm">
              <p className="font-mono text-xs uppercase text-muted-foreground">{item.time}</p>
              <p className="font-bold mt-1">{item.event}</p>
              <p className="text-sm">{item.location}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="font-display text-2xl sm:text-3xl uppercase mb-4">Sunday, June 15</h2>
        <div className="hidden md:block border-2 border-foreground shadow-hard">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-foreground text-background">
                <th className="p-3 font-mono text-sm uppercase">Time</th>
                <th className="p-3 font-mono text-sm uppercase">Event</th>
                <th className="p-3 font-mono text-sm uppercase">Location</th>
              </tr>
            </thead>
            <tbody>
              {sundaySchedule.map((item) => (
                <tr key={item.time} className="border-t-2 border-foreground odd:bg-background even:bg-secondary">
                  <td className="p-3 font-mono text-sm whitespace-nowrap">{item.time}</td>
                  <td className="p-3 font-medium">{item.event}</td>
                  <td className="p-3 text-sm">{item.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="md:hidden grid gap-2">
          {sundaySchedule.map((item) => (
            <div key={item.time} className="border-2 border-foreground p-3 bg-background shadow-hard-sm">
              <p className="font-mono text-xs uppercase text-muted-foreground">{item.time}</p>
              <p className="font-bold mt-1">{item.event}</p>
              <p className="text-sm">{item.location}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
