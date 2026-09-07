import { LifecycleBar } from './components/LifecycleBar.tsx';
import { PromptPanel } from './components/PromptPanel.tsx';
import { StatusBanner } from './components/StatusBanner.tsx';
import { Workspace } from './components/Workspace.tsx';
import { useBuilderSession } from './useBuilderSession.ts';

export function App() {
  const { session, state } = useBuilderSession();
  const usage = state.budget.used;

  return (
    <div className="shell">
      <header className="shell__header">
        <div className="shell__brand">
          <span className="shell__logo" aria-hidden="true">
            ~
          </span>
          <div>
            <p className="shell__name">Vibld</p>
            <p className="shell__tagline">Vibe. Build. Ship.</p>
          </div>
        </div>
        <p
          className="shell__mode"
          title="This shell runs entirely in your browser"
        >
          Local preview build · deterministic fake provider · no model
          credentials
        </p>
      </header>

      <main className="shell__body">
        <section className="column column--left" aria-label="Prompt and plan">
          <StatusBanner state={state} />
          <LifecycleBar status={state.status} />
          <PromptPanel
            state={state}
            onSubmit={(prompt, mode) => {
              void session.submit(prompt, mode);
            }}
            onReset={() => session.reset()}
          />
        </section>

        <Workspace state={state} />
      </main>

      <footer className="shell__footer">
        <span>
          Runs: {state.runCount} · Model tokens: {usage.modelInputTokens} in /{' '}
          {usage.modelOutputTokens} out
        </span>
        <span>
          Preview and console are local mocks. Sandbox execution, real
          providers, Git export and deployment are not implemented yet.
        </span>
      </footer>
    </div>
  );
}
