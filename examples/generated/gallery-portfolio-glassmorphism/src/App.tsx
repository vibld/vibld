import { MotionConfig } from 'motion/react';
import SiteHeader from '@/components/SiteHeader';
import Hero from '@/components/Hero';
import Gallery from '@/components/Gallery';
import Bio from '@/components/Bio';
import Contact from '@/components/Contact';
import SiteFooter from '@/components/SiteFooter';

export default function App() {
  return (
    <MotionConfig reducedMotion='user'>
      <div className='bg-background text-foreground antialiased'>
        <SiteHeader />
        <main>
          <Hero />
          <Gallery />
          <Bio />
          <Contact />
        </main>
        <SiteFooter />
      </div>
    </MotionConfig>
  );
}
