import { AdminPanel } from './components/AdminPanel.tsx';
import { InvitePanel } from './components/InvitePanel.tsx';
import { AccessGate } from './components/AccessGate.tsx';
import { Mark, WORDMARK } from './components/Mark.tsx';
import { Conversation } from './components/Conversation.tsx';
import { KnowledgePanel } from './components/KnowledgePanel.tsx';
import { StyleDnaPanel } from './components/StyleDnaPanel.tsx';
import { SettingsMenu } from './components/SettingsMenu.tsx';
import { BillingStatusWidget } from './components/BillingStatus.tsx';
import { GitHubPanel } from './components/GitHubPanel.tsx';
import { describeMode } from './generation/labels.ts';
import { ThemeToggle } from './components/ThemeToggle.tsx';
import { footerNote } from './generation/pane-gaps.ts';
import { saveStyleDna } from './generation/style-dna-store.ts';
import { saveKnowledge } from './generation/knowledge-store.ts';
import { LifecycleBar } from './components/LifecycleBar.tsx';
import { PromptPanel } from './components/PromptPanel.tsx';
import { Workspace } from './components/Workspace.tsx';
import { useBuilderSession } from './useBuilderSession.ts';
import { AuthGate, AuthStatus } from './auth/clerk.tsx';

/**
 * `AuthGate` is the outermost piece deliberately: `Builder` -- and the
 * `useBuilderSession` probe it mounts -- must not exist at all while signed
 * out, not just render behind a gate. Splitting it out of `App` is what
 * makes that mount conditional instead of the gate wrapping an
 * already-running session.
 *
 * `AccessGate` sits inside it for the same reason and answers the next
 * question: signed in, but is this account on the invite list. Two gates
 * rather than one, because "not signed in" is something the reader can fix
 * in ten seconds and "not on the list" is not.
 */
export function App() {
  return (
    <AuthGate>
      <AccessGate>
        <Builder />
      </AccessGate>
    </AuthGate>
  );
}

function Builder() {
  const { session, state } = useBuilderSession();
  const usage = state.budget.used;

  return (
    <div className="shell">
      {/*
        The bar carries what somebody looks at while building, and nothing
        else. It used to carry the brand, a sentence describing the
        deployment, a billing readout with three buttons, the whole GitHub
        connection panel and the account button, all competing for the same
        row. All of that except the brand and the account is configuration:
        read once, changed rarely, and now behind the gear.
      */}
      <header className="shell__header">
        <div className="shell__brand">
          <span className="shell__logo">
            <Mark size={22} />
          </span>
          <div>
            <p className="shell__name">{WORDMARK}</p>
            <p className="shell__tagline">Vibe. Build. Ship.</p>
          </div>
        </div>
        <div className="shell__controls">
          <ThemeToggle />
          <SettingsMenu>
            <section className="settings__section">
              <h2 className="settings__heading">Plan and usage</h2>
              <BillingStatusWidget />
            </section>
            <section className="settings__section">
              <h2 className="settings__heading">GitHub</h2>
              {/*
                Still mounted on every page load, which is why the panel it
                sits in is hidden rather than unmounted when the menu is
                closed: the OAuth callback puts its code in the fragment and
                redirects here, and whatever claims that has to be running.
              */}
              <GitHubPanel />
            </section>
            <section className="settings__section">
              <h2 className="settings__heading">This deployment</h2>
              {/*
                Reports what actually served the last run, and claims nothing
                before there has been one. It used to say the same thing
                across the header on every screen.
              */}
              <p className="settings__note">{describeMode(state.providerId)}</p>
            </section>
          </SettingsMenu>
          <AuthStatus />
        </div>
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
            {state.isAdmin ? <InvitePanel /> : null}
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

      {/*
        Folded away by default. The run count and the token figures are
        reference, not news: worth having, not worth a permanent band across
        the bottom of every screen competing with the work. `details` rather
        than a button and a state, because the browser already knows how to
        do a disclosure and does it accessibly.
      */}
      <footer className="shell__footer">
        <details className="runstats">
          <summary className="runstats__summary">Run stats</summary>
          <span className="runstats__figures">
            Runs: {state.runCount} · Provider:{' '}
            {state.providerId ?? 'not run yet'} · Model tokens:{' '}
            {usage.modelInputTokens} in / {usage.modelOutputTokens} out
          </span>
        </details>
        {/*
          This used to say that sandbox execution, real providers, Git export
          and deployment were not implemented. All four shipped, and the line
          stayed, so the app spent weeks denying the features somebody was
          using while reading it. Then it was corrected twice and still left
          claiming Problems was wired. It is now assembled from the same list
          the panes state their own gaps from (generation/pane-gaps.ts), so
          there is nothing here to correct separately.
        */}
        <span>{footerNote()}</span>
      </footer>
    </div>
  );
}
