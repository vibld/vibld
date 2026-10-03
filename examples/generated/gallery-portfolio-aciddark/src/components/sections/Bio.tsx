export function Bio() {
  return (
    <section id="about" className="px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-8 md:flex-row md:items-start">
          <div className="mx-auto w-full max-w-[400px] overflow-hidden rounded-md border border-border bg-secondary aspect-[4/5] md:mx-0" />
          <div className="flex-1">
            <h2 className="type-heading font-semibold text-foreground">About</h2>
            <div className="mt-6 space-y-4 text-muted-foreground">
              <p className="type-body">
                I'm Alex, a freelance photographer based in Berlin. My work focuses on the geometry and light of urban environments, finding beauty in the overlooked corners of the city. With over a decade behind the lens, I've shot for magazines, brands, and personal projects that explore the tension between nature and concrete.
              </p>
              <p className="type-body">
                When I'm not shooting, I'm scouting locations, developing film, or teaching photography workshops. I'm available for commissions worldwide.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
