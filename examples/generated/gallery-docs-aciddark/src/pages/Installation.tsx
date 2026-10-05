import { CodeBlock } from '@/components/CodeBlock';

export default function Installation() {
  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight">Installation</h1>
      <p className="mt-4 text-lg text-muted-foreground">
        Install the Ion CLI binary on macOS, Linux, or Windows. The entire tool is under 15 MB.
      </p>

      <h2 className="mt-12 font-display text-2xl font-semibold tracking-tight">System requirements</h2>
      <ul className="mt-4 space-y-2 text-muted-foreground">
        <li>macOS 12 or later, Linux x64 or arm64, Windows 10 or later</li>
        <li>512 MB of free memory</li>
        <li>25 MB of disk space</li>
        <li>No Node.js, Python, or other runtimes required</li>
      </ul>

      <h2 className="mt-12 font-display text-2xl font-semibold tracking-tight">Install with npm</h2>
      <p className="mt-4 text-muted-foreground">
        The npm package wraps the prebuilt binary and adds it to your PATH.
      </p>
      <CodeBlock className="mt-4" code={`npm install -g ion-cli`} filename="terminal" />

      <h2 className="mt-12 font-display text-2xl font-semibold tracking-tight">Install with Homebrew</h2>
      <p className="mt-4 text-muted-foreground">On macOS or Linux with Homebrew:</p>
      <CodeBlock className="mt-4" code={`brew install ion-cli`} filename="terminal" />

      <h2 className="mt-12 font-display text-2xl font-semibold tracking-tight">Install with curl</h2>
      <p className="mt-4 text-muted-foreground">
        The installer downloads the correct binary for your platform and puts it in ~/.ion/bin.
      </p>
      <CodeBlock className="mt-4" code={`curl -fsSL https://ion.sh/install | sh`} filename="terminal" />

      <h2 className="mt-12 font-display text-2xl font-semibold tracking-tight">Install manually</h2>
      <p className="mt-4 text-muted-foreground">
        Download the binary from the releases page, extract it, and move it into a directory on your PATH.
      </p>
      <CodeBlock
        className="mt-4"
        code={`# example for Linux x64\ncurl -L -o ion.tar.gz https://github.com/ion-cli/ion/releases/download/v1.4.2/ion-linux-x64.tar.gz\ntar -xzf ion.tar.gz\nsudo mv ion /usr/local/bin/`}
        filename="terminal"
      />

      <h2 className="mt-12 font-display text-2xl font-semibold tracking-tight">Verify the install</h2>
      <p className="mt-4 text-muted-foreground">Check the installed version:</p>
      <CodeBlock className="mt-4" code={`ion --version`} filename="terminal" />
      <p className="mt-2 text-muted-foreground">The output should be:</p>
      <CodeBlock className="mt-4" code={`ion 1.4.2`} filename="terminal output" />

      <h2 className="mt-12 font-display text-2xl font-semibold tracking-tight">Uninstall</h2>
      <p className="mt-4 text-muted-foreground">
        Remove Ion with the method that matches your installation.
      </p>
      <CodeBlock
        className="mt-4"
        code={`# npm\nnpm uninstall -g ion-cli\n\n# Homebrew\nbrew uninstall ion-cli\n\n# manual\nsudo rm /usr/local/bin/ion`}
        filename="terminal"
      />
    </div>
  );
}
