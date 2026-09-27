import { Link } from 'react-router';

import { Icon } from '../components/Icon';
import { PageHead, SectionHead } from '../components/SiteChrome';
import { metaFor, routeFor } from '../site';

export function meta() {
  return metaFor('/features');
}

const THEMES = [
  ['Scheduled exports', '24'],
  ['Import errors', '17'],
  ['Dark mode', '15'],
  ['Bulk editing', '11'],
  ['Session drops', '9'],
  ['Search accuracy', '6'],
];

export default function Features() {
  const route = routeFor('/features');
  return (
    <>
      <PageHead
        kicker="Features"
        title="Everything it does,"
        emphasis="in plain words"
        lead={route.description}
      />

      <section className="page-body" aria-labelledby="bento-title">
        <div className="wrap">
          <h2 id="bento-title" className="sr-only">
            What Emberline does
          </h2>
          <div className="feat-grid">
            <article className="f f-themes">
              <div className="f-head">
                <span className="tile-ic ic-ember" aria-hidden="true">
                  <Icon name="layers" />
                </span>
                Themes
              </div>
              <h3>Themes, not a tag cloud</h3>
              <p>
                Messages that ask for the same thing are grouped as they arrive,
                whatever words they use and whichever channel they came through.
                A theme is yours to rename, merge or split, and every message in
                it stays one click away.
              </p>
              <p className="mt-5 font-mono text-[12.5px] text-[var(--ink-muted)]">
                Sample themes, with the number of messages in each
              </p>
              <ul className="pill-list mt-3">
                {THEMES.map(([name, count]) => (
                  <li key={name}>
                    {name} <b>{count}</b>
                  </li>
                ))}
              </ul>
              <div className="mock" aria-label="A sample theme">
                <div className="mock-h">
                  <span>Theme: Scheduled exports</span>
                  <span>email, chat, support desk</span>
                </div>
                <div className="mock-b">
                  <blockquote>
                    We export the weekly report by hand every Monday.
                  </blockquote>
                  <blockquote>Can this go out on its own each week?</blockquote>
                  <p className="text-[15px]">
                    Sample messages, invented for this page.
                  </p>
                </div>
              </div>
            </article>

            <article className="f f-impact">
              <div className="f-head">
                <span className="tile-ic ic-teal" aria-hidden="true">
                  <Icon name="rank" />
                </span>
                Ranking
              </div>
              <h3>A ranking you can explain</h3>
              <p>
                Themes are ordered by signals you can read back to anyone who
                asks why.
              </p>
              <div className="ring-wrap" aria-hidden="true">
                <svg viewBox="0 0 160 160">
                  <defs>
                    <linearGradient id="rg" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0" stopColor="#13a394" />
                      <stop offset="1" stopColor="#f5a524" />
                    </linearGradient>
                  </defs>
                  <circle className="ring-bg" cx="80" cy="80" r="70" />
                  <circle className="ring-fg" cx="80" cy="80" r="70" />
                </svg>
                <div className="ring-mid">
                  <div>
                    Ranked
                    <small>by you</small>
                  </div>
                </div>
              </div>
              <ul className="check-list">
                <li>
                  <i aria-hidden="true">1</i>How many customers raised it
                </li>
                <li>
                  <i aria-hidden="true">2</i>Their plan or account value, if you
                  choose to weight by it
                </li>
                <li>
                  <i aria-hidden="true">3</i>How recently, so old requests fade
                  instead of piling up
                </li>
              </ul>
            </article>

            <article className="f f-loop">
              <div className="f-head">
                <span className="tile-ic ic-amber" aria-hidden="true">
                  <Icon name="reply" />
                </span>
                Replies
              </div>
              <h3>Close the loop</h3>
              <p>
                When a theme ships, write one reply and Emberline sends it to
                every customer who asked, through the channel they used.
              </p>
              <div className="note-pill" aria-hidden="true">
                <Icon name="reply" />
                <span>Reply queued for everyone in this theme</span>
              </div>
            </article>

            <article className="f f-privacy">
              <div className="f-head">
                <span className="tile-ic ic-blush" aria-hidden="true">
                  <Icon name="shield" />
                </span>
                Privacy
              </div>
              <h3>Personal details, kept out</h3>
              <p>
                Email addresses, phone numbers and card numbers are masked
                before a message reaches the shared inbox.
              </p>
              <div className="note-pill" aria-hidden="true">
                <Icon name="lock" />
                <span>j•••@•••.example wrote in about exports</span>
              </div>
            </article>

            <article className="f f-export">
              <div className="f-head">
                <span className="tile-ic ic-ink" aria-hidden="true">
                  <Icon name="download" />
                </span>
                Export
              </div>
              <h3>Leave with everything</h3>
              <p>One export, on every plan, in files any spreadsheet opens.</p>
              <ul className="tree" aria-label="Files in an export">
                <li className="d">emberline-export/</li>
                <li>messages.csv</li>
                <li>themes.csv</li>
                <li>replies.csv</li>
              </ul>
            </article>

            <article className="f f-fit">
              <div>
                <div className="f-head">
                  <span className="tile-ic ic-teal" aria-hidden="true">
                    <Icon name="plug" />
                  </span>
                  Where it fits
                </div>
                <h3>Between your customers and your tracker</h3>
                <p>
                  Emberline does not replace your support desk or your issue
                  tracker. It reads from one and writes to the other, so the
                  people answering customers and the people building for them
                  finally look at the same list.
                </p>
                <dl className="facts">
                  <div>
                    <dt>Reads from</dt>
                    <dd>Email, chat, widget, support desk, reviews, surveys</dd>
                  </div>
                  <div>
                    <dt>Writes to</dt>
                    <dd>Issue tracker, team chat, webhooks, CSV</dd>
                  </div>
                  <div>
                    <dt>Setup</dt>
                    <dd>A forwarding address and a snippet</dd>
                  </div>
                </dl>
              </div>
              <FitDiagram />
            </article>
          </div>
        </div>
      </section>

      <section className="sec pt-0" aria-labelledby="not-title">
        <div className="wrap">
          <SectionHead
            id="not-title"
            kicker="Limits"
            warm
            title="What Emberline"
            emphasis="does not do"
          />
          <ul className="plain-list two max-w-[60em]">
            <li>It does not answer customers for you. People do that.</li>
            <li>
              It does not decide your roadmap. It shows the evidence, and the
              decision stays with the team.
            </li>
            <li>
              It does not sell or share your customers’ messages with anyone.
            </li>
            <li>It does not lock your data in: the export is on every plan.</li>
          </ul>
          <p className="mt-8">
            <Link to="/pricing" className="link">
              See what each plan includes
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}

/** Where Emberline sits, as a labelled picture rather than a claim. */
function FitDiagram() {
  return (
    <svg
      className="fit-diagram"
      viewBox="0 0 560 300"
      role="img"
      aria-labelledby="fit-title"
    >
      <title id="fit-title">
        Messages flow from your customers into Emberline, which groups them into
        themes and sends the ranked themes on to your issue tracker.
      </title>
      <defs>
        <radialGradient id="fg1" cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#f5a524" stopOpacity=".35" />
          <stop offset="1" stopColor="#f5a524" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="fg2" cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#13a394" stopOpacity=".28" />
          <stop offset="1" stopColor="#13a394" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="280" cy="84" r="100" fill="url(#fg1)" />
      <circle cx="110" cy="228" r="86" fill="url(#fg2)" />
      <circle cx="450" cy="228" r="86" fill="url(#fg2)" />
      <path
        className="flow"
        d="M140 190 C160 170 200 160 240 122"
        stroke="#e2572a"
        strokeWidth="2"
        fill="none"
      />
      <path
        className="flow"
        d="M320 122 C360 160 400 170 420 190"
        stroke="#13a394"
        strokeWidth="2"
        fill="none"
      />
      <rect
        className="box"
        x="190"
        y="40"
        width="180"
        height="84"
        rx="20"
        stroke="#e2572a"
        strokeOpacity=".5"
      />
      <text className="t1" x="280" y="74" textAnchor="middle">
        Emberline
      </text>
      <text className="t2" x="280" y="100" textAnchor="middle">
        inbox, themes, ranking
      </text>
      <rect
        className="box"
        x="24"
        y="190"
        width="172"
        height="80"
        rx="20"
        stroke="#13a394"
        strokeOpacity=".55"
      />
      <text className="t1" x="110" y="222" textAnchor="middle">
        Customers
      </text>
      <text className="t2" x="110" y="247" textAnchor="middle">
        email, chat, widget
      </text>
      <rect
        className="box"
        x="364"
        y="190"
        width="172"
        height="80"
        rx="20"
        stroke="#13a394"
        strokeOpacity=".55"
      />
      <text className="t1" x="450" y="222" textAnchor="middle">
        Your tracker
      </text>
      <text className="t2" x="450" y="247" textAnchor="middle">
        issues, linked to themes
      </text>
    </svg>
  );
}
