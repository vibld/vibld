import { motion } from 'motion/react';
import CodeBlock from '@/components/CodeBlock';
import { fadeIn } from '@/lib/motion';

export default function Installation() {
  return (
    <motion.div variants={fadeIn} initial="hidden" animate="show" className="pt-12 pb-20">
      <h1 className="font-display text-display font-semibold leading-tight tracking-tight">Installation</h1>
      <p className="mt-4 text-body text-muted-foreground">
        Install Basalt on macOS, Linux, or Windows. The whole process takes about a minute.
      </p>

      <h2 className="mt-12 text-h2 font-semibold tracking-tight">macOS</h2>
      <p className="mt-2 text-body text-muted-foreground">Use Homebrew to install Basalt.</p>
      <CodeBlock language="bash" code="brew install basalt" className="mt-4" />

      <h2 className="mt-12 text-h2 font-semibold tracking-tight">Linux</h2>
      <p className="mt-2 text-body text-muted-foreground">Run the install script.</p>
      <CodeBlock language="bash" code="curl -fsSL https://basalt.dev/install.sh | sh" className="mt-4" />

      <h2 className="mt-12 text-h2 font-semibold tracking-tight">Windows</h2>
      <p className="mt-2 text-body text-muted-foreground">Use winget to install Basalt.</p>
      <CodeBlock language="powershell" code="winget install Basalt.Basalt" className="mt-4" />

      <h2 className="mt-12 text-h2 font-semibold tracking-tight">Verify the installation</h2>
      <p className="mt-2 text-body text-muted-foreground">Check the version to confirm Basalt is on your PATH.</p>
      <CodeBlock language="bash" code="basalt --version" className="mt-4" />
      <p className="mt-2 text-body text-muted-foreground">The command prints something like basalt 1.4.2.</p>

      <h2 className="mt-12 text-h2 font-semibold tracking-tight">Next steps</h2>
      <p className="mt-2 text-body text-muted-foreground">
        Run basalt --help to see all commands, or follow the quick start to build a site.
      </p>
    </motion.div>
  );
}
