export function Gallery() {
  const works = [
    { title: 'Concrete Waves' },
    { title: 'Neon Nights' },
    { title: 'Silent Structures' },
    { title: 'Urban Rhythms' },
    { title: 'Shadow Play' },
    { title: 'Asphalt Dreams' },
  ];

  return (
    <section id="work" className="px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <h2 className="type-heading font-semibold text-foreground">Recent work</h2>
        <div className="gallery-grid mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {works.map((work) => (
            <figure key={work.title} className="group">
              <div className="aspect-[4/3] w-full overflow-hidden rounded-md border border-border bg-secondary transition-colors duration-150 group-hover:border-accent" />
              <figcaption className="type-caption mt-2 text-muted-foreground">
                {work.title}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
