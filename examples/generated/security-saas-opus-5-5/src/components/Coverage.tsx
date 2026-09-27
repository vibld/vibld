import type { LucideIcon } from 'lucide-react';
import { BellOff, FileText, Globe, Unplug, Webhook } from 'lucide-react';
import { Reveal } from '@/components/Reveal';

const sources = [
  'Certificate transparency logs',
  'Passive and active DNS',
  'Registered IP ranges',
  'Cloud provider hostnames',
];

const assets = [
  { host: 'api.acme-corp.example', status: 'Confirmed', muted: false },
  { host: 'staging.acme-corp.example', status: 'Confirmed', muted: false },
  { host: 'dev-billing.acme-corp.example', status: 'Needs review', muted: false },
  { host: 'status.acme-corp.example', status: 'Vendor, out of scope', muted: true },
];

type Cell = {
  icon: LucideIcon;
  title: string;
  body: string;
  className: string;
};

const cells: Cell[] = [
  {
    icon: FileText,
    title: 'Findings read like tickets',
    body: 'Each one names the host, what is exposed, why it matters and the change that closes it, with the raw evidence attached: the HTTP response, the certificate or the DNS record.',
    className: '',
  },
  {
    icon: BellOff,
    title: 'Quiet until something changes',
    body: 'You hear about new findings and ones that got worse. An issue you have accepted as a known risk stays silent unless its severity rises.',
    className: '',
  },
  {
    icon: Unplug,
    title: 'Nothing to install',
    body: 'Scans run from outside your network. There are no agents to deploy, no firewall rules to open and no credentials to hand over.',
    className: '',
  },
  {
    icon: Webhook,
    title: 'Alerts where you already work',
    body: 'Send findings to Slack, Microsoft Teams, email or any webhook, routed by severity and by domain. PagerDuty comes with Business.',
    className: 'md:col-span-2 lg:col-span-1',
  },
];

export function Coverage() {
  return (
    <section id="coverage" className="py-24 lg:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal className="max-w-3xl">
          <p className="font-display text-label font-semibold uppercase text-muted-foreground">Coverage</p>
          <h2 className="mt-4 font-display text-title font-bold text-foreground">
            Everything an attacker can see from outside, checked on a schedule.
          </h2>
          <p className="mt-5 max-w-2xl text-lead text-muted-foreground">
            Tripline looks at your company the way a stranger with a port scanner would, then files what it
            finds as work your team can close.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-2 lg:grid-cols-3">
          <div className="bg-background p-6 sm:p-8 md:col-span-2 lg:row-span-2">
            <Reveal>
              <Globe className="size-6 text-foreground" aria-hidden="true" />
              <h3 className="mt-5 font-display text-heading font-semibold text-foreground">
                It starts from one domain
              </h3>
              <p className="mt-3 max-w-xl text-muted-foreground">
                Give Tripline your root domain. It follows public records outward to find hosts your team
                forgot about, then asks you to confirm which ones are yours before it scans them.
              </p>
              <div className="mt-8 grid gap-8 md:grid-cols-[1fr_1.5fr]">
                <div>
                  <p className="font-display text-label font-semibold uppercase text-muted-foreground">
                    Where it looks
                  </p>
                  <ul className="mt-3 space-y-2">
                    {sources.map((source) => (
                      <li key={source} className="flex items-start gap-2.5 text-foreground">
                        <span aria-hidden="true" className="mt-2.5 size-1.5 shrink-0 rounded-pill bg-muted-foreground" />
                        {source}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="min-w-0">
                  <p className="font-display text-label font-semibold uppercase text-muted-foreground">
                    Asset map (sample)
                  </p>
                  <ul className="mt-3 divide-y divide-border rounded-md border border-border">
                    {assets.map((asset) => (
                      <li key={asset.host} className="flex items-center justify-between gap-3 px-3 py-2.5 text-small">
                        <span className={`min-w-0 truncate ${asset.muted ? 'text-muted-foreground' : 'text-foreground'}`}>
                          {asset.host}
                        </span>
                        <span
                          className={`shrink-0 whitespace-nowrap ${asset.muted ? 'text-muted-foreground' : 'font-medium text-foreground'}`}
                        >
                          {asset.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Reveal>
          </div>

          <div className="relative overflow-hidden bg-background p-6 sm:p-8">
            <Reveal>
              <p
                aria-hidden="true"
                className="-mr-14 -mt-2 text-right font-display text-numeral font-bold text-foreground sm:-mr-16"
              >
                6h
              </p>
              <h3 className="mt-6 font-display text-heading font-semibold text-foreground">Rescan interval</h3>
              <p className="mt-3 text-muted-foreground">
                Every confirmed host is rescanned every six hours on Team, and every hour on Business.
              </p>
            </Reveal>
          </div>

          {cells.map((cell) => {
            const Icon = cell.icon;
            return (
              <div key={cell.title} className={`bg-background p-6 sm:p-8 ${cell.className}`}>
                <Reveal>
                  <Icon className="size-6 text-foreground" aria-hidden="true" />
                  <h3 className="mt-5 font-display text-heading font-semibold text-foreground">{cell.title}</h3>
                  <p className="mt-3 text-muted-foreground">{cell.body}</p>
                </Reveal>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
