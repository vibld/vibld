import { useState } from 'react';
import { Link } from 'react-router';

import { GlowField } from '../components/GlowField';
import { HowItWorks } from '../components/HowItWorks';
import { Icon, Waves } from '../components/Icon';
import { Plans } from '../components/Plans';
import { SampleInbox } from '../components/SampleInbox';
import { Closing, SectionHead } from '../components/SiteChrome';
import { SourceTiles } from '../components/SourceTiles';
import type { SourceId } from '../glow-palette';
import { SITE, metaFor } from '../site';

export function meta() {
  return metaFor('/');
}

export default function Home() {
  // Shared by the sample inbox and the light behind it: picking a source
  // filters the messages and gives the field that source's colours.
  const [source, setSource] = useState<SourceId>('all');

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <GlowField source={source} />
        <Waves />
        <div className="wrap hero-inner">
          <p className="eyebrow">
            <span className="dot" aria-hidden="true" />
            Customer feedback software
            <span className="sep" aria-hidden="true" />
            <span className="tagline">{SITE.tagline}</span>
          </p>
          <h1 id="hero-title">
            Every customer voice. <em className="display-em">One inbox,</em> and
            a <span className="hl">roadmap you can defend.</span>
          </h1>
          <p className="lead">
            {SITE.name} gathers feedback from email, chat and your in-app widget
            into one inbox, groups it into themes, and tells your product team
            what to build next.
          </p>
          <div className="cta-row">
            <Link to="/contact" className="btn btn-warm">
              Get a demo
              <Icon name="arrow" />
            </Link>
            <Link to="/features" className="btn btn-ghost">
              See the features
            </Link>
          </div>
          <SampleInbox source={source} onSource={setSource} />
        </div>
      </section>

      <HowItWorks />

      <section className="sec after-band" aria-labelledby="tiles-title">
        <div className="wrap">
          <SectionHead
            id="tiles-title"
            kicker="Sources and destinations"
            warm
            title="Twelve ways in and out,"
            emphasis="none of them exotic"
            lead="Emberline reads from the channels your customers already use and writes to the tools your team already works in. These are kinds of tool rather than named products: connect whichever one you use for each."
          />
          <SourceTiles />
          <p className="tiles-more">
            Themes, ranking, replies and the export are described in full on the
            features page.{' '}
            <Link to="/features" className="link">
              See every feature
            </Link>
          </p>
        </div>
      </section>

      <section className="sec" aria-labelledby="price-title">
        <div className="wrap">
          <SectionHead
            id="price-title"
            kicker="Pricing"
            title="Priced per workspace,"
            emphasis="never per message"
            lead="A busy week costs the same as a quiet one, so nobody on your team has a reason to leave feedback unread."
          />
          <Plans />
          <p className="mt-6">
            <Link to="/pricing" className="link">
              Compare the plans in full
            </Link>
          </p>
        </div>
      </section>

      <Closing />
    </>
  );
}
