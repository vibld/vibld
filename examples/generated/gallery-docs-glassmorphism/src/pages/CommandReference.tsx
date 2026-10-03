import CodeBlock from '@/components/CodeBlock';

interface Command {
  name: string;
  description: string;
  usage: string;
  flags: { flag: string; description: string }[];
  example: string;
}

const commands: Command[] = [
  {
    name: 'chisel new',
    description: 'Create a new project from a template.',
    usage: 'chisel new <name> [options]',
    flags: [
      { flag: '-t, --template <name>', description: 'Template to scaffold. Defaults to next.js.' },
      { flag: '--no-git', description: 'Skip initializing a git repository.' },
      { flag: '--skip-install', description: 'Do not install dependencies after scaffolding.' },
      { flag: '-f, --force', description: 'Overwrite the target directory if it exists.' },
    ],
    example: '$ chisel new my-blog --template next.js\n✔ Template downloaded\n✔ Dependencies installed\n✔ Project ready in my-blog/',
  },
  {
    name: 'chisel add',
    description: 'Add a file, component, plugin, or dependency to an existing project.',
    usage: 'chisel add <type> <name> [options]',
    flags: [
      { flag: '--dry-run', description: 'Show what would be added without writing files.' },
      { flag: '-f, --force', description: 'Overwrite existing files of the same name.' },
    ],
    example: '$ chisel add component button\n✔ Component button added to src/components/button.tsx',
  },
  {
    name: 'chisel list',
    description: 'Show available templates, plugins, and components.',
    usage: 'chisel list [type] [options]',
    flags: [
      { flag: '--templates', description: 'List only project templates.' },
      { flag: '--plugins', description: 'List only plugins.' },
      { flag: '--components', description: 'List only reusable components.' },
      { flag: '--json', description: 'Output the list as JSON.' },
    ],
    example: '$ chisel list --templates\nnext.js\nastro\nvite-react\nvue',
  },
  {
    name: 'chisel dev',
    description: 'Start the development server for the current project.',
    usage: 'chisel dev [options]',
    flags: [
      { flag: '-p, --port <number>', description: 'Port to listen on. Defaults to 3000.' },
      { flag: '-H, --host <address>', description: 'Host address to bind to. Defaults to localhost.' },
      { flag: '--open', description: 'Open the app in the default browser once the server is ready.' },
    ],
    example: '$ chisel dev --port 4000\n✔ Dev server running at http://localhost:4000',
  },
  {
    name: 'chisel init',
    description: 'Create a new template manifest in the current folder.',
    usage: 'chisel init [options]',
    flags: [
      { flag: '--name <name>', description: 'Template name. Defaults to the folder name.' },
      { flag: '--description <text>', description: 'Short description shown in chisel list.' },
    ],
    example: '$ chisel init --name vue-dashboard --description "A Vue admin dashboard"\n✔ Template manifest created at chisel.toml',
  },
  {
    name: 'chisel update',
    description: 'Update Chisel itself or refresh installed templates.',
    usage: 'chisel update [options]',
    flags: [
      { flag: '--check', description: 'Check for updates without installing them.' },
      { flag: '-f, --force', description: 'Reinstall templates even if they are up to date.' },
    ],
    example: '$ chisel update --check\nChisel is up to date (v1.4.2)',
  },
  {
    name: 'chisel help',
    description: 'Show help for a command.',
    usage: 'chisel help [command]',
    flags: [],
    example: '$ chisel help new\nCreate a new project from a template.\n\nUsage: chisel new <name> [options]',
  },
  {
    name: 'chisel version',
    description: 'Print the installed Chisel version.',
    usage: 'chisel version',
    flags: [],
    example: '$ chisel version\n1.4.2',
  },
];

export default function CommandReference() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="font-display text-[clamp(2.5rem,5vw,4rem)] leading-[1.2] tracking-[-0.02em] text-foreground">
        Command reference
      </h1>
      <p className="mt-4 text-lg text-muted-foreground">
        Every Chisel command, its options, and examples.
      </p>

      <div className="mt-12 space-y-12">
        {commands.map((command) => (
          <section key={command.name}>
            <h2 className="font-display text-2xl font-semibold text-foreground">
              {command.name}
            </h2>
            <p className="mt-2 text-muted-foreground">{command.description}</p>

            <p className="mt-4 font-mono text-sm text-foreground">
              Usage: <span className="text-primary">{command.usage}</span>
            </p>

            {command.flags.length > 0 && (
              <div className="mt-4">
                <h3 className="text-sm font-medium text-muted-foreground">Options</h3>
                <dl className="mt-2 space-y-2">
                  {command.flags.map((flag) => (
                    <div key={flag.flag} className="flex flex-col gap-1 sm:flex-row sm:gap-4">
                      <dt className="font-mono text-sm text-foreground shrink-0 sm:w-56">
                        {flag.flag}
                      </dt>
                      <dd className="text-sm text-muted-foreground">{flag.description}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            <div className="mt-4">
              <CodeBlock code={command.example} />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
