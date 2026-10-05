import { motion } from 'motion/react';
import SiteLayout from '@/components/SiteLayout';
import PageHeader from '@/components/PageHeader';
import CodeBlock from '@/components/CodeBlock';
import { fadeScale } from '@/lib/motion';

export default function Reference() {
  return (
    <SiteLayout>
      <div>
        <PageHeader
          eyebrow='Reference'
          title='The mantle command'
          intro='A complete reference for every subcommand, global flag, and exit code in Mantle CLI v0.8.1.'
          meta='Mantle CLI v0.8.1 · updated June 2025'
        />
        <div className='mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8'>
          <div className='grid gap-10 lg:grid-cols-12'>
            <aside className='lg:col-span-4'>
              <div className='sticky top-20 space-y-8'>
                <div>
                  <h2 className='font-display text-xl font-semibold text-foreground'>
                    On this page
                  </h2>
                  <nav className='mt-3 flex flex-col gap-2 text-sm'>
                    <a href='#global' className='text-muted-foreground hover:text-foreground'>
                      Global options
                    </a>
                    <a href='#init' className='text-muted-foreground hover:text-foreground'>
                      mantle init
                    </a>
                    <a href='#build' className='text-muted-foreground hover:text-foreground'>
                      mantle build
                    </a>
                    <a href='#serve' className='text-muted-foreground hover:text-foreground'>
                      mantle serve
                    </a>
                    <a href='#clean' className='text-muted-foreground hover:text-foreground'>
                      mantle clean
                    </a>
                    <a href='#exit-codes' className='text-muted-foreground hover:text-foreground'>
                      Exit codes
                    </a>
                  </nav>
                </div>
              </div>
            </aside>
            <main className='space-y-16 lg:col-span-8'>
              <section id='global'>
                <motion.h2
                  className='font-display text-3xl font-semibold tracking-tight text-foreground'
                  initial='hidden'
                  whileInView='show'
                  viewport={{ once: true, amount: 0.3 }}
                  variants={fadeScale}
                >
                  Global options
                </motion.h2>
                <p className='mt-4 font-serif text-lg leading-relaxed text-muted-foreground'>
                  Every Mantle command accepts these flags. They can appear
                  before or after the subcommand.
                </p>
                <div className='mt-6 overflow-x-auto'>
                  <table className='w-full border-collapse text-left'>
                    <thead>
                      <tr className='border-b border-border'>
                        <th className='py-3 pr-4 font-mono text-sm font-medium text-foreground'>
                          Flag
                        </th>
                        <th className='py-3 pr-4 font-mono text-sm font-medium text-foreground'>
                          Value
                        </th>
                        <th className='py-3 pr-4 font-mono text-sm font-medium text-foreground'>
                          Default
                        </th>
                        <th className='py-3 font-mono text-sm font-medium text-foreground'>
                          Description
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className='border-b border-border/60'>
                        <td className='py-3 pr-4 font-mono text-sm text-foreground'>--help, -h</td>
                        <td className='py-3 pr-4 text-sm font-serif text-muted-foreground'>none</td>
                        <td className='py-3 pr-4 font-mono text-sm text-muted-foreground'>false</td>
                        <td className='py-3 font-serif text-sm leading-relaxed text-muted-foreground'>
                          Print help for the current command and exit.
                        </td>
                      </tr>
                      <tr className='border-b border-border/60'>
                        <td className='py-3 pr-4 font-mono text-sm text-foreground'>--version, -v</td>
                        <td className='py-3 pr-4 text-sm font-serif text-muted-foreground'>none</td>
                        <td className='py-3 pr-4 font-mono text-sm text-muted-foreground'>false</td>
                        <td className='py-3 font-serif text-sm leading-relaxed text-muted-foreground'>
                          Print the Mantle CLI version and exit.
                        </td>
                      </tr>
                      <tr className='border-b border-border/60'>
                        <td className='py-3 pr-4 font-mono text-sm text-foreground'>--config&lt;path&gt;</td>
                        <td className='py-3 pr-4 text-sm font-serif text-muted-foreground'>path</td>
                        <td className='py-3 pr-4 font-mono text-sm text-muted-foreground'>./mantle.config.js</td>
                        <td className='py-3 font-serif text-sm leading-relaxed text-muted-foreground'>
                          Use the configuration file at the given path.
                        </td>
                      </tr>
                      <tr className='border-b border-border/60'>
                        <td className='py-3 pr-4 font-mono text-sm text-foreground'>--verbose</td>
                        <td className='py-3 pr-4 text-sm font-serif text-muted-foreground'>none</td>
                        <td className='py-3 pr-4 font-mono text-sm text-muted-foreground'>false</td>
                        <td className='py-3 font-serif text-sm leading-relaxed text-muted-foreground'>
                          Print additional debug information while running.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              <section id='init'>
                <motion.h2
                  className='font-display text-3xl font-semibold tracking-tight text-foreground'
                  initial='hidden'
                  whileInView='show'
                  viewport={{ once: true, amount: 0.3 }}
                  variants={fadeScale}
                >
                  mantle init
                </motion.h2>
                <p className='mt-4 font-mono text-base text-foreground'>mantle init [directory] [flags]</p>
                <p className='mt-4 font-serif text-lg leading-relaxed text-muted-foreground'>
                  Creates a new Mantle project. If directory is omitted, Mantle
                  uses the current directory.
                </p>
                <div className='mt-6 overflow-x-auto'>
                  <table className='w-full border-collapse text-left'>
                    <thead>
                      <tr className='border-b border-border'>
                        <th className='py-3 pr-4 font-mono text-sm font-medium text-foreground'>Flag</th>
                        <th className='py-3 pr-4 font-mono text-sm font-medium text-foreground'>Value</th>
                        <th className='py-3 pr-4 font-mono text-sm font-medium text-foreground'>Default</th>
                        <th className='py-3 font-mono text-sm font-medium text-foreground'>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className='border-b border-border/60'>
                        <td className='py-3 pr-4 font-mono text-sm text-foreground'>--template &lt;name&gt;</td>
                        <td className='py-3 pr-4 text-sm font-serif text-muted-foreground'>string</td>
                        <td className='py-3 pr-4 font-mono text-sm text-muted-foreground'>minimal</td>
                        <td className='py-3 font-serif text-sm leading-relaxed text-muted-foreground'>
                          Use a built-in template: minimal, blog, or docs.
                        </td>
                      </tr>
                      <tr className='border-b border-border/60'>
                        <td className='py-3 pr-4 font-mono text-sm text-foreground'>--force</td>
                        <td className='py-3 pr-4 text-sm font-serif text-muted-foreground'>none</td>
                        <td className='py-3 pr-4 font-mono text-sm text-muted-foreground'>false</td>
                        <td className='py-3 font-serif text-sm leading-relaxed text-muted-foreground'>
                          Overwrite an existing directory without asking.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className='mt-6 space-y-6'>
                  <CodeBlock code={`mantle init my-site`} language='shell' filename='terminal' />
                  <CodeBlock code={`mantle init docs --template docs`} language='shell' filename='terminal' />
                </div>
              </section>

              <section id='build'>
                <motion.h2
                  className='font-display text-3xl font-semibold tracking-tight text-foreground'
                  initial='hidden'
                  whileInView='show'
                  viewport={{ once: true, amount: 0.3 }}
                  variants={fadeScale}
                >
                  mantle build
                </motion.h2>
                <p className='mt-4 font-mono text-base text-foreground'>mantle build [flags]</p>
                <p className='mt-4 font-serif text-lg leading-relaxed text-muted-foreground'>
                  Builds the site once and writes static HTML to the output
                  directory. The output directory is public by default.
                </p>
                <div className='mt-6 overflow-x-auto'>
                  <table className='w-full border-collapse text-left'>
                    <thead>
                      <tr className='border-b border-border'>
                        <th className='py-3 pr-4 font-mono text-sm font-medium text-foreground'>Flag</th>
                        <th className='py-3 pr-4 font-mono text-sm font-medium text-foreground'>Value</th>
                        <th className='py-3 pr-4 font-mono text-sm font-medium text-foreground'>Default</th>
                        <th className='py-3 font-mono text-sm font-medium text-foreground'>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className='border-b border-border/60'>
                        <td className='py-3 pr-4 font-mono text-sm text-foreground'>--output &lt;dir&gt;</td>
                        <td className='py-3 pr-4 text-sm font-serif text-muted-foreground'>path</td>
                        <td className='py-3 pr-4 font-mono text-sm text-muted-foreground'>public</td>
                        <td className='py-3 font-serif text-sm leading-relaxed text-muted-foreground'>
                          Write the built site to this directory.
                        </td>
                      </tr>
                      <tr className='border-b border-border/60'>
                        <td className='py-3 pr-4 font-mono text-sm text-foreground'>--drafts</td>
                        <td className='py-3 pr-4 text-sm font-serif text-muted-foreground'>none</td>
                        <td className='py-3 pr-4 font-mono text-sm text-muted-foreground'>false</td>
                        <td className='py-3 font-serif text-sm leading-relaxed text-muted-foreground'>
                          Include pages with draft: true in their front matter.
                        </td>
                      </tr>
                      <tr className='border-b border-border/60'>
                        <td className='py-3 pr-4 font-mono text-sm text-foreground'>--quiet</td>
                        <td className='py-3 pr-4 text-sm font-serif text-muted-foreground'>none</td>
                        <td className='py-3 pr-4 font-mono text-sm text-muted-foreground'>false</td>
                        <td className='py-3 font-serif text-sm leading-relaxed text-muted-foreground'>
                          Suppress the progress output.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className='mt-6 space-y-6'>
                  <CodeBlock
                    code={`$ mantle build
Compiling 42 pages...
Writing public/index.html
Writing public/about/index.html
Done in 1.2s`}
                    language='shell'
                    filename='terminal'
                  />
                  <CodeBlock code={`mantle build --drafts`} language='shell' filename='terminal' />
                </div>
              </section>

              <section id='serve'>
                <motion.h2
                  className='font-display text-3xl font-semibold tracking-tight text-foreground'
                  initial='hidden'
                  whileInView='show'
                  viewport={{ once: true, amount: 0.3 }}
                  variants={fadeScale}
                >
                  mantle serve
                </motion.h2>
                <p className='mt-4 font-mono text-base text-foreground'>mantle serve [flags]</p>
                <p className='mt-4 font-serif text-lg leading-relaxed text-muted-foreground'>
                  Starts a local development server and watches the project for
                  changes. Rebuilds affected pages when a source file changes.
                </p>
                <div className='mt-6 overflow-x-auto'>
                  <table className='w-full border-collapse text-left'>
                    <thead>
                      <tr className='border-b border-border'>
                        <th className='py-3 pr-4 font-mono text-sm font-medium text-foreground'>Flag</th>
                        <th className='py-3 pr-4 font-mono text-sm font-medium text-foreground'>Value</th>
                        <th className='py-3 pr-4 font-mono text-sm font-medium text-foreground'>Default</th>
                        <th className='py-3 font-mono text-sm font-medium text-foreground'>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className='border-b border-border/60'>
                        <td className='py-3 pr-4 font-mono text-sm text-foreground'>--port &lt;number&gt;</td>
                        <td className='py-3 pr-4 text-sm font-serif text-muted-foreground'>number</td>
                        <td className='py-3 pr-4 font-mono text-sm text-muted-foreground'>3000</td>
                        <td className='py-3 font-serif text-sm leading-relaxed text-muted-foreground'>
                          Port to listen on.
                        </td>
                      </tr>
                      <tr className='border-b border-border/60'>
                        <td className='py-3 pr-4 font-mono text-sm text-foreground'>--host &lt;address&gt;</td>
                        <td className='py-3 pr-4 text-sm font-serif text-muted-foreground'>string</td>
                        <td className='py-3 pr-4 font-mono text-sm text-muted-foreground'>localhost</td>
                        <td className='py-3 font-serif text-sm leading-relaxed text-muted-foreground'>
                          Hostname or IP address to bind.
                        </td>
                      </tr>
                      <tr className='border-b border-border/60'>
                        <td className='py-3 pr-4 font-mono text-sm text-foreground'>--open</td>
                        <td className='py-3 pr-4 text-sm font-serif text-muted-foreground'>none</td>
                        <td className='py-3 pr-4 font-mono text-sm text-muted-foreground'>false</td>
                        <td className='py-3 font-serif text-sm leading-relaxed text-muted-foreground'>
                          Open the browser after the server starts.
                        </td>
                      </tr>
                      <tr className='border-b border-border/60'>
                        <td className='py-3 pr-4 font-mono text-sm text-foreground'>--no-watch</td>
                        <td className='py-3 pr-4 text-sm font-serif text-muted-foreground'>none</td>
                        <td className='py-3 pr-4 font-mono text-sm text-muted-foreground'>false</td>
                        <td className='py-3 font-serif text-sm leading-relaxed text-muted-foreground'>
                          Disable file watching and rebuild only on request.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className='mt-6'>
                  <CodeBlock code={`mantle serve --port 8080`} language='shell' filename='terminal' />
                </div>
              </section>

              <section id='clean'>
                <motion.h2
                  className='font-display text-3xl font-semibold tracking-tight text-foreground'
                  initial='hidden'
                  whileInView='show'
                  viewport={{ once: true, amount: 0.3 }}
                  variants={fadeScale}
                >
                  mantle clean
                </motion.h2>
                <p className='mt-4 font-mono text-base text-foreground'>mantle clean [flags]</p>
                <p className='mt-4 font-serif text-lg leading-relaxed text-muted-foreground'>
                  Deletes the build output directory without touching source
                  files. Use it before a build to remove stale pages.
                </p>
                <div className='mt-6 overflow-x-auto'>
                  <table className='w-full border-collapse text-left'>
                    <thead>
                      <tr className='border-b border-border'>
                        <th className='py-3 pr-4 font-mono text-sm font-medium text-foreground'>Flag</th>
                        <th className='py-3 pr-4 font-mono text-sm font-medium text-foreground'>Value</th>
                        <th className='py-3 pr-4 font-mono text-sm font-medium text-foreground'>Default</th>
                        <th className='py-3 font-mono text-sm font-medium text-foreground'>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className='border-b border-border/60'>
                        <td className='py-3 pr-4 font-mono text-sm text-foreground'>--output &lt;dir&gt;</td>
                        <td className='py-3 pr-4 text-sm font-serif text-muted-foreground'>path</td>
                        <td className='py-3 pr-4 font-mono text-sm text-muted-foreground'>public</td>
                        <td className='py-3 font-serif text-sm leading-relaxed text-muted-foreground'>
                          Directory to delete. Must match the build output.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className='mt-6'>
                  <CodeBlock code={`mantle clean`} language='shell' filename='terminal' />
                </div>
              </section>

              <section id='exit-codes'>
                <motion.h2
                  className='font-display text-3xl font-semibold tracking-tight text-foreground'
                  initial='hidden'
                  whileInView='show'
                  viewport={{ once: true, amount: 0.3 }}
                  variants={fadeScale}
                >
                  Exit codes
                </motion.h2>
                <p className='mt-4 font-serif text-lg leading-relaxed text-muted-foreground'>
                  Mantle exits with one of the following codes. A zero exit
                  means success; any other code indicates failure.
                </p>
                <div className='mt-6 overflow-x-auto'>
                  <table className='w-full border-collapse text-left'>
                    <thead>
                      <tr className='border-b border-border'>
                        <th className='py-3 pr-4 font-mono text-sm font-medium text-foreground'>Code</th>
                        <th className='py-3 font-mono text-sm font-medium text-foreground'>Meaning</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className='border-b border-border/60'>
                        <td className='py-3 pr-4 font-mono text-sm text-foreground'>0</td>
                        <td className='py-3 font-serif text-sm leading-relaxed text-muted-foreground'>
                          Success; the command completed without errors.
                        </td>
                      </tr>
                      <tr className='border-b border-border/60'>
                        <td className='py-3 pr-4 font-mono text-sm text-foreground'>1</td>
                        <td className='py-3 font-serif text-sm leading-relaxed text-muted-foreground'>
                          Build failed; a template, Markdown, or link error stopped the build.
                        </td>
                      </tr>
                      <tr className='border-b border-border/60'>
                        <td className='py-3 pr-4 font-mono text-sm text-foreground'>2</td>
                        <td className='py-3 font-serif text-sm leading-relaxed text-muted-foreground'>
                          Invalid usage; the command or flags were not recognized.
                        </td>
                      </tr>
                      <tr className='border-b border-border/60'>
                        <td className='py-3 pr-4 font-mono text-sm text-foreground'>3</td>
                        <td className='py-3 font-serif text-sm leading-relaxed text-muted-foreground'>
                          Configuration error; mantle.config.js is malformed or missing a required field.
                        </td>
                      </tr>
                      <tr className='border-b border-border/60'>
                        <td className='py-3 pr-4 font-mono text-sm text-foreground'>4</td>
                        <td className='py-3 font-serif text-sm leading-relaxed text-muted-foreground'>
                          File system error; a file could not be read or written.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            </main>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
