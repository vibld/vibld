import { AccessGate } from './components/AccessGate.tsx';
import { AdminSettings } from './components/AdminSettings.tsx';
import { AdminAccountList } from './components/AdminAccountList.tsx';
import { AdminOverview } from './components/AdminOverview.tsx';
import { AdminUserPage } from './components/AdminUserPage.tsx';
import { MockupChooser } from './components/MockupChooser.tsx';
import {
  ADMIN_PATH,
  adminUserIdFromPath,
  isAdminAccountsPath,
  isAdminOverviewPath,
  isAdminArea,
  isAdminPath,
} from './admin/route.ts';
import { useRef } from 'react';
import { navigate, usePathname } from './admin/use-pathname.ts';
import { useFocusOnChange } from './admin/use-focus-on-change.ts';
import { Mark, WORDMARK } from './components/Mark.tsx';
import { Conversation } from './components/Conversation.tsx';
import { SettingsMenu } from './components/SettingsMenu.tsx';
import { AccountDeletion } from './components/AccountDeletion.tsx';
import { BillingStatusWidget } from './components/BillingStatus.tsx';
import { SignupCreditBanner } from './components/SignupCreditOffer.tsx';
import { ReferralClaim, ReferralSection } from './components/ReferralPanel.tsx';
import { GitHubPanel } from './components/GitHubPanel.tsx';
import { ShipMenu } from './components/ShipMenu.tsx';
import { shipNote } from './generation/ship-note.ts';
import { describeMode } from './generation/labels.ts';
import { ThemeToggle } from './components/ThemeToggle.tsx';
import { footerNote } from './generation/pane-gaps.ts';
import { saveStyleDna } from './generation/style-dna-store.ts';
import { saveKnowledge } from './generation/knowledge-store.ts';
import { saveModelChoice } from './generation/model-choice-store.ts';
import { PromptPanel } from './components/PromptPanel.tsx';
import { ProjectBar } from './components/ProjectBar.tsx';
import { ProjectsView } from './components/ProjectsView.tsx';
import { Workspace } from './components/Workspace.tsx';
import { useBuilderSession } from './useBuilderSession.ts';
import { isProjectsPath } from './projects/project-route.ts';
import { useProjects } from './projects/use-projects.ts';
import { AuthGate, AuthStatus } from './auth/clerk.tsx';
import { SharedProjectPage } from './components/SharedProjectPage.tsx';
import { shareIntentPath, shareTokenFromPath } from './projects/share-route.ts';
import { peekPendingIntent, shareStorage } from './projects/share-client.ts';
import { useEffect } from 'react';
import type { ReactNode } from 'react';

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
  // A shared project (`/s/<token>`) is the one page anybody can open, signed
  // in or not, so it is decided before either gate. It carries none of the
  // builder's state and mounts no session.
  const shareToken = shareTokenFromPath(usePathname());
  if (shareToken)
    return <SharedProjectPage key={shareToken} token={shareToken} />;
  return (
    <AuthGate>
      <PendingShareIntent>
        <AccessGate>
          <Builder />
        </AccessGate>
      </PendingShareIntent>
    </AuthGate>
  );
}

/**
 * Back to a shared project whose remix, or live preview, was asked for
 * before signing in, when the sign-in ended here rather than on the link (a
 * sign-up that finished on its own page). Before the builder mounts,
 * because the builder opens or makes a project on arrival, and a new
 * account's first project should be the remix it came for rather than an
 * empty one made on the way.
 */
function PendingShareIntent({ children }: { children: ReactNode }) {
  const pending = peekPendingIntent(shareStorage());
  const target = pending
    ? shareIntentPath(pending.token, pending.intent)
    : null;
  useEffect(() => {
    if (target) navigate(target, { replace: true });
  }, [target]);
  return pending ? null : children;
}

