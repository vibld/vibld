import { MotionConfig } from 'motion/react';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';
import Home from '@/pages/Home';

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <SiteHeader />
      <main>
        <Home />
      </main>
      <SiteFooter />
    </MotionConfig>
  );
}
