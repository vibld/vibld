import GlassPanel from '@/components/GlassPanel';
import CodeBlock from '@/components/CodeBlock';

export default function Installation() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <GlassPanel className="p-8 md:p-12">
        <h1 className="font-display text-[clamp(2.5rem,5vw,4rem)] leading-[1.2] tracking-[-0.02em] text-foreground">
          Install Chisel
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Chisel runs anywhere Node.js runs. It needs Node.js 18 or newer, and either npm or Homebrew to install.
        </p>

        <section className="mt-12">
          <h2 className="font-display text-2xl font-semibold text-foreground">Prerequisites</h2>
          <ul className="mt-4 space-y-2 text-muted-foreground">
            <li>
              Node.js 18 or newer. Check with{' '}
              <code className="font-mono text-sm">node --version</code>.
            </li>
            <li>
              npm 9 or newer, which ships with Node.js, or Homebrew on macOS.
            </li>
          </ul>
        </section>

        <section className="mt-12">
          <h2 className="font-display text-2xl font-semibold text-foreground">Install with npm</h2>
          <p className="mt-4 text-muted-foreground">
            Install Chisel globally so the chisel command is available in any terminal.
          </p>
          <div className="mt-4">
            <CodeBlock code="npm install -g chisel-cli" />
          </div>
        </section>

        <section className="mt-12">
          <h2 className="font-display text-2xl font-semibold text-foreground">Install with Homebrew</h2>
          <p className="mt-4 text-muted-foreground">
            On macOS, install from the official Homebrew tap.
          </p>
          <div className="mt-4">
            <CodeBlock code="brew install chisel" />
          </div>
        </section>

        <section className="mt-12">
          <h2 className="font-display text-2xl font-semibold text-foreground">Verify the installation</h2>
          <p className="mt-4 text-muted-foreground">
            Run the version command to confirm Chisel is available.
          </p>
          <div className="mt-4">
            <CodeBlock code="chisel --version" />
          </div>
        </section>

        <section className="mt-12">
          <h2 className="font-display text-2xl font-semibold text-foreground">Troubleshooting</h2>
          <div className="mt-4 space-y-4 text-muted-foreground">
            <p>
              If the chisel command is not found, check that your global npm bin directory is in your PATH. On macOS with Homebrew, restart your terminal after installing.
            </p>
            <p>
              If you see an EACCES permissions error with npm, use a Node version manager like nvm or fnm, or install with Homebrew.
            </p>
            <p>
              If Homebrew cannot find the formula, run brew update and try again.
            </p>
          </div>
        </section>
      </GlassPanel>
    </div>
  );
}
