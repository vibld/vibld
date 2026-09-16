import { AdminPanel } from './components/AdminPanel.tsx';
import { Conversation } from './components/Conversation.tsx';
import { KnowledgePanel } from './components/KnowledgePanel.tsx';
import { StyleDnaPanel } from './components/StyleDnaPanel.tsx';
import { describeMode } from './generation/labels.ts';
import { saveStyleDna } from './generation/style-dna-store.ts';
import { saveKnowledge } from './generation/knowledge-store.ts';
import { LifecycleBar } from './components/LifecycleBar.tsx';
import { PromptPanel } from './components/PromptPanel.tsx';
import { Workspace } from './components/Workspace.tsx';
import { useBuilderSession } from './useBuilderSession.ts';
import { AuthGate, AuthStatus } from './auth/clerk.tsx';
import { BillingStatusWidget } from './components/BillingStatus.tsx';
import { GitHubPanel } from './components/GitHubPanel.tsx';

/**
 * `AuthGate` is the outermost piece deliberately: `Builder` -- and the
 * `useBuilderSession` probe it mounts -- must not exist at all while signed
 * out, not just render behind a gate. Splitting it out of `App` is what
 * makes that mount conditional instead of the gate wrapping an
 * already-running session.
 */
export function App() {
  return (
    <AuthGate>
      <Builder />
    </AuthGate>
  );
}

function Builder() {
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
        {/*
          This said "deterministic fake provider - no model credentials"
          unconditionally, which stopped being true the moment the hosted
          Worker started generating. A header that misdescribes what just ran
          is worse than no header, so it now reports what actually served the
          last run and claims nothing before there has been one.
        */}
        <p className="shell__mode">{describeMode(state.providerId)}</p>
        <BillingStatusWidget />
        {/*
          In the header rather than beside Publish, because this is also
          where GitHub lands. The callback puts its code and state in the
          fragment and redirects here, so whatever handles that has to mount
          on every page load; behind a workspace tab it would only run if
          somebody happened to open the right one.
        */}
        <GitHubPanel />
        <AuthStatus />
      </header>

      <main className="shell__body">
        <section className="column column--left" aria-label="Conversation">
          <Conversation state={state} />
          <div className="composer">
            <LifecycleBar status={state.status} />
            <KnowledgePanel
              knowledge={state.knowledge}
              disabled={state.running}
              onChange={(value) => {
                session.setKnowledge(value);
                saveKnowledge(value);
              }}
            />
            <StyleDnaPanel
              styleDna={state.styleDna}
              disabled={state.running}
              onChange={(value) => {
                session.setStyleDna(value);
                saveStyleDna(value);
              }}
            />
            {state.isAdmin ? <AdminPanel /> : null}
            <PromptPanel
              state={state}
              onSubmit={(prompt, mode, style, referenceUrl) => {
                void session.submit(prompt, mode, style, referenceUrl);
              }}
              onReset={() => session.reset()}
              onCancel={() => session.cancel()}
              onModelChange={(model) => session.setModel(model)}
            />
          </div>
        </section>

        <Workspace state={state} />
      </main>

      <footer className="shell__footer">
        <span>
          Runs: {state.runCount} · Provider: {state.providerId ?? 'not run yet'}{' '}
          · Model tokens: {usage.modelInputTokens} in /{' '}
          {usage.modelOutputTokens} out
        </span>
        {/*
          This used to say that sandbox execution, real providers, Git export
          and deployment were not implemented. All four shipped, and the line
          stayed, so the app spent weeks denying the features somebody was
          using while reading it. What is left here is the part that is still
          true, and nothing else.
        */}
        <span>
          Preview shows a local mock until you run the project in the sandbox.
          The console shows generation events, not sandbox output.
        </span>
      </footer>
    </div>
  );
}
