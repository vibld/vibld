import { motion, stagger } from 'motion/react';
import type { Variants } from 'motion/react';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, Globe, Info, ShieldAlert, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { easeOut } from '@/lib/motion';

type Level = 'High' | 'Medium' | 'Low';

type Finding = {
  level: Level;
  title: string;
  host: string;
  age: string;
};

const findings: Finding[] = [
  { level: 'High', title: 'Admin login page is public', host: 'staging.acme-corp.example/wp-admin', age: 'New' },
  { level: 'High', title: 'PostgreSQL port 5432 open', host: 'db-02.acme-corp.example', age: '2 d' },
  { level: 'Medium', title: 'Certificate expires in 9 days', host: 'mail.acme-corp.example', age: '5 d' },
  { level: 'Medium', title: 'SPF record allows any sender', host: 'acme-corp.example', age: '12 d' },
  { level: 'Low', title: 'New subdomain discovered', host: 'dev-billing.acme-corp.example', age: 'New' },
];

const levelStyle: Record<Level, { icon: LucideIcon; className: string }> = {
  High: { icon: ShieldAlert, className: 'bg-foreground text-background' },
  Medium: { icon: TriangleAlert, className: 'border border-foreground/70 text-foreground' },
  Low: { icon: Info, className: 'border border-border text-muted-foreground' },
};

const sequence: Variants = {
  hidden: {},
  show: { transition: { delayChildren: stagger(0.06) } },
};

const rise: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.18, ease: easeOut } },
};

const rows: Variants = {
  hidden: {},
  show: { transition: { delayChildren: stagger(0.05, { startDelay: 0.24 }) } },
};

const row: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.15, ease: easeOut } },
};

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden border-b border-border">
      <div aria-hidden="true" className="hero-grid pointer-events-none absolute inset-0" />
      <motion.div
        variants={sequence}
        initial="hidden"
        animate="show"
        className="relative mx-auto grid max-w-6xl items-center gap-14 px-6 pb-20 pt-16 md:pt-24 lg:grid-cols-12 lg:gap-10 lg:pb-28 lg:pt-28"
      >
        <div className="lg:col-span-7">
          <motion.p
            variants={rise}
            className="font-display text-label font-semibold uppercase text-muted-foreground"
          >
            External attack surface monitoring
          </motion.p>
          <motion.h1 variants={rise} className="mt-5 font-display text-display font-bold text-foreground">
            Find the exposed server before someone else does.
          </motion.h1>
          <motion.p variants={rise} className="mt-6 max-w-[34rem] text-lead text-muted-foreground">
            Tripline maps what your company has on the public internet, rechecks it on a schedule, and
            tells you in plain words what changed and how to close it.
          </motion.p>
          <motion.div variants={rise} className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button asChild size="lg">
              <a href="#pricing">
                Start a 14-day trial
                <ArrowRight className="size-4" aria-hidden="true" />
              </a>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <a href="#coverage">See what it checks</a>
            </Button>
          </motion.div>
          <motion.p variants={rise} className="mt-5 text-small text-muted-foreground">
            The trial needs no card, and nothing gets installed on your servers.
          </motion.p>
        </div>

        <motion.div variants={rise} className="lg:col-span-5">
          <div className="overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-panel">
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
              <span className="flex min-w-0 items-center gap-2 text-small font-medium">
                <Globe className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">acme-corp.example</span>
              </span>
              <span className="shrink-0 rounded-sm border border-border px-2 py-0.5 font-display text-label font-semibold uppercase text-muted-foreground">
                Sample data
              </span>
            </div>
            <p className="px-5 pt-4 text-small text-muted-foreground">
              Last scan 14 min ago. 212 hosts watched, 5 open findings.
            </p>
            <motion.ul variants={rows} aria-label="Sample findings" className="mt-3 divide-y divide-border">
              {findings.map((finding) => {
                const style = levelStyle[finding.level];
                const Icon = style.icon;
                return (
                  <motion.li
                    key={finding.title}
                    variants={row}
                    className="grid grid-cols-[5.5rem_1fr_auto] items-start gap-3 px-5 py-3.5"
                  >
                    <span
                      className={`inline-flex items-center gap-1.5 justify-self-start rounded-sm px-2 py-1 font-display text-label font-semibold uppercase ${style.className}`}
                    >
                      <Icon className="size-3.5" aria-hidden="true" />
                      {finding.level}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-small font-medium text-foreground">{finding.title}</span>
                      <span className="block truncate text-small text-muted-foreground">{finding.host}</span>
                    </span>
                    <span className="pt-1 font-display text-label font-semibold uppercase text-muted-foreground">
                      {finding.age}
                    </span>
                  </motion.li>
                );
              })}
            </motion.ul>
            <div className="flex items-center gap-2 border-t border-border px-5 py-3 text-small text-muted-foreground">
              <span aria-hidden="true" className="size-1.5 rounded-pill bg-foreground" />
              Next scan in 5 h 46 min
            </div>
          </div>
        </motion.div>
      </motion.div>
    </section>
  );
}
