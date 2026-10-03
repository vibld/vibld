import { MotionConfig } from 'motion/react';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import Hero from '@/components/sections/Hero';
import Lineup from '@/components/sections/Lineup';
import Schedule from '@/components/sections/Schedule';
import Tickets from '@/components/sections/Tickets';
import Directions from '@/components/sections/Directions';

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <SiteHeader />
      <main>
        <Hero />
        <Lineup />
        <Schedule />
        <Tickets />
        <Directions />
      </main>
      <SiteFooter />
    </MotionConfig>
  );
}
