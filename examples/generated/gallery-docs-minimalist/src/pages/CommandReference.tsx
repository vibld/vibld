import { motion } from 'motion/react';
import { fadeIn } from '@/lib/motion';

type Command = {
  name: string;
  description: string;
  flags: string;
  exitCodes: string;
};

const commands: Command[] = [
  {
    name: 'basalt init [directory]',
    description: 'Create a new site in the given directory, or the current directory if none is given.',
    flags: '--template <name>  Use a starter template. Available: default, blog.',
    exitCodes: '0 success, 1 directory exists or invalid template.',
  },
  {
    name: 'basalt dev',
    description: 'Start a local development server that rebuilds on file changes.',
    flags: '--port <number>  Port to listen on (default 3000). --host <address>  Host to bind (default localhost).',
    exitCodes: '0 started, 1 port in use or bad config.',
  },
  {
    name: 'basalt build',
    description: 'Build the site into the output directory.',
    flags: '--output <path>  Output directory (default _site).',
    exitCodes: '0 success, 1 build error.',
  },
  {
    name: 'basalt serve',
    description: 'Serve the built site from the output directory without rebuilding.',
    flags: '--port <number>  Port to listen on (default 3000).',
    exitCodes: '0 started, 1 missing output or port in use.',
  },
  {
    name: 'basalt clean',
    description: 'Remove the output directory and any cached data.',
    flags: 'None.',
    exitCodes: '0 success, 1 permission denied.',
  },
  {
    name: 'basalt new <path>',
    description: 'Create a new content file at the given path, including frontmatter.',
    flags: '--title <text>  Set the title in frontmatter.',
    exitCodes: '0 created, 1 path exists or invalid.',
  },
  {
    name: 'basalt version',
    description: 'Print the installed version.',
    flags: 'None.',
    exitCodes: '0 success.',
  },
  {
    name: 'basalt help [command]',
    description: 'Show help for a command.',
    flags: 'None.',
    exitCodes: '0 success, 1 unknown command.',
  },
];

export default function CommandReference() {
  return (
    <motion.div variants={fadeIn} initial="hidden" animate="show" className="pt-12 pb-20">
      <h1 className="font-display text-display font-semibold leading-tight tracking-tight">Command reference</h1>
      <p className="mt-4 text-body text-muted-foreground">
        Every Basalt command, flag, and exit code, listed.
      </p>

      <div className="mt-12 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left text-body">
          <thead>
            <tr className="border-b border-border">
              <th className="py-3 pr-4 text-small font-semibold text-muted-foreground">Command</th>
              <th className="py-3 pr-4 text-small font-semibold text-muted-foreground">Description</th>
              <th className="py-3 pr-4 text-small font-semibold text-muted-foreground">Flags</th>
              <th className="py-3 text-small font-semibold text-muted-foreground">Exit codes</th>
            </tr>
          </thead>
          <tbody>
            {commands.map((command) => (
              <tr key={command.name} className="border-b border-border align-top">
                <td className="py-4 pr-4">
                  <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-sm text-foreground">{command.name}</code>
                </td>
                <td className="py-4 pr-4 text-body text-muted-foreground">{command.description}</td>
                <td className="py-4 pr-4 text-body text-muted-foreground">
                  {command.flags.split('  ').map((flag, index, arr) => (
                    <span key={index}>
                      <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-sm text-foreground">{flag.trim()}</code>
                      {index < arr.length - 1 && <br />}
                    </span>
                  ))}
                </td>
                <td className="py-4 text-body text-muted-foreground">{command.exitCodes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
