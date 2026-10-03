export function Hero() {
  return (
    <section className="flex min-h-[calc(100vh-72px)] flex-col justify-end px-[var(--gutter)] pt-[var(--section)] pb-[var(--section)] border-b-[3px] border-foreground">
      <h1 className="font-display text-[clamp(3.5rem,8vw,7rem)] leading-[0.9] tracking-[-0.03em]">
        Mara Voss
      </h1>
      <p className="mt-4 text-2xl font-bold">Photographer</p>
      <p className="mt-3 text-lg md:text-xl">
        Portrait and documentary work from Lisbon and elsewhere.
      </p>
      <div className="mt-8 flex flex-wrap gap-4">
        <a href="#work" className="btn btn-primary">
          See recent work
        </a>
        <a href="#contact" className="btn btn-outline">
          Get in touch
        </a>
      </div>
    </section>
  );
}
