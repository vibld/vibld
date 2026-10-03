export default function PageIntro() {
  return (
    <section
      id='hero'
      className='max-w-[1200px] mx-auto px-[var(--space-gutter)] py-[var(--space-section)] flex flex-col gap-6'
    >
      <h1 className='font-display text-[clamp(3rem,8vw,6rem)] leading-[0.95] tracking-[-0.02em]'>
        rig CLI
      </h1>
      <p className='text-body max-w-2xl'>
        A fast, opinionated scaffolder for code projects. Install it, run a template, and get back to work.
      </p>
      <a
        href='#installation'
        className='inline-flex items-center justify-center self-start px-8 py-4 bg-primary text-primary-foreground font-bold text-lg border-2 border-border shadow-[6px_6px_0_0_#111111] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[4px_4px_0_0_#111111] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
      >
        Install rig
      </a>
    </section>
  );
}
