const projects = [
  { title: 'Nocturne', meta: 'Personal, 35mm, 2025' },
  { title: 'Porto Norte', meta: 'Editorial, 2024' },
  { title: 'After the Set', meta: 'Music, 2024' },
  { title: 'Market Day', meta: 'Documentary, 2023' },
  { title: 'Blue Hour', meta: 'Commission, 2023' },
  { title: 'Concrete Gardens', meta: 'Personal, 2025' },
];

export function Gallery() {
  return (
    <section id="work" className="mx-auto max-w-[1440px] px-[var(--gutter)] py-[var(--section)]">
      <h2 className="font-display text-[clamp(2.25rem,4vw,3.5rem)] leading-[0.95] tracking-[-0.02em]">
        Recent work
      </h2>
      <p className="mt-4 max-w-2xl text-base text-muted-foreground">
        A selection of commissioned and personal projects from the last two years.
      </p>
      <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-foreground border border-foreground">
        {projects.map((project) => (
          <figure key={project.title} className="group gallery-card bg-background">
            <div className="aspect-[4/3] bg-muted flex items-center justify-center">
              <span className="text-sm font-bold uppercase tracking-[0.08em] text-muted-foreground">
                {project.title}
              </span>
            </div>
            <figcaption className="flex items-baseline justify-between gap-4 border-t border-foreground p-4">
              <span className="font-bold text-base">{project.title}</span>
              <span className="text-sm text-muted-foreground">{project.meta}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
