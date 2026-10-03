export default function QuickStartSection() {
  return (
    <section
      id='quick-start'
      className='max-w-[1200px] mx-auto px-[var(--space-gutter)] py-[var(--space-section)]'
    >
      <p className='text-sm font-bold uppercase tracking-wider text-primary'>Quick start</p>
      <h2 className='font-display text-[clamp(2rem,5vw,3.5rem)] leading-[1.1] tracking-[-0.01em] mt-2'>
        Quick start
      </h2>
      <p className='text-body max-w-2xl mt-4'>
        Create a project from a template in three commands.
      </p>

      <ol className='list-none space-y-8 mt-8'>
        <li>
          <p className='font-bold'>1. Initialize a new project in the current directory:</p>
          <pre className='mt-2 bg-card border-2 border-border p-4 overflow-x-auto shadow-[6px_6px_0_0_#111111]'>
            <code className='font-mono text-sm'>rig init</code>
          </pre>
        </li>
        <li>
          <p className='font-bold'>2. Pick a template when prompted:</p>
          <pre className='mt-2 bg-card border-2 border-border p-4 overflow-x-auto shadow-[6px_6px_0_0_#111111]'>
            <code className='font-mono text-sm'>? Select a template: (Use arrow keys)</code>
          </pre>
        </li>
        <li>
          <p className='font-bold'>3. Install dependencies and start the dev server:</p>
          <pre className='mt-2 bg-card border-2 border-border p-4 overflow-x-auto shadow-[6px_6px_0_0_#111111]'>
            <code className='font-mono text-sm'>npm install</code>
          </pre>
          <pre className='mt-2 bg-card border-2 border-border p-4 overflow-x-auto shadow-[6px_6px_0_0_#111111]'>
            <code className='font-mono text-sm'>npm run dev</code>
          </pre>
        </li>
      </ol>

      <p className='text-body max-w-2xl mt-8'>
        All templates include a README with next steps.
      </p>
    </section>
  );
}
