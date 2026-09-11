import { Conversation } from './components/Conversation.tsx';
import { KnowledgePanel } from './components/KnowledgePanel.tsx';
import { describeMode } from './generation/labels.ts';
import { saveKnowledge } from './generation/knowledge-store.ts';
import { LifecycleBar } from './components/LifecycleBar.tsx';
import { PromptPanel } from './components/PromptPanel.tsx';
import { Workspace } from './components/Workspace.tsx';
import { useBuilderSession } from './useBuilderSession.ts';
import { AuthStatus } from './auth/clerk.tsx';
import { BillingStatusWidget } from './components/BillingStatus.tsx';

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
        {/*
          This said "deterministic fake provider - no model credentials"
          unconditionally, which stopped being true the moment the hosted
          Worker started generating. A header that misdescribes what just ran
          is worse than no header, so it now reports what actually served the
          last run and claims nothing before there has been one.
        */}
        <p className="shell__mode">{describeMode(state.providerId)}</p>
        <BillingStatusWidget />
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
            <PromptPanel
              state={state}
              onSubmit={(prompt, mode, style) => {
                void session.submit(prompt, mode, style);
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
        <span>
          Preview and console are local mocks. Sandbox execution, real
          providers, Git export and deployment are not implemented yet.
        </span>
      </footer>
    </div>
  );
}
