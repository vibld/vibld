import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import CodeBlock from '@/components/CodeBlock';
import { fadeIn } from '@/lib/motion';

const createPageCode = `---
title: Home
---

# Hello, world.

This is your first Basalt page.`;

export default function QuickStart() {
  return (
    <motion.div variants={fadeIn} initial="hidden" animate="show" className="pt-12 pb-20">
      <h1 className="font-display text-display font-semibold leading-tight tracking-tight">Quick start</h1>
      <p className="mt-4 text-body text-muted-foreground">
        Build your first Basalt site from a directory of Markdown files. This guide takes about five minutes.
      </p>

      <h2 className="mt-12 text-h2 font-semibold tracking-tight">Create a new site</h2>
      <p className="mt-2 text-body text-muted-foreground">
        Run the init command to create a new project in a directory called my-site.
      </p>
      <CodeBlock language="bash" code="basalt init my-site" className="mt-4" />

      <h2 className="mt-12 text-h2 font-semibold tracking-tight">Go into the directory</h2>
      <p className="mt-2 text-body text-muted-foreground">Change to the new project directory.</p>
      <CodeBlock language="bash" code="cd my-site" className="mt-4" />

      <h2 className="mt-12 text-h2 font-semibold tracking-tight">Write a page</h2>
      <p className="mt-2 text-body text-muted-foreground">
        Create a file called index.md with the frontmatter title and some Markdown.
      </p>
      <CodeBlock language="markdown" code={createPageCode} className="mt-4" />

      <h2 className="mt-12 text-h2 font-semibold tracking-tight">Start the dev server</h2>
      <p className="mt-2 text-body text-muted-foreground">
        Basalt serves your site at localhost:3000 and rebuilds when you change a file.
      </p>
      <CodeBlock language="bash" code="basalt dev" className="mt-4" />

      <h2 className="mt-12 text-h2 font-semibold tracking-tight">Build for production</h2>
      <p className="mt-2 text-body text-muted-foreground">
        The build output goes to the _site directory by default.
      </p>
      <CodeBlock language="bash" code="basalt build" className="mt-4" />

      <h2 className="mt-12 text-h2 font-semibold tracking-tight">Next steps</h2>
      <p className="mt-2 text-body text-muted-foreground">
        Read the <Link to="/commands" className="text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm">command reference</Link> for a full list of commands, or edit src/pages/index.md to change your homepage.
      </p>
    </motion.div>
  );
}
