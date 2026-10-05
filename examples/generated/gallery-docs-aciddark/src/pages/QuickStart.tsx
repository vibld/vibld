import { CodeBlock } from '@/components/CodeBlock';

export default function QuickStart() {
  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight">Quick start</h1>
      <p className="mt-4 text-lg text-muted-foreground">
        Create and run a new Ion project in under a minute. This page assumes you have completed the installation steps.
      </p>

      <h2 className="mt-12 font-display text-2xl font-semibold tracking-tight">Prerequisites</h2>
      <ul className="mt-4 space-y-2 text-muted-foreground">
        <li>Ion CLI 1.4.0 or later installed</li>
        <li>No package.json or build tooling required for the default template</li>
        <li>Node.js 18+ only if you plan to use plugins that require it</li>
      </ul>

      <h2 className="mt-12 font-display text-2xl font-semibold tracking-tight">Create a project</h2>
      <p className="mt-4 text-muted-foreground">
        Ion scaffolds a project into a new directory and asks which template you want.
      </p>
      <CodeBlock className="mt-4" code={`ion init my-app`} filename="terminal" />
      <p className="mt-4 text-muted-foreground">
        Choose the "vanilla" template to start without a framework, or pick react, vue, or svelte.
      </p>

      <h2 className="mt-12 font-display text-2xl font-semibold tracking-tight">Start the development server</h2>
      <p className="mt-4 text-muted-foreground">Move into the project and start serving locally.</p>
      <CodeBlock className="mt-4" code={`cd my-app\nion dev`} filename="terminal" />
      <p className="mt-4 text-muted-foreground">
        The server starts on <code className="text-foreground font-mono">http://localhost:3000</code> and hot reloads as you edit source files.
      </p>

      <h2 className="mt-12 font-display text-2xl font-semibold tracking-tight">Project structure</h2>
      <p className="mt-4 text-muted-foreground">A new Ion project contains these files:</p>
      <CodeBlock
        className="mt-4"
        code={`my-app/\n├── src/\n│   ├── index.html\n│   ├── index.js\n│   └── styles.css\n├── ion.config.js\n└── package.json`}
        filename="directory tree"
      />

      <h2 className="mt-12 font-display text-2xl font-semibold tracking-tight">Next steps</h2>
      <ul className="mt-4 space-y-3 text-muted-foreground">
        <li>
          Read the{' '}
          <a href="/reference" className="text-primary underline underline-offset-4 hover:text-primary/90">
            command reference
          </a>{' '}
          for every option and example.
        </li>
        <li>
          Learn how to configure{' '}
          <a href="/reference" className="text-primary underline underline-offset-4 hover:text-primary/90">
            ion.config.js
          </a>{' '}
          for production builds.
        </li>
        <li>
          Explore the{' '}
          <a href="/installation" className="text-primary underline underline-offset-4 hover:text-primary/90">
            installation
          </a>{' '}
          page for alternative methods.
        </li>
      </ul>
    </div>
  );
}