function Builder() {
  const { session, state } = useBuilderSession();
  const usage = state.budget.used;
  // Which of the two views this is. The session above it stays mounted
  // across the change, which is the whole reason this is a state and not a
  // link to another document: a run takes minutes, and an admin who
  // stepped into settings during one would otherwise come back to an empty
  // shell (internal issue 184).
  const pathname = usePathname();
  // The tools page, or one account's page under it (D73). Both replace the
  // builder the same way.
  const onAdminPage = isAdminArea(pathname);
  const adminUserId = adminUserIdFromPath(pathname);
  // Projects live on the Worker where the deployment generates with a
  // model, and not at all where it runs the in-browser fake: see
  // `use-projects.ts` for why, and for what each address means.
  const projects = useProjects(session, state, pathname);
  const onProjectsPage = projects.mode === 'server' && isProjectsPath(pathname);
  // Either page replaces the builder's two columns, which stay mounted
  // underneath with everything they hold.
  const onPage = onAdminPage || onProjectsPage;
  // The open server project: whose site Ship publishes, and whose
  // repository the GitHub controls are about (D72). Null where there are
  // no server projects, or while one is opening.
  const openProject = projects.mode === 'server' ? projects.current : null;
  // Where focus goes when the view changes under a reader who never left
  // the document. See `useFocusOnChange`.
  const body = useRef<HTMLElement | null>(null);
  useFocusOnChange(pathname, body);

  return (
    <div className="shell">
      {/*
        Here, inside both gates, because a claim needs the account to exist
        and be signed in. The code it claims was kept by main.tsx when the
        page first loaded, before the sign-up form could move the URL on.
      */}
      <ReferralClaim />
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
        {/*
          What is being worked on, not how the product is configured: the
          open project's name and whether it is saved, and the way back to
          the list. Nothing here is configuration, which stays behind the
          gear.
        */}
        <ProjectBar
          projects={projects}
          ship={
            <ShipMenu
              project={openProject}
              snapshot={state.acceptedSnapshot}
              note={shipNote(state)}
            />
          }
        />
        <div className="shell__controls">
          <ThemeToggle />
          <SettingsMenu>
            {(closeSettings) => (
              <>
                <section className="settings__section">
                  <h2 className="settings__heading">Plan and usage</h2>
                  <BillingStatusWidget />
                </section>
                <ReferralSection />
                <section className="settings__section">
                  <h2 className="settings__heading">GitHub</h2>
                  {/*
                Still mounted on every page load, which is why the panel it
                sits in is hidden rather than unmounted when the menu is
                closed: the OAuth callback puts its code in the fragment and
                redirects here, and whatever claims that has to be running.
              */}
                  <GitHubPanel
                    projectId={openProject?.id ?? null}
                    projectName={openProject?.name ?? ''}
                  />
                </section>
                {/*
              The only way into the admin page, and it exists only for an
              admin. `isAdmin` is `null` until `/api/config` answers, so
              this is absent during the probe rather than briefly wrong in
              either direction. It is not a permission: `/api/admin/*`
              checks the caller itself (ADR-0006).
            */}
                {state.isAdmin === true ? (
                  <section className="settings__section">
                    <h2 className="settings__heading">Platform admin</h2>
                    <a
                      className="settings__link"
                      href={ADMIN_PATH}
                      onClick={(event) => {
                        if (
                          event.defaultPrevented ||
                          event.metaKey ||
                          event.ctrlKey ||
                          event.shiftKey ||
                          event.altKey ||
                          event.button !== 0
                        ) {
                          return;
                        }
                        event.preventDefault();
                        // Closed as part of the same action. The popover's
                        // outside-click handler deliberately ignores a
                        // mousedown that happened inside the panel, and an
                        // internal navigation changes nothing it watches, so
                        // without this the admin page opened underneath a menu
                        // still standing over it (internal PR 188 review).
                        closeSettings();
                        navigate(ADMIN_PATH);
                      }}
                    >
                      Credit, invites, payments and takedowns
                    </a>
                  </section>
                ) : null}
                {/*
              Last but one, and a button that only opens an explanation:
              the one control in here that cannot be undone after a month
              should not be the first thing under the gear.
            */}
                <section className="settings__section">
                  <h2 className="settings__heading">Account</h2>
                  <AccountDeletion />
                </section>
                <section className="settings__section">
                  <h2 className="settings__heading">This deployment</h2>
                  {/*
                Reports what actually served the last run, and claims nothing
                before there has been one. It used to say the same thing
                across the header on every screen.
              */}
                  <p className="settings__note">
                    {describeMode(state.providerId)}
                  </p>
                </section>
              </>
            )}
          </SettingsMenu>
          <AuthStatus />
        </div>
      </header>

      <main
        className={onPage ? 'shell__body shell__body--page' : 'shell__body'}
        ref={body}
        tabIndex={-1}
      >
        {isAdminPath(pathname) ? (
          <AdminSettings isAdmin={state.isAdmin} />
        ) : null}
        {isAdminOverviewPath(pathname) ? (
          <AdminOverview isAdmin={state.isAdmin} />
        ) : null}
        {isAdminAccountsPath(pathname) ? (
          <AdminAccountList isAdmin={state.isAdmin} />
        ) : null}
        {adminUserId !== null ? (
          <AdminUserPage isAdmin={state.isAdmin} userId={adminUserId} />
        ) : null}
        {onProjectsPage ? <ProjectsView projects={projects} /> : null}
        <section
          className="column column--left"
          aria-label="Conversation"
          hidden={onPage}
        >
          <Conversation state={state} />
          <div className="composer">
            {/*
              First in the composer, because it is what stands between a
              new account and its first run: the welcome credit waits for a
              card (2026-09-27), and the settings menu is not where somebody
              new looks.
            */}
            <SignupCreditBanner />
            {/*
              Above the composer, because it is what the next click is
              about. Every mockup is model output and renders in a fully
              restricted frame -- see `MockupChooser`.
            */}
            <MockupChooser
              mockups={state.mockups}
              onChoose={(mockup) => session.chooseMockup(mockup)}
              onDiscard={() => session.discardMockups()}
              disabled={state.running || state.opening || state.restoring}
            />
            <PromptPanel
              state={state}
              onSubmit={(prompt, mode, style, referenceUrl) => {
                // Through the conversation: the agent decides whether this
                // is a question to answer or a change to build.
                void session.send(prompt, mode, style, referenceUrl);
              }}
              onExplore={(prompt, style, referenceUrl) => {
                void session.explore(prompt, style, referenceUrl);
              }}
              // A saved project is not discarded in place: the same
              // button starts a new project and leaves this one in the
              // list. Without projects it still starts over, as before.
              onReset={() =>
                projects.mode === 'server'
                  ? void projects.create()
                  : session.reset()
              }
              resetLabel={
                projects.mode === 'server' ? 'New project' : 'Start over'
              }
              style={state.style}
              onStyleChange={(style) => session.setStyle(style)}
              galleryStyle={state.galleryStyle}
              onGalleryStyleChange={(id) => session.setGalleryStyle(id)}
              galleryColors={state.galleryColors}
              onGalleryColorsChange={(edits) => session.setGalleryColors(edits)}
              referenceUrl={state.referenceUrl}
              onReferenceUrlChange={(value) => session.setReferenceUrl(value)}
              onCancel={() => void session.cancel()}
              onCancelExplore={() => session.cancelExplore()}
              onModelChange={(model) => {
                session.setModel(model);
                saveModelChoice(model);
              }}
              knowledge={state.knowledge}
              onKnowledgeChange={(value) => {
                session.setKnowledge(value);
                saveKnowledge(value);
              }}
              styleDna={state.styleDna}
              onStyleDnaChange={(value) => {
                session.setStyleDna(value);
                saveStyleDna(value);
              }}
            />
          </div>
        </section>

        {/*
          Hidden rather than unmounted, both of these. The preview iframe
          and the workspace carry live state -- a sandbox that has loaded,
          a scroll position, a file selection -- and a trip to settings
          should cost none of it. `hidden` is also what tells assistive
          technology the builder is not on screen; `hidden-attribute.test`
          holds the stylesheet to honouring it.
        */}
        <Workspace
          state={state}
          hidden={onPage}
          onCheckpointRestored={(projectId, snapshot) =>
            session.adoptCheckpoint(projectId, snapshot)
          }
          // Held the way opening a project holds it: a build sent while a
          // restore is on its way would start from the code being replaced.
          onCheckpointRestoring={() => session.holdForRestore()}
        />
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
          {/*
            Inside the fold since 2026-09-28: a paragraph of caveats along
            the bottom of every screen was the first thing Chris named as
            clutter, and it is reference in the same way the figures are.
          */}
          <span className="runstats__note">{footerNote()}</span>
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
      </footer>
    </div>
  );
}
