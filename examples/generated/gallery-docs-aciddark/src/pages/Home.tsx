import { ArrowRight, FileCode, Package, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CodeBlock } from '@/components/CodeBlock';

export default function Home() {
  return (
    <>
      <section className="px-4 sm:px-6 lg:px-8 pt-20 pb-20 md:pt-28 md:pb-28 max-w-5xl mx-auto">
        <div className="max-w-3xl">
          <p className="text-sm font-medium text-muted-foreground mb-4">
            Open-source command line tool
          </p>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-7xl font-bold tracking-tight leading-[1.05] text-balance">
            Build web projects from the terminal.
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-muted-foreground leading-relaxed max-w-2xl">
            Ion is a 12 MB single binary that scaffolds, serves, and compiles JavaScript applications. No runtime, no lockfile, no postinstall scripts.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <a href="/quick-start">Get started</a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="/installation">Read installation</a>
            </Button>
          </div>
        </div>
        <div className="mt-12 max-w-2xl">
          <CodeBlock
            code={`# in your terminal\nnpm install -g ion-cli\nion init my-app\ncd my-app && ion dev`}
            filename="terminal"
          />
        </div>
      </section>

      <section className="border-t border-border bg-card/40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24">
          <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight">Why Ion</h2>
          <div className="mt-8 grid gap-8 md:grid-cols-3">
            <div>
              <Package className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
              <h3 className="mt-4 font-display text-xl font-semibold">Single binary</h3>
              <p className="mt-2 text-muted-foreground text-base leading-relaxed">
                A 12 MB static executable covers every command. No Node install, no native modules, no system dependencies.
              </p>
            </div>
            <div>
              <Zap className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
              <h3 className="mt-4 font-display text-xl font-semibold">Fast by default</h3>
              <p className="mt-2 text-muted-foreground text-base leading-relaxed">
                Builds run through esbuild with a 0ms cold start for the dev server. Hot reload lands in under 100ms.
              </p>
            </div>
            <div>
              <FileCode className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
              <h3 className="mt-4 font-display text-xl font-semibold">Zero config</h3>
              <p className="mt-2 text-muted-foreground text-base leading-relaxed">
                Ion reads your source layout and produces sensible defaults. A config file is optional for edge cases.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 sm:px-6 lg:px-8 py-16 md:py-24 max-w-5xl mx-auto">
        <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight">
          Get moving in four commands
        </h2>
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <CodeBlock code={`npm install -g ion-cli`} filename="01. Install" />
            <CodeBlock code={`ion init my-app`} filename="02. Create a project" />
          </div>
          <div className="flex flex-col gap-4">
            <CodeBlock code={`cd my-app && ion dev`} filename="03. Serve locally" />
            <CodeBlock code={`ion build`} filename="04. Compile for production" />
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-card/40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24">
          <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight">
            Command reference
          </h2>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl">
            Every command, option, and example lives in the reference.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <a
              href="/reference"
              className="group rounded-md border border-border p-5 bg-card hover:bg-muted/40 transition-colors duration-150"
            >
              <h3 className="font-display text-lg font-semibold">Core commands</h3>
              <p className="mt-1 text-sm text-muted-foreground">init, dev, build, test</p>
            </a>
            <a
              href="/reference"
              className="group rounded-md border border-border p-5 bg-card hover:bg-muted/40 transition-colors duration-150"
            >
              <h3 className="font-display text-lg font-semibold">Configuration</h3>
              <p className="mt-1 text-sm text-muted-foreground">ion.config.js, environment variables</p>
            </a>
            <a
              href="/reference"
              className="group rounded-md border border-border p-5 bg-card hover:bg-muted/40 transition-colors duration-150"
            >
              <h3 className="font-display text-lg font-semibold">Dev server</h3>
              <p className="mt-1 text-sm text-muted-foreground">serve, proxy, watch</p>
            </a>
            <a
              href="/reference"
              className="group rounded-md border border-border p-5 bg-card hover:bg-muted/40 transition-colors duration-150"
            >
              <h3 className="font-display text-lg font-semibold">Utilities</h3>
              <p className="mt-1 text-sm text-muted-foreground">lint, format, upgrade</p>
            </a>
          </div>
          <div className="mt-8">
            <Button asChild variant="outline">
              <a href="/reference">
                Browse the full reference <ArrowRight className="h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
