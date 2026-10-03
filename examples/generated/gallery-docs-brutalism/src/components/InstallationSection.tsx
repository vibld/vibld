export default function InstallationSection() {
  return (
    <section
      id='installation'
      className='max-w-[1200px] mx-auto px-[var(--space-gutter)] py-[var(--space-section)]'
    >
      <p className='text-sm font-bold uppercase tracking-wider text-primary'>Installation</p>
      <h2 className='font-display text-[clamp(2rem,5vw,3.5rem)] leading-[1.1] tracking-[-0.01em] mt-2'>
        Install rig
      </h2>
      <p className='text-body max-w-2xl mt-4'>
        Copy and run the command for your platform. rig requires Node.js 20 or newer.
      </p>

      <p className='font-bold mt-8'>macOS / Linux</p>
      <pre className='mt-2 bg-card border-2 border-border p-4 overflow-x-auto shadow-[6px_6px_0_0_#111111]'>
        <code className='font-mono text-sm'>npm install -g rig-cli</code>
      </pre>

      <p className='font-bold mt-8'>Windows</p>
      <pre className='mt-2 bg-card border-2 border-border p-4 overflow-x-auto shadow-[6px_6px_0_0_#111111]'>
        <code className='font-mono text-sm'>npm install -g rig-cli</code>
      </pre>

      <p className='text-body max-w-2xl mt-8'>Verify the install:</p>
      <pre className='mt-2 bg-card border-2 border-border p-4 overflow-x-auto shadow-[6px_6px_0_0_#111111]'>
        <code className='font-mono text-sm'>rig --version</code>
      </pre>
    </section>
  );
}
