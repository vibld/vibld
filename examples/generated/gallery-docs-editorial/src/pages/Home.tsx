import { motion } from "motion/react";
import SiteLayout from "@/components/SiteLayout";
import CodeBlock from "@/components/CodeBlock";
import { fadeScale, clipReveal } from "@/lib/motion";

export default function Home() {
  return (
    <SiteLayout>
      <div>
        <section className="mx-auto max-w-6xl px-4 pt-12 sm:px-6 lg:px-8 lg:pt-20">
          <div className="grid gap-10 lg:grid-cols-12">
            <div className="flex flex-col justify-center lg:col-span-6">
              <motion.p
                className="mb-4 font-mono text-xs uppercase tracking-[0.18em] text-primary"
                initial="hidden"
                animate="show"
                variants={fadeScale}
              >
                Mantle CLI v0.8.1
              </motion.p>
              <motion.h1
                className="font-display text-5xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-7xl md:text-8xl"
                initial="hidden"
                animate="show"
                variants={fadeScale}
              >
                Static sites from plain text.
              </motion.h1>
              <p className="mt-6 max-w-md font-serif text-lg leading-relaxed text-muted-foreground sm:text-xl">
                Mantle turns a folder of Markdown files into a fast,
                dependency-free website. One command installs it, one command
                builds it.
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <motion.a
                  href="#/installation"
                  className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1], delay: 0.2 }}
                >
                  Install Mantle
                </motion.a>
                <motion.a
                  href="#/reference"
                  className="inline-flex h-11 items-center justify-center rounded-md border border-border bg-background px-6 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1], delay: 0.3 }}
                >
                  Read the reference
                </motion.a>
              </div>
            </div>
            <div className="lg:col-span-6">
              <CodeBlock
                code={`$ mantle init my-website\n$ cd my-website\n$ mantle build\n$ mantle serve`}
                language="shell"
                filename="terminal"
                className="mt-0 shadow-sm"
              />
            </div>
          </div>
        </section>

        <motion.div
          className="relative mt-16 h-[45vh] w-full overflow-hidden sm:h-[60vh]"
          variants={clipReveal}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.3 }}
          aria-hidden="true"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-primary/25 via-background to-accent/20" />
          <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_25%_25%,var(--primary)_0,transparent_40%),radial-gradient(circle_at_75%_75%,var(--accent)_0,transparent_40%)]" />
          <div className="absolute inset-0 flex items-center justify-center font-mono text-xs text-foreground/60 sm:text-sm">
            <pre className="bg-background/60 p-6 backdrop-blur-sm">
{`mantle build
Compiling 42 pages...
Writing public/index.html
Writing public/about/index.html
Done in 1.2s`}
            </pre>
          </div>
        </motion.div>

        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-12">
            <motion.h2
              className="font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:col-span-5"
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
              variants={fadeScale}
            >
              Principles
            </motion.h2>
            <div className="space-y-12 lg:col-span-7">
              <div>
                <h3 className="font-display text-2xl font-semibold text-foreground">
                  Plain text in, static HTML out
                </h3>
                <p className="mt-3 font-serif text-lg leading-relaxed text-muted-foreground">
                  Mantle reads Markdown, applies a template, and writes complete
                  HTML. No server, no runtime, no database. The output works from
                  any file host.
                </p>
              </div>
              <div>
                <h3 className="font-display text-2xl font-semibold text-foreground">
                  Slow by design, fast at runtime
                </h3>
                <p className="mt-3 font-serif text-lg leading-relaxed text-muted-foreground">
                  Mantle takes longer to build than a single-page app, but each
                  page is a static file that loads immediately. The build step is
                  the only step.
                </p>
              </div>
              <blockquote className="border-l-2 border-primary pl-6 font-serif text-xl italic text-foreground md:text-2xl">
                "The site is the artifact, not the interface to a backend."
              </blockquote>
            </div>
          </div>
        </section>

        <section className="border-t border-border bg-muted/30">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
            <motion.h2
              className="font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl"
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
              variants={fadeScale}
            >
              How a build works
            </motion.h2>
            <div className="mt-10 grid gap-8 md:grid-cols-2">
              <div>
                <p className="font-serif text-lg leading-relaxed text-muted-foreground">
                  Mantle reads every file in a project, maps the folder structure
                  to URLs, and applies a layout. It then writes the finished HTML
                  to a public directory ready for any web server.
                </p>
              </div>
              <CodeBlock
                code={`$ mantle build\nCompiling 42 pages...\nWriting public/index.html\nWriting public/about/index.html\nDone in 1.2s`}
                language="shell"
                filename="terminal"
              />
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="grid gap-10 md:grid-cols-2">
            <motion.h2
              className="font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl"
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
              variants={fadeScale}
            >
              Start with the quick start
            </motion.h2>
            <div className="space-y-6">
              <p className="font-serif text-lg leading-relaxed text-muted-foreground">
                Follow the guided tutorial to create your first Mantle site in
                under five minutes. It covers project structure, Markdown, and
                the local development server.
              </p>
              <a
                href="#/quick-start"
                className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Open quick start
              </a>
            </div>
          </div>
        </section>
      </div>
    </SiteLayout>
  );
}
