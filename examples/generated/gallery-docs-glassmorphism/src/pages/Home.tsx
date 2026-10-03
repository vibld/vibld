import { motion, type Variants } from 'motion/react';
import { ArrowRight, Terminal } from 'lucide-react';
import GlassPanel from '@/components/GlassPanel';
import CodeBlock from '@/components/CodeBlock';
import { glassMaterialize, rise, staggerContainer } from '@/lib/motion';

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

const solidMaterialize: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.96,
    filter: 'blur(12px)',
  },
  show: {
    opacity: 1,
    scale: 1,
    filter: 'blur(0px)',
    transition: {
      duration: 0.25,
      ease: EASE_OUT,
    },
  },
};

const features = [
  {
    title: 'One command to a running app',
    body: 'Chisel pulls your template, installs dependencies, and starts the dev server. You go from empty folder to working app in under a minute.',
    span: 'md:col-span-2',
  },
  {
    title: 'Templates in any language',
    body: 'Define templates with plain files and a simple manifest. Works for JavaScript, Python, Go, Rust, and anything else you can put in a folder.',
    span: 'md:col-span-1',
  },
  {
    title: 'Git-friendly by default',
    body: 'Chisel initializes a git repository, creates a .gitignore, and makes an initial commit unless you ask it not to.',
    span: 'md:col-span-1',
  },
  {
    title: 'Extend with plugins',
    body: 'Add hooks to run after scaffolding, transform files, or prompt for variables. The plugin API is small and documented in the reference.',
    span: 'md:col-span-2',
  },
];

const commands = [
  {
    term: 'chisel new',
    definition: 'Create a new project from a template.',
  },
  {
    term: 'chisel add',
    definition: 'Add a file or dependency to an existing project.',
  },
  {
    term: 'chisel list',
    definition: 'Show available templates and plugins.',
  },
];

const nextSteps = [
  {
    title: 'Read the installation guide',
    body: 'Covers system requirements, package managers, and troubleshooting.',
    href: '#/install',
    linkText: 'Go to installation',
  },
  {
    title: 'Try the quick start',
    body: 'Build a small project step by step to learn the workflow.',
    href: '#/quick-start',
    linkText: 'Go to quick start',
  },
];

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pt-16 pb-24 lg:pt-24 lg:pb-32">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <motion.div variants={staggerContainer} initial="hidden" animate="show">
            <motion.h1
              variants={rise}
              className="font-display text-[clamp(3rem,6vw,5.5rem)] leading-[1.1] tracking-[-0.03em] text-foreground text-balance"
            >
              Scaffold projects from templates in one command.
            </motion.h1>
            <motion.p
              variants={rise}
              className="mt-6 text-lg text-muted-foreground leading-1.6"
            >
              Chisel is an open-source code generator that turns your templates into ready-to-run projects, no setup required.
            </motion.p>
            <motion.div variants={rise} className="mt-8 flex flex-wrap gap-4">
              <motion.a
                href="#/install"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-base font-medium text-primary-foreground cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Get started
                <ArrowRight className="size-4" aria-hidden="true" />
              </motion.a>
              <motion.a
                href="#/commands"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                className="inline-flex items-center gap-2 rounded-md bg-muted/60 px-6 py-3 text-base font-medium text-foreground border border-border cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted"
              >
                View commands
                <Terminal className="size-4" aria-hidden="true" />
              </motion.a>
            </motion.div>
          </motion.div>
          <GlassPanel delay={0.2} className="p-4">
            <CodeBlock code="$ chisel new my-app --template next.js\n✔ Template downloaded\n✔ Dependencies installed\n✔ Project ready in my-app/" />
          </GlassPanel>
        </div>
      </section>

      {/* Features bento */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-6"
        >
          {features.map((feature) => (
            <motion.div
              key={feature.title}
              variants={glassMaterialize}
              className={`glass-panel rounded-glass p-6 ${feature.span}`}
            >
              <h3 className="font-display text-2xl font-semibold text-foreground">
                {feature.title}
              </h3>
              <p className="mt-3 text-muted-foreground">{feature.body}</p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* Install section */}
      <section className="mx-auto max-w-3xl px-6 py-24 text-center">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.5, ease: EASE_OUT }}
          className="font-display text-[clamp(2rem,4vw,3rem)] leading-[1.2] tracking-[-0.02em] text-foreground"
        >
          Install Chisel
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.1 }}
          className="mt-4 text-muted-foreground"
        >
          You need Node.js 18 or newer. Then install globally with npm or use Homebrew on macOS.
        </motion.p>
        <div className="mt-8 space-y-4 text-left">
          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            variants={solidMaterialize}
          >
            <CodeBlock code="npm install -g chisel-cli" />
          </motion.div>
          <motion.div
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            variants={solidMaterialize}
          >
            <CodeBlock code="brew install chisel" />
          </motion.div>
        </div>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.2 }}
          className="mt-4 text-muted-foreground"
        >
          Verify the installation by running <code className="font-mono text-sm">chisel --version</code>.
        </motion.p>
      </section>

      {/* Command preview */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.5, ease: EASE_OUT }}
          className="font-display text-[clamp(2rem,4vw,3rem)] leading-[1.2] tracking-[-0.02em] text-foreground mb-8"
        >
          Commands you will use daily
        </motion.h2>
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-6"
        >
          {commands.map((cmd) => (
            <motion.div
              key={cmd.term}
              variants={glassMaterialize}
              className="glass-panel rounded-glass p-6"
            >
              <code className="font-mono text-sm text-primary">{cmd.term}</code>
              <p className="mt-2 text-muted-foreground">{cmd.definition}</p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* Next steps */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, amount: 0.2 }}
          className="grid grid-cols-1 md:grid-cols-2 gap-6"
        >
          {nextSteps.map((step) => (
            <motion.div
              key={step.title}
              variants={glassMaterialize}
              className="glass-panel rounded-glass p-6"
            >
              <h3 className="font-display text-2xl font-semibold text-foreground">
                {step.title}
              </h3>
              <p className="mt-3 text-muted-foreground">{step.body}</p>
              <a
                href={step.href}
                className="mt-4 inline-flex items-center gap-2 text-primary font-medium hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md cursor-pointer"
              >
                {step.linkText}
                <ArrowRight className="size-4" aria-hidden="true" />
              </a>
            </motion.div>
          ))}
        </motion.div>
      </section>
    </>
  );
}
