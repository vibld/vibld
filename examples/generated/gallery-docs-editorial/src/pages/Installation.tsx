import { motion } from "motion/react";
import SiteLayout from "@/components/SiteLayout";
import PageHeader from "@/components/PageHeader";
import CodeBlock from "@/components/CodeBlock";
import { fadeScale } from "@/lib/motion";

export default function Installation() {
  return (
    <SiteLayout>
      <div>
        <PageHeader
          eyebrow="Installation"
          title="Get Mantle running in two minutes"
          intro="Requirements and install paths for macOS, Linux, and Windows."
          meta="Mantle CLI v0.8.1 · last updated June 2025"
        />
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-12">
            <aside className="lg:col-span-4">
              <div className="sticky top-20 space-y-8">
                <div>
                  <h2 className="font-display text-xl font-semibold text-foreground">
                    On this page
                  </h2>
                  <nav className="mt-3 flex flex-col gap-2 text-sm">
                    <a href="#requirements" className="text-muted-foreground hover:text-foreground">
                      System requirements
                    </a>
                    <a href="#npm" className="text-muted-foreground hover:text-foreground">
                      Install with npm
                    </a>
                    <a href="#brew" className="text-muted-foreground hover:text-foreground">
                      Install with Homebrew
                    </a>
                    <a href="#source" className="text-muted-foreground hover:text-foreground">
                      Install from source
                    </a>
                    <a href="#verify" className="text-muted-foreground hover:text-foreground">
                      Verify the installation
                    </a>
                  </nav>
                </div>
              </div>
            </aside>
            <main className="space-y-16 lg:col-span-8">
              <section id="requirements">
                <motion.h2
                  className="font-display text-3xl font-semibold tracking-tight text-foreground"
                  initial="hidden"
                  whileInView="show"
                  viewport={{ once: true, amount: 0.3 }}
                  variants={fadeScale}
                >
                  System requirements
                </motion.h2>
                <div className="mt-4 space-y-4 font-serif text-lg leading-relaxed text-muted-foreground">
                  <p>
                    Mantle needs Node.js 18 or newer and npm 9 or newer. On
                    Windows, use PowerShell or Windows Terminal.
                  </p>
                  <ul className="list-disc space-y-2 pl-6">
                    <li>Node.js 18.0 or newer</li>
                    <li>npm 9.0 or newer</li>
                    <li>A terminal emulator on macOS or Linux, PowerShell on Windows</li>
                  </ul>
                </div>
              </section>
              <section id="npm">
                <motion.h2
                  className="font-display text-3xl font-semibold tracking-tight text-foreground"
                  initial="hidden"
                  whileInView="show"
                  viewport={{ once: true, amount: 0.3 }}
                  variants={fadeScale}
                >
                  Install with npm
                </motion.h2>
                <div className="mt-4 space-y-6">
                  <p className="font-serif text-lg leading-relaxed text-muted-foreground">
                    Run this command in a terminal:
                  </p>
                  <CodeBlock
                    code={`npm install -g mantle-cli`}
                    language="shell"
                    filename="terminal"
                  />
                </div>
              </section>
              <section id="brew">
                <motion.h2
                  className="font-display text-3xl font-semibold tracking-tight text-foreground"
                  initial="hidden"
                  whileInView="show"
                  viewport={{ once: true, amount: 0.3 }}
                  variants={fadeScale}
                >
                  Install with Homebrew
                </motion.h2>
                <div className="mt-4 space-y-6">
                  <p className="font-serif text-lg leading-relaxed text-muted-foreground">
                    On macOS or Linux, you can use Homebrew:
                  </p>
                  <CodeBlock
                    code={`brew tap mantle-cli/tap\nbrew install mantle`}
                    language="shell"
                    filename="terminal"
                  />
                </div>
              </section>
              <section id="source">
                <motion.h2
                  className="font-display text-3xl font-semibold tracking-tight text-foreground"
                  initial="hidden"
                  whileInView="show"
                  viewport={{ once: true, amount: 0.3 }}
                  variants={fadeScale}
                >
                  Install from source
                </motion.h2>
                <div className="mt-4 space-y-6">
                  <p className="font-serif text-lg leading-relaxed text-muted-foreground">
                    If you prefer to build Mantle yourself, clone the repository
                    and compile it with npm:
                  </p>
                  <CodeBlock
                    code={`git clone https://github.com/mantle-cli/mantle\ncd mantle\nnpm install\nnpm run build\nnpm link`}
                    language="shell"
                    filename="terminal"
                  />
                </div>
              </section>
              <section id="verify">
                <motion.h2
                  className="font-display text-3xl font-semibold tracking-tight text-foreground"
                  initial="hidden"
                  whileInView="show"
                  viewport={{ once: true, amount: 0.3 }}
                  variants={fadeScale}
                >
                  Verify the installation
                </motion.h2>
                <div className="mt-4 space-y-6">
                  <p className="font-serif text-lg leading-relaxed text-muted-foreground">
                    Check that Mantle is on your PATH and reports the current
                    version:
                  </p>
                  <CodeBlock
                    code={`mantle --version`}
                    language="shell"
                    filename="terminal"
                  />
                  <p className="font-serif text-lg leading-relaxed text-muted-foreground">
                    The output should read:
                  </p>
                  <CodeBlock
                    code={`Mantle CLI v0.8.1`}
                    language="shell"
                    filename="output"
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
