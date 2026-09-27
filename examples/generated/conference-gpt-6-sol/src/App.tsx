import { useState, type FormEvent } from 'react';
import { ArrowRight, Check, CircleEllipsis } from 'lucide-react';
import { MotionConfig, motion } from 'motion/react';
import { Button } from '@/components/ui/button.tsx';

type Session = { time: string; title: string; speaker: string };
type Day = { number: string; date: string; sessions: Session[] };

const days: Day[] = [
  {
    number: 'Day 01',
    date: 'Wednesday, October 14',
    sessions: [
      { time: '09:00', title: 'Doors and coffee', speaker: 'Open room' },
      { time: '10:00', title: 'The cost of later', speaker: 'Ada Mensah' },
      { time: '11:30', title: 'The interface under pressure', speaker: 'Jun Park' },
      { time: '14:00', title: 'Caches, queues, and the messy middle', speaker: 'Leila Haddad' },
    ],
  },
  {
    number: 'Day 02',
    date: 'Thursday, October 15',
    sessions: [
      { time: '09:30', title: 'Morning notes', speaker: 'Open room' },
      { time: '10:00', title: 'Design for failure, then recovery', speaker: 'Tomas Vale' },
      { time: '11:30', title: 'A keyboard-first product review', speaker: 'Jun Park' },
      { time: '14:00', title: 'What we keep from the prototype', speaker: 'Ada Mensah + Leila Haddad' },
    ],
  },
];

const speakers = [
  {
    number: '01',
    name: 'Ada Mensah',
    role: 'Platform engineer',
    description: 'On the decisions that make a system easier to maintain a year later.',
  },
  {
    number: '02',
    name: 'Jun Park',
    role: 'Accessibility engineer',
    description: 'On testing an interface when the keyboard is the only way in.',
  },
  {
    number: '03',
    name: 'Leila Haddad',
    role: 'Database engineer',
    description: 'On the tradeoffs hiding between a fast query and a reliable service.',
  },
  {
    number: '04',
    name: 'Tomas Vale',
    role: 'Developer tooling designer',
    description: 'On making failure states clear enough to act on.',
  },
];

function EmailForm() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success'>('idle');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === 'loading') return;

    if (!email.trim()) {
      setError('Enter your email address.');
      setStatus('idle');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.');
      setStatus('idle');
      return;
    }

    setError('');
    setStatus('loading');
    await new Promise<void>((resolve) => window.setTimeout(resolve, 700));
    setStatus('success');
  }

  return (
    <div className="email-block">
      <form onSubmit={handleSubmit} noValidate>
        <label htmlFor="email" className="mb-2 block text-small font-medium text-foreground">
          Email for program updates
        </label>
        <div className="email-shell flex h-[51px] w-full items-center rounded-pill border border-glass-border bg-glass-fill pl-5 pr-[3px]">
          <input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setError('');
              setStatus('idle');
            }}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'email-error' : 'email-note'}
            className="min-w-0 flex-1 bg-transparent font-body text-body text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <Button
            variant="form"
            size="icon"
            type="submit"
            disabled={status === 'loading'}
            aria-label={status === 'loading' ? 'Checking...' : 'Join the update list'}
          >
            <span className="flex size-[38px] items-center justify-center rounded-pill bg-primary text-primary-foreground">
              {status === 'loading' ? (
                <CircleEllipsis className="size-4" aria-hidden="true" />
              ) : status === 'success' ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <ArrowRight className="size-4" aria-hidden="true" />
              )}
            </span>
          </Button>
        </div>
        {error && <p id="email-error" role="alert" className="mt-2 text-small text-destructive">{error}</p>}
      </form>
      <p id="email-note" className="mt-3 text-small text-muted-foreground">
        Demo only. This form does not send or store your email.
      </p>
      {status === 'loading' && <p role="status" className="mt-2 text-small text-foreground">Checking...</p>}
      {status === 'success' && (
        <p role="status" className="mt-2 text-small text-foreground">Demo complete. No email was sent or stored.</p>
      )}
    </div>
  );
}

