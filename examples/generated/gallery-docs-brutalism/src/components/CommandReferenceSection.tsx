const commands = [
  {
    command: 'rig init',
    description: 'Create a new project from a template in the current directory.',
    example: 'rig init --template node-server',
  },
  {
    command: 'rig list',
    description: 'List available templates and their descriptions.',
    example: 'rig list',
  },
  {
    command: 'rig create <name>',
    description: 'Create a new project in a subdirectory called <name>.',
    example: 'rig create my-api',
  },
  {
    command: 'rig version',
    description: 'Print the installed version.',
    example: 'rig version',
  },
  {
    command: 'rig help [command]',
    description: 'Show help for a command, or general help if omitted.',
    example: 'rig help create',
  },
];

export default function CommandReferenceSection() {
  return (
    <section
      id='command-reference'
      className='max-w-[1200px] mx-auto px-[var(--space-gutter)] py-[var(--space-section)]'
    >
      <p className='text-sm font-bold uppercase tracking-wider text-primary'>Command reference</p>
      <h2 className='font-display text-[clamp(2rem,5vw,3.5rem)] leading-[1.1] tracking-[-0.01em] mt-2'>
        Command reference
      </h2>
      <p className='text-body max-w-2xl mt-4'>
        Every rig command, its options, and an example.
      </p>

      <div className='overflow-x-auto mt-8'>
        <table className='w-full border-collapse border-2 border-border text-left'>
          <thead>
            <tr className='bg-muted'>
              <th className='border-2 border-border p-3 font-bold'>Command</th>
              <th className='border-2 border-border p-3 font-bold'>Description</th>
              <th className='border-2 border-border p-3 font-bold'>Example</th>
            </tr>
          </thead>
          <tbody>
            {commands.map((row) => (
              <tr key={row.command} className='bg-card'>
                <td className='border-2 border-border p-3 font-mono font-bold'>{row.command}</td>
                <td className='border-2 border-border p-3'>{row.description}</td>
                <td className='border-2 border-border p-3 font-mono'>{row.example}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
