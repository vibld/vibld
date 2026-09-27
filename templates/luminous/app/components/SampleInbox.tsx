import { useId } from 'react';

import type { SourceId } from '../glow-palette';
import { Icon, type IconName } from './Icon';

interface Source {
  id: Exclude<SourceId, 'all'>;
  label: string;
  icon: IconName;
  tone: string;
  /** The two ends of the chip's colour dot. */
  c1: string;
  c2: string;
}

export const SOURCES: Source[] = [
  {
    id: 'email',
    label: 'Email',
    icon: 'mail',
    tone: 'ic-ember',
    c1: '#e2572a',
    c2: '#f5a524',
  },
  {
    id: 'chat',
    label: 'Live chat',
    icon: 'chat',
    tone: 'ic-teal',
    c1: '#13a394',
    c2: '#f5a524',
  },
  {
    id: 'widget',
    label: 'In-app widget',
    icon: 'widget',
    tone: 'ic-blush',
    c1: '#ee6b72',
    c2: '#f8b340',
  },
  {
    id: 'support',
    label: 'Support desk',
    icon: 'desk',
    tone: 'ic-amber',
    c1: '#f5a524',
    c2: '#13a394',
  },
];

/**
 * Sample messages, written for this page. They are attributed to a plan
 * rather than a person because there is no person: a template that shipped
 * invented quotes under invented names would be teaching its owner to
 * publish fake testimonials.
 */
const MESSAGES: {
  source: Source['id'];
  text: string;
  from: string;
  theme: string;
}[] = [
  {
    source: 'email',
    text: 'We export the weekly report by hand every Monday. A scheduled CSV would give us that hour back.',
    from: 'Team plan',
    theme: 'Scheduled exports',
  },
  {
    source: 'chat',
    text: 'The mobile app signs me out every time I switch from wifi to data.',
    from: 'Starter plan',
    theme: 'Session drops on mobile',
  },
  {
    source: 'widget',
    text: 'Is there a dark mode? I do most of my triage late in the evening.',
    from: 'Team plan',
    theme: 'Dark mode',
  },
  {
    source: 'support',
    text: 'Our import stopped halfway through with no message saying which row was wrong.',
    from: 'Scale plan',
    theme: 'Import errors',
  },
  {
    source: 'email',
    text: 'Can a dashboard be shared with someone outside the company without giving them a login?',
    from: 'Scale plan',
    theme: 'Sharing outside the team',
  },
  {
    source: 'chat',
    text: 'I need to retag three hundred items. Doing it one at a time is not realistic.',
    from: 'Team plan',
    theme: 'Bulk editing',
  },
  {
    source: 'widget',
    text: 'Search does not find anything when I type part of a word.',
    from: 'Starter plan',
    theme: 'Search accuracy',
  },
  {
    source: 'support',
    text: 'Two of us edited the same record and one of the changes disappeared.',
    from: 'Team plan',
    theme: 'Edit conflicts',
  },
];

/**
 * A working miniature of the product: pick a source and the list below
 * filters to it, and the light behind the page takes on that source's mood.
 *
 * The prerendered HTML shows one message from every source, so the card is
 * complete before any script runs. The buttons are toggle buttons
 * (aria-pressed) and the sentence under the list is a polite live region, so
 * a screen reader hears what changed without having to go looking for it.
 */
export function SampleInbox({
  source,
  onSource,
}: {
  source: SourceId;
  onSource: (next: SourceId) => void;
}) {
  const headingId = useId();
  const chosen = SOURCES.find((candidate) => candidate.id === source);
  const shown =
    source === 'all'
      ? SOURCES.map((candidate) =>
          MESSAGES.find((message) => message.source === candidate.id)!,
        )
      : MESSAGES.filter((message) => message.source === source);

  return (
    <section className="inbox" aria-labelledby={headingId}>
      <h2 className="inbox-head" id={headingId}>
        <span className="tile-ic sm ic-amber" aria-hidden="true">
          <Icon name="inbox" />
        </span>
        One inbox, four ways in
      </h2>
      <p className="inbox-note">
        Sample messages, invented for this page. Pick a source to filter them.
      </p>
      <div className="chips" role="group" aria-label="Filter by source">
        <button
          type="button"
          className="chip"
          aria-pressed={source === 'all'}
          onClick={() => onSource('all')}
          style={
            { '--c1': '#f5a524', '--c2': '#13a394' } as React.CSSProperties
          }
        >
          <i aria-hidden="true" />
          All sources
        </button>
        {SOURCES.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            className="chip"
            aria-pressed={source === candidate.id}
            onClick={() => onSource(candidate.id)}
            style={
              {
                '--c1': candidate.c1,
                '--c2': candidate.c2,
              } as React.CSSProperties
            }
          >
            <i aria-hidden="true" />
            {candidate.label}
          </button>
        ))}
      </div>
      <ul className="messages">
        {shown.map((message) => {
          const from = SOURCES.find((s) => s.id === message.source)!;
          return (
            <li className="message" key={message.text}>
              <span className={`tile-ic sm ${from.tone}`} aria-hidden="true">
                <Icon name={from.icon} />
              </span>
              <div>
                <p className="message-text">{message.text}</p>
                <p className="message-meta">
                  <span>
                    {from.label}, {message.from}
                  </span>
                  <span className="theme-tag">
                    <span className="sr-only">Theme: </span>
                    {message.theme}
                  </span>
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="inbox-status" aria-live="polite">
        {chosen ? (
          <>
            Showing <b>{shown.length} messages</b> from{' '}
            {chosen.label.toLowerCase()}, each already filed under a theme.
          </>
        ) : (
          <>
            Showing one message from each source. Emberline files every one
            under a theme as it arrives.
          </>
        )}
      </p>
    </section>
  );
}