function App() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="overflow-x-clip bg-background font-body text-foreground">
        <header id="top" className="hero relative isolate min-h-[100svh] overflow-hidden">
          <div className="hero-media" aria-hidden="true" />
          <nav aria-label="Main navigation" className="floating-nav absolute z-20 flex h-[50px] w-[calc(100%-40px)] max-w-[850px] items-center justify-between rounded-pill border border-glass-border bg-glass-fill px-5 shadow-medium backdrop-blur-[18px]">
            <a href="#top" className="flex min-h-11 cursor-pointer items-center font-body text-small font-semibold tracking-tight text-foreground transition-opacity duration-150 hover:opacity-70 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              trace / 26
            </a>
            <div className="flex items-center gap-1 sm:gap-5">
              <a href="#schedule" className="nav-link">Schedule</a>
              <a href="#speakers" className="nav-link nav-desktop">Speakers</a>
              <a href="#about" className="nav-link nav-desktop">About</a>
            </div>
          </nav>
          <div className="hero-content relative z-10 mx-auto flex min-h-[100svh] w-[calc(100%-48px)] max-w-[1200px] flex-col items-center justify-center text-center">
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }} className="mb-6 text-meta font-semibold uppercase text-accent">
              October 14-15, 2026 / Online + venue to come
            </motion.p>
            <motion.h1 initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18, delay: 0.07 }} className="max-w-full font-display text-display text-foreground">
              Build what <em className="font-normal">lasts.</em>
            </motion.h1>
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18, delay: 0.14 }} className="mt-7 max-w-[550px] text-body text-foreground">
              Two days with the people who make the web work when things get complicated.
            </motion.p>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18, delay: 0.21 }} className="mt-10 w-full max-w-[490px] text-left">
              <EmailForm />
            </motion.div>
          </div>
        </header>

        <main>
          <motion.section id="about" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true, amount: 0.3 }} transition={{ duration: 0.18 }} className="section-shell about-grid section-pad scroll-mt-6">
            <p className="section-label">01 / The idea</p>
            <div>
              <h2 className="max-w-[850px] font-display text-title">The work behind the work.</h2>
              <p className="mt-7 max-w-[680px] text-body text-muted-foreground">
                Trace is a two-day gathering for developers who care about how software behaves after launch. Expect practical talks, live reviews, and enough time to ask the awkward questions.
              </p>
            </div>
          </motion.section>

          <motion.section id="schedule" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true, amount: 0.3 }} transition={{ duration: 0.18 }} className="section-shell section-pad scroll-mt-6 border-t border-border">
            <p className="section-label">02 / Program</p>
            <div className="section-intro">
              <h2 className="max-w-[700px] font-display text-title">Two days, one conversation.</h2>
              <p className="max-w-[360px] text-body text-muted-foreground">A draft of the room's rhythm, from first coffee to the last question.</p>
            </div>
            <p className="mt-5 text-small text-muted-foreground">Sample program: names, times, and sessions are illustrative.</p>
            <div className="schedule-grid mt-12">
              {days.map((day) => (
                <div key={day.number}>
                  <div className="mb-6 flex items-baseline justify-between gap-4">
                    <h3 className="font-display text-subhead">{day.number}</h3>
                    <p className="text-small text-muted-foreground">{day.date}</p>
                  </div>
                  <ol>
                    {day.sessions.map((session) => (
                      <li key={session.time} className="session-row grid grid-cols-[76px_1fr] gap-4 border-t border-border py-6">
                        <span className="pt-1 text-small font-medium text-accent">{session.time}</span>
                        <div>
                          <h4 className="text-body font-semibold leading-snug text-foreground">{session.title}</h4>
                          <p className="mt-2 text-small text-muted-foreground">{session.speaker}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </motion.section>

          <motion.section id="speakers" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true, amount: 0.3 }} transition={{ duration: 0.18 }} className="section-shell section-pad scroll-mt-6 border-t border-border">
            <p className="section-label">03 / Speakers</p>
            <div className="section-intro">
              <h2 className="max-w-[700px] font-display text-title">The voices in the room.</h2>
              <p className="max-w-[360px] text-body text-muted-foreground">Four perspectives on building for the long run.</p>
            </div>
            <div className="speaker-grid mt-12">
              {speakers.map((speaker) => (
                <article key={speaker.number} className="border-t border-border py-7">
                  <span className="font-display text-subhead italic text-accent">{speaker.number}</span>
                  <h3 className="mt-5 font-display text-subhead text-foreground">{speaker.name}</h3>
                  <p className="mt-2 text-small font-semibold text-accent">{speaker.role}</p>
                  <p className="mt-4 max-w-[390px] text-body text-muted-foreground">{speaker.description}</p>
                </article>
              ))}
            </div>
          </motion.section>
        </main>

        <footer className="section-shell footer-layout border-t border-border py-8 text-small text-muted-foreground">
          <a href="#top" className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-foreground transition-opacity duration-150 hover:opacity-70 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">trace / 26</a>
          <span>October 14-15, 2026</span>
          <span>Program and speaker details are illustrative.</span>
        </footer>
      </div>
    </MotionConfig>
  );
}

export default App;