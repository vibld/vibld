import { useState } from 'react';
import { Search } from 'lucide-react';
import { CodeBlock } from '@/components/CodeBlock';
import { Input } from '@/components/ui/input';

interface CommandOption {
  flag: string;
  description: string;
}

interface Command {
  name: string;
  description: string;
  syntax: string;
  options: CommandOption[];
  example: string;
  exampleFilename: string;
}

interface CommandSection {
  title: string;
  commands: Command[];
}

const commandSections: CommandSection[] = [
  {
    title: 'Core commands',
    commands: [
      {
        name: 'ion init',
        description: 'Scaffold a new Ion project into a directory.',
        syntax: 'ion init [directory]',
        options: [
          { flag: '--template <name>', description: 'Choose a template: vanilla, react, vue, svelte' },
          { flag: '--no-install', description: 'Skip installing dependencies after scaffolding' },
          { flag: '--force', description: 'Overwrite the target directory if it exists' },
        ],
        example: 'ion init my-app --template react',
        exampleFilename: 'terminal',
      },
      {
        name: 'ion dev',
        description: 'Start the development server with hot reload.',
        syntax: 'ion dev [options]',
        options: [
          { flag: '--port <number>', description: 'Set the server port (default: 3000)' },
          { flag: '--host <address>', description: 'Bind to a specific host (default: localhost)' },
          { flag: '--open', description: 'Open the default browser when the server starts' },
        ],
        example: 'ion dev --port 8080 --open',
        exampleFilename: 'terminal',
      },
      {
        name: 'ion build',
        description: 'Compile the project for production into the dist directory.',
        syntax: 'ion build [options]',
        options: [
          { flag: '--minify', description: 'Minify JavaScript and CSS (enabled by default)' },
          { flag: '--sourcemap', description: 'Generate source maps for debugging' },
          { flag: '--target <string>', description: 'Set the output format: esm, cjs, iife' },
        ],
        example: 'ion build --sourcemap --target esm',
        exampleFilename: 'terminal',
      },
      {
        name: 'ion test',
        description: 'Run the test suite using the built-in test runner.',
        syntax: 'ion test [pattern]',
        options: [
          { flag: '--watch', description: 'Watch files and rerun tests on changes' },
          { flag: '--coverage', description: 'Report test coverage with text output' },
          { flag: '--bail', description: 'Stop after the first failing test' },
        ],
        example: 'ion test src/**/*.test.js --watch',
        exampleFilename: 'terminal',
      },
    ],
  },
  {
    title: 'Configuration',
    commands: [
      {
        name: 'ion config',
        description: 'Read and write values in ion.config.js without opening the file.',
        syntax: 'ion config <get|set|list> [key] [value]',
        options: [
          { flag: '--json', description: 'Output as JSON for scripting' },
          { flag: '--global', description: 'Apply to the user global config instead of project' },
        ],
        example: 'ion config set devPort 8080',
        exampleFilename: 'terminal',
      },
      {
        name: 'ion env',
        description: 'Print environment variables that Ion passes to child processes.',
        syntax: 'ion env [key]',
        options: [
          { flag: '--shell', description: 'Output as shell export statements' },
        ],
        example: 'ion env --shell',
        exampleFilename: 'terminal',
      },
    ],
  },
  {
    title: 'Dev server',
    commands: [
      {
        name: 'ion serve',
        description: 'Serve a static directory without any build step.',
        syntax: 'ion serve [directory] [options]',
        options: [
          { flag: '--port <number>', description: 'Set the server port (default: 3000)' },
          { flag: '--spa', description: 'Enable single-page application fallback to index.html' },
          { flag: '--headers <json>', description: 'Add custom response headers' },
        ],
        example: 'ion serve dist --spa --port 4173',
        exampleFilename: 'terminal',
      },
      {
        name: 'ion proxy',
        description: 'Proxy requests from the dev server to a backend.',
        syntax: 'ion proxy <path> --target <url>',
        options: [
          { flag: '--target <url>', description: 'Backend URL to forward matching requests to' },
          { flag: '--change-origin', description: 'Rewrite the Host header to the target' },
        ],
        example: 'ion proxy /api --target http://localhost:4000 --change-origin',
        exampleFilename: 'terminal',
      },
      {
        name: 'ion watch',
        description: 'Watch a file or directory and run a command on change.',
        syntax: 'ion watch <path> -- <command>',
        options: [
          { flag: '--debounce <ms>', description: 'Delay before triggering the command (default: 100)' },
        ],
        example: 'ion watch src/styles.css -- ion build',
        exampleFilename: 'terminal',
      },
    ],
  },
  {
    title: 'Utilities',
    commands: [
      {
        name: 'ion lint',
        description: 'Run static analysis on JavaScript and TypeScript files.',
        syntax: 'ion lint [pattern] [options]',
        options: [
          { flag: '--fix', description: 'Automatically fix safe linting errors' },
          { flag: '--format <name>', description: 'Output format: stylish, json, compact' },
        ],
        example: 'ion lint src --fix --format json',
        exampleFilename: 'terminal',
      },
      {
        name: 'ion format',
        description: 'Format source files with the built-in formatter.',
        syntax: 'ion format [pattern] [options]',
        options: [
          { flag: '--check', description: 'Report files that would be changed without writing' },
          { flag: '--write', description: 'Overwrite files with formatted output (default)' },
        ],
        example: 'ion format src/**/*.js --check',
        exampleFilename: 'terminal',
      },
      {
        name: 'ion upgrade',
        description: 'Upgrade Ion CLI to the latest stable version.',
        syntax: 'ion upgrade [options]',
        options: [
          { flag: '--pre', description: 'Install the latest prerelease version' },
          { flag: '--version <number>', description: 'Pin a specific version' },
        ],
        example: 'ion upgrade --version 1.4.2',
        exampleFilename: 'terminal',
      },
    ],
  },
];

