import { MotionConfig } from 'motion/react';

import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { Hero } from '@/components/Hero';
import { Gallery } from '@/components/Gallery';
import { About } from '@/components/About';
import { Contact } from '@/components/Contact';

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <div
        id="top"
        className="min-h-svh bg-background font-body text-foreground antialiased"
      >
        <SiteHeader />
        <main>
          <Hero />
          <Gallery />
          <About />
          <Contact />
        </main>
        <SiteFooter />
      </div>
    </MotionConfig>
  );
}
