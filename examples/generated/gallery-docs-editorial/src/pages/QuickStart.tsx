import { motion } from "motion/react";
import SiteLayout from "@/components/SiteLayout";
import PageHeader from "@/components/PageHeader";
import CodeBlock from "@/components/CodeBlock";
import { fadeScale } from "@/lib/motion";

export default function QuickStart() {
  return (
    <SiteLayout>
      <div>
        <PageHeader
          eyebrow="Quick start"
          title="Your first site"
          intro="Set up a project, write a page, and run the local development server."
          meta="Mantle CLI v0.8.1 · 5 minutes"
        />
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-12">
            <aside className="lg:col-span-4">
              <div className="sticky top-20 space-y-8">
                <div>
                  <h2 className="font-display text-xl font-semibold text-foreground">
                    Steps
                  </h2>
                  <nav className="mt-3 flex flex-col gap-2 text-sm">
                    <a href="#create" className="text-muted-foreground hover:text-foreground">
                      1. Create a project
                    </a>
                    <a href="#structure" className="text-muted-foreground hover:text-foreground">
                      2. Project structure
                    </a>
                    <a href="#page" className="text-muted-foreground hover:text-foreground">
                      3. Write your first page
                    </a>
                    <a href="#serve" className="text-muted-foreground hover:text-foreground">
                      4. Run the development server
                    </a>
                    <a href="#build" className="text-muted-foreground hover:text-foreground">
                      5. Build for production
                    </a>
                  </nav>
                </div>
              </div>
            </aside>
            <main className="space-y-16 lg:col-span-8">
              <section id="create">
                <motion.h2
                  className="font-display text-3xl font-semibold tracking-tight text-foreground"
                  initial="hidden"
                  whileInView="show"
                  viewport={{ once: true, amount: 0.3 }}
                  variants={fadeScale}
                >
                  1. Create a project
                </motion.h2>
                <div className="mt-4 space-y-6">
                  <p className="font-serif text-lg leading-relaxed text-muted-foreground">
                    Run the init command to scaffold a new site in a directory
                    called my-site. Then move into it.
                  </p>
                  <CodeBlock
                    code={`mantle init my-site\ncd my-site`}
                    language="shell"
                    filename="terminal"
                  />
                </div>
              </section>
              <section id="structure">
                <motion.h2
                  className="font-display text-3xl font-semibold tracking-tight text-foreground"
                  initial="hidden"
                  whileInView="show"
                  viewport={{ once: true, amount: 0.3 }}
                  variants={fadeScale}
                >
                  2. Project structure
                </motion.h2>
                <div className="mt-4 space-y-6">
                  <p className="font-serif text-lg leading-relaxed text-muted-foreground">
                    Mantle expects a layouts folder, a pages folder, and a public
                    folder. Here is the default layout.
                  </p>
                  <CodeBlock
                    code={`my-site/\n├── layouts/\n│   └── default.html\n├── pages/\n│   └── index.md\n├── public/\n│   └── css/\n└── mantle.config.js`}
                    language="plaintext"
                    filename="project structure"
                  />
                </div>
              </section>
              <section id="page">
                <motion.h2
                  className="font-display text-3xl font-semibold tracking-tight text-foreground"
                  initial="hidden"
                  whileInView="show"
                  viewport={{ once: true, amount: 0.3 }}
                  variants={fadeScale}
                >
                  3. Write your first page
                </motion.h2>
                <div className="mt-4 space-y-6">
                  <p className="font-serif text-lg leading-relaxed text-muted-foreground">
                    Open pages/index.md and replace its contents with the
                    following Markdown.
                  </p>
                  <CodeBlock
                    code={`---\nlayout: default\ntitle: Home\n---\n\n# Hello, world\n\nThis is my first Mantle site.`}
                    language="markdown"
                    filename="pages/index.md"
                  />
                </div>
              </section>
              <section id="serve">
                <motion.h2
                  className="font-display text-3xl font-semibold tracking-tight text-foreground"
                  initial="hidden"
                  whileInView="show"
                  viewport={{ once: true, amount: 0.3 }}
                  variants={fadeScale}
                >
                  4. Run the development server
                </motion.h2>
                <div className="mt-4 space-y-6">
                  <p className="font-serif text-lg leading-relaxed text-muted-foreground">
                    Start Mantle's development server. It watches your files and
                    rebuilds automatically when they change.
                  </p>
                  <CodeBlock
                    code={`mantle serve`}
                    language="shell"
                    filename="terminal"
                  />
                  <p className="font-serif text-lg leading-relaxed text-muted-foreground">
                    Open http://localhost:3000 in your browser.
                  </p>
                </div>
              </section>
              <section id="build">
                <motion.h2
                  className="font-display text-3xl font-semibold tracking-tight text-foreground"
                  initial="hidden"
                  whileInView="show"
                  viewport={{ once: true, amount: 0.3 }}
                  variants={fadeScale}
                >
                  5. Build for production
                </motion.h2>
                <div className="mt-4 space-y-6">
                  <p className="font-serif text-lg leading-relaxed text-muted-foreground">
                    When you are ready to publish, run the build command. Mantle
                    writes the finished site to the public folder.
                  </p>
                  <CodeBlock
                    code={`mantle build`}
                    language="shell"
                    filename="terminal"
                  />
                </div>
              </section>
            </main>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
