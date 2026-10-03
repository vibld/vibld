export function Bio() {
  return (
    <section id="about" className="mx-auto max-w-[900px] px-[var(--gutter)] py-[var(--section)]">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[var(--stack-lg)]">
        <div className="border-[3px] border-foreground shadow-hard bg-muted aspect-[4/5] flex items-center justify-center">
          <span className="text-sm font-bold uppercase tracking-[0.08em] text-muted-foreground">
            Portrait placeholder
          </span>
        </div>
        <div className="flex flex-col justify-center gap-6">
          <h2 className="font-display text-[clamp(2.25rem,4vw,3.5rem)] leading-[0.95] tracking-[-0.02em]">
            About
          </h2>
          <p className="text-base leading-relaxed">
            Mara Voss is a photographer based in Lisbon. She photographs people where they work, rest and perform, usually on 35mm and usually in available light.
          </p>
          <p className="text-base leading-relaxed">
            Her recent commissions include album covers, magazine features and brand work. She also teaches a monthly darkroom workshop and is slowly building a series on the city's late-night kiosks.
          </p>
          <p className="text-base leading-relaxed text-muted-foreground">
            For assignments, licensing or prints, send a note through the form below.
          </p>
        </div>
      </div>
    </section>
  );
}
