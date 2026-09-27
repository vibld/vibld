import { MotionConfig } from 'motion/react';
import { SiteHeader } from '@/components/site-header';
import { Hero } from '@/components/hero';
import { Marquee } from '@/components/marquee';
import { Benefits } from '@/components/benefits';
import { CoffeeRail } from '@/components/coffee-rail';
import { Roastery } from '@/components/roastery';
import { Testimonials } from '@/components/testimonials';
import { Faq } from '@/components/faq';
import { Subscribe } from '@/components/subscribe';
import { SiteFooter } from '@/components/site-footer';

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <a
        href="#main"
        className="sr-only rounded-pill bg-primary px-5 py-3 font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main">
        <Hero />
        <Marquee />
        <Benefits />
        <CoffeeRail />
        <Roastery />
        <Testimonials />
        <Faq />
        <Subscribe />
      </main>
      <SiteFooter />
    </MotionConfig>
  );
}
