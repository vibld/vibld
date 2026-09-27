import { MotionConfig } from 'motion/react';
import { Masthead } from '@/components/Masthead';
import { Hero } from '@/components/Hero';
import { Gallery } from '@/components/Gallery';
import { PullQuote } from '@/components/PullQuote';
import { About } from '@/components/About';
import { Plate } from '@/components/Plate';
import { Commissions } from '@/components/Commissions';
import { Footer } from '@/components/Footer';
import { Allotment } from '@/components/artworks';

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <Masthead />
      <main>
        <Hero />
        <Gallery />
        <PullQuote />
        <About />
        <Plate
          number="08"
          caption="Allotment, late summer. Gouache and ink, 48 x 27 cm, 2024."
          frameClassName="aspect-[4/5] md:aspect-[16/9] xl:aspect-[21/9]"
        >
          <Allotment />
        </Plate>
        <Commissions />
      </main>
      <Footer />
    </MotionConfig>
  );
}
