import GlassPanel from '@/components/GlassPanel';
import CodeBlock from '@/components/CodeBlock';

export default function QuickStart() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <GlassPanel className="p-8 md:p-12">
        <h1 className="font-display text-[clamp(2.5rem,5vw,4rem)] leading-[1.2] tracking-[-0.02em] text-foreground">
          Quick start
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Build a small project step by step to learn the workflow.
        </p>

        <section className="mt-12 space-y-6">
          <GlassPanel className="p-6">
            <div className="flex items-start gap-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-mono text-sm">
                1
              </span>
              <div>
                <h2 className="font-display text-xl font-semibold text-foreground">
                  Create a new project
                </h2>
                <p className="mt-2 text-muted-foreground">
                  Scaffold a Next.js blog from the official template.
                </p>
                <div className="mt-4">
                  <CodeBlock code="$ chisel new my-blog --template next.js\n✔ Template downloaded\n✔ Dependencies installed\n✔ Project ready in my-blog/" />
                </div>
              </div>
            </div>
          </GlassPanel>

          <GlassPanel className="p-6">
            <div className="flex items-start gap-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-mono text-sm">
                2
              </span>
              <div>
                <h2 className="font-display text-xl font-semibold text-foreground">
                  Move into the project directory
                </h2>
                <p className="mt-2 text-muted-foreground">
                  Change to the newly created folder.
                </p>
                <div className="mt-4">
                  <CodeBlock code="$ cd my-blog" />
                </div>
              </div>
            </div>
          </GlassPanel>

          <GlassPanel className="p-6">
            <div className="flex items-start gap-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-mono text-sm">
                3
              </span>
              <div>
                <h2 className="font-display text-xl font-semibold text-foreground">
                  Start the development server
                </h2>
                <p className="mt-2 text-muted-foreground">
                  Chisel starts the dev server and opens the app in your browser.
                </p>
                <div className="mt-4">
                  <CodeBlock code="$ chisel dev\n✔ Dev server running at http://localhost:3000" />
                </div>
              </div>
            </div>
          </GlassPanel>

          <GlassPanel className="p-6">
            <div className="flex items-start gap-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-mono text-sm">
                4
              </span>
              <div>
                <h2 className="font-display text-xl font-semibold text-foreground">
                  Add a component
                </h2>
                <p className="mt-2 text-muted-foreground">
                  Add a button component from the template library.
                </p>
                <div className="mt-4">
                  <CodeBlock code="$ chisel add component button\n✔ Component button added to src/components/button.tsx" />
                </div>
              </div>
            </div>
          </GlassPanel>

          <GlassPanel className="p-6">
            <div className="flex items-start gap-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-mono text-sm">
                5
              </span>
              <div>
                <h2 className="font-display text-xl font-semibold text-foreground">
                  List available templates
                </h2>
                <p className="mt-2 text-muted-foreground">
                  See what other project templates you can use.
                </p>
                <div className="mt-4">
                  <CodeBlock code="$ chisel list\nnext.js\nastro\nvite-react\nvue" />
                </div>
              </div>
            </div>
          </GlassPanel>
        </section>
      </GlassPanel>
    </div>
  );
}
