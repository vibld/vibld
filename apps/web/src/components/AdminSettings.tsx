import { AdminPanel } from './AdminPanel.tsx';
import { InvitePanel } from './InvitePanel.tsx';
import { ParkedQueuePanel } from './ParkedQueuePanel.tsx';
import { SiteTakedown } from './SiteTakedown.tsx';
import { adminPageView } from '../admin/route.ts';
import { navigate } from '../admin/use-pathname.ts';

/**
 * Platform administration, on a page of its own (#184).
 *
 * These four tools used to sit in the composer, beneath the style controls,
 * for every admin on every session. Two things were wrong with that. The
 * smaller one is recorded in `builder-layout.test.ts`: they grew the
 * composer past a viewport that had been told not to scroll, and the model
 * picker and the controls under it became unreachable. The larger one is
 * that granting somebody credit, inviting somebody, reconciling a payment
 * or taking a site down are not steps in writing a prompt. Keeping them in
 * the composer meant an admin could not see the product the way anybody
 * else sees it.
 *
 * Nothing here is a permission. Each panel calls `/api/admin/*`, and every
 * one of those routes checks the caller itself at the trusted boundary
 * (ADR-0006, docs/decisions.md L4). This decides what is worth drawing, and
 * that is all it decides.
 */
export function AdminSettings({ isAdmin }: { isAdmin: boolean | null }) {
  const view = adminPageView(isAdmin);

  if (view === 'checking') {
    // Not "no". The answer comes from a fetch, and for the first moments of
    // every load nobody has answered. Rendering the refusal here would tell
    // an admin who opened this page directly that it does not exist, then
    // take it back.
    return (
      <section className="adminpage" aria-label="Platform admin">
        <p className="pane-note" role="status">
          Checking your access.
        </p>
      </section>
    );
  }

  if (view === 'denied') {
    return (
      <section className="adminpage" aria-label="Platform admin">
        <h1 className="adminpage__title">Nothing here</h1>
        <p className="pane-note">
          This page is not part of your account.{' '}
          <BackToBuilder label="Go back to the builder" />
        </p>
      </section>
    );
  }

  return (
    <section className="adminpage" aria-label="Platform admin">
      <div className="adminpage__head">
        <div>
          <h1 className="adminpage__title">Platform admin</h1>
          <p className="pane-note">
            Tools that act on other people&rsquo;s accounts and sites. Every one
            of them is checked again by the server.
          </p>
        </div>
        <BackToBuilder label="Back to the builder" />
      </div>

      <div className="adminpage__tools">
        <AdminPanel />
        <InvitePanel />
        <ParkedQueuePanel />
        <SiteTakedown />
      </div>
    </section>
  );
}

/**
 * A real link, so it can be opened in a new tab, copied, and read by
 * anything that reads links. The click is intercepted only to keep the
 * document alive: the builder session lives above this page, and a full
 * load would throw away a run in progress.
 */
function BackToBuilder({ label }: { label: string }) {
  return (
    <a
      className="adminpage__back"
      href="/"
      onClick={(event) => {
        // Let the browser have the click whenever the person asked for a
        // new tab or window, or used a button that is not the primary one.
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
        navigate('/');
      }}
    >
      {label}
    </a>
  );
}
