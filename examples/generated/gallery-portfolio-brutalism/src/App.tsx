import { MotionConfig } from 'motion/react';
import { Header } from '@/components/Header.tsx';
import { Hero } from '@/components/Hero.tsx';
import { Gallery } from '@/components/Gallery.tsx';
import { Bio } from '@/components/Bio.tsx';
import { ContactSection } from '@/components/ContactSection.tsx';
import { Footer } from '@/components/Footer.tsx';

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <div id="top" className="min-h-screen bg-background text-foreground">
        <Header />
        <main>
          <Hero />
          <Gallery />
          <Bio />
          <ContactSection />
        </main>
        <Footer />
      </div>
    </MotionConfig>
  );
}