function matchesQuery(command: Command, query: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return true;
  const searchable = [
    command.name,
    command.description,
    command.syntax,
    ...command.options.map((o) => o.flag + ' ' + o.description),
    command.example,
  ]
    .join(' ')
    .toLowerCase();
  return searchable.includes(q);
}

export default function Reference() {
  const [query, setQuery] = useState('');

  const filteredSections = commandSections
    .map((section) => ({
      ...section,
      commands: section.commands.filter((cmd) => matchesQuery(cmd, query)),
    }))
    .filter((section) => section.commands.length > 0);

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight">Command reference</h1>
      <p className="mt-4 text-lg text-muted-foreground">
        Complete list of Ion CLI commands with syntax, options, and examples.
      </p>

      <div className="mt-8 relative">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          placeholder="Search commands..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
          aria-label="Search commands"
        />
      </div>

      {filteredSections.length === 0 ? (
        <div className="mt-16 rounded-md border border-border bg-card p-8 text-center">
          <p className="text-lg font-medium">No commands match "{query}"</p>
          <p className="mt-2 text-muted-foreground">Try a different search term.</p>
        </div>
      ) : (
        <div className="mt-12 space-y-16">
          {filteredSections.map((section) => (
            <section key={section.title}>
              <h2 className="font-display text-2xl font-semibold tracking-tight">{section.title}</h2>
              <div className="mt-6 space-y-10">
                {section.commands.map((command) => (
                  <div key={command.name} className="border-b border-border pb-10 last:border-b-0 last:pb-0">
                    <h3 className="font-mono text-lg font-semibold text-foreground">{command.name}</h3>
                    <p className="mt-2 text-muted-foreground">{command.description}</p>

                    <div className="mt-4">
                      <p className="text-sm font-medium text-muted-foreground mb-2">Syntax</p>
                      <code className="block rounded-md bg-card border border-border px-4 py-3 font-mono text-sm text-foreground">
                        {command.syntax}
                      </code>
                    </div>

                    {command.options.length > 0 && (
                      <div className="mt-4">
                        <p className="text-sm font-medium text-muted-foreground mb-2">Options</p>
                        <dl className="space-y-2">
                          {command.options.map((option) => (
                            <div key={option.flag} className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-1 sm:gap-4 py-2 border-b border-border/50 last:border-b-0">
                              <dt className="font-mono text-sm text-primary">{option.flag}</dt>
                              <dd className="text-sm text-muted-foreground">{option.description}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    )}

                    <div className="mt-4">
                      <p className="text-sm font-medium text-muted-foreground mb-2">Example</p>
                      <CodeBlock code={command.example} filename={command.exampleFilename} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
