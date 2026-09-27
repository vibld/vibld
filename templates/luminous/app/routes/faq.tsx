import { Link } from 'react-router';

import { PageHead } from '../components/SiteChrome';
import { metaFor, routeFor } from '../site';

export function meta() {
  return metaFor('/faq');
}

const QUESTIONS = [
  {
    q: 'How does Emberline decide which messages belong to the same theme?',
    a: 'It compares what each message asks for rather than the words it uses, so “a way to schedule the report” and “can this CSV go out every Monday” land together. A suggested theme is only a suggestion: you can rename it, merge it with another, or split messages out of it.',
  },
  {
    q: 'What happens to our customers’ personal details?',
    a: 'Email addresses, phone numbers and card numbers are masked before a message reaches the shared inbox. The original is kept only where you need it to reply, and only people you give that permission can see it.',
  },
  {
    q: 'Can we bring in feedback we already have?',
    a: 'Yes. Upload a CSV with one message per row and Emberline sorts it into themes the same way it sorts new messages, so the first view you see already has history in it.',
  },
  {
    q: 'Which tools does it connect to?',
    a: 'The kinds of tool on the home page: email, live chat, an in-app widget, a support desk, app reviews, surveys, call notes and a community forum on the way in; an issue tracker, team chat, webhooks and CSV on the way out. Anything else can send messages in through the API.',
  },
  {
    q: 'What happens to our data if we leave?',
    a: 'Export everything as CSV at any time, on any plan. After you cancel, the workspace stays readable and exportable for ninety days, and is then deleted.',
  },
  {
    q: 'Do we need a developer to set it up?',
    a: 'Not for email or chat: forwarding an address and pasting a webhook are enough. The in-app widget is a short snippet, which someone who can edit your app’s HTML can add in a few minutes.',
  },
];

/**
 * Plain headings and paragraphs rather than a JavaScript accordion. The
 * content is the point, it is short enough to read, and this way it is
 * legible to a crawler and to someone who has disabled scripts.
 */
export default function Faq() {
  const route = routeFor('/faq');
  return (
    <>
      <PageHead
        kicker="FAQ"
        title="Questions,"
        emphasis="answered plainly"
        lead={route.description}
      />
      <section className="page-body" aria-labelledby="faq-title">
        <div className="wrap">
          <h2 id="faq-title" className="sr-only">
            Questions and answers
          </h2>
          <dl className="faq">
            {QUESTIONS.map((item) => (
              <div key={item.q}>
                <dt>{item.q}</dt>
                <dd>{item.a}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-10 text-[var(--ink-muted)]">
            Something else?{' '}
            <Link to="/contact" className="link">
              Ask us directly
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}
