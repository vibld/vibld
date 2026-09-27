import { useState } from 'react';
import { MotionConfig } from 'motion/react';
import { SiteHeader } from '@/components/SiteHeader';
import { Hero } from '@/components/Hero';
import { Coverage } from '@/components/Coverage';
import { Steps } from '@/components/Steps';
import { Proof } from '@/components/Proof';
import { Pricing } from '@/components/Pricing';
import { Faq } from '@/components/Faq';
import { Contact } from '@/components/Contact';
import { SiteFooter } from '@/components/SiteFooter';
import type { PlanSelection } from '@/types';

export default function App() {
  const [selectedPlan, setSelectedPlan] = useState<PlanSelection | null>(null);

  function choosePlan(selection: PlanSelection) {
    setSelectedPlan(selection);
    document.getElementById('contact')?.scrollIntoView({ block: 'start' });
    window.setTimeout(() => {
      document.getElementById('contact-name')?.focus({ preventScroll: true });
    }, 60);
  }

  return (
    <MotionConfig reducedMotion="user">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-foreground focus:px-4 focus:py-3 focus:text-background"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main">
        <Hero />
        <Coverage />
        <Steps />
        <Proof />
        <Pricing onChoose={choosePlan} />
        <Faq />
        <Contact selectedPlan={selectedPlan} onClearPlan={() => setSelectedPlan(null)} />
      </main>
      <SiteFooter />
    </MotionConfig>
  );
}
