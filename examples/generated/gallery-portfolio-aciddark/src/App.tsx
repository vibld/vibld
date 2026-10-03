import { MotionConfig } from 'motion/react';

import { SiteLayout } from '@/components/SiteLayout';
import { Home } from '@/pages/Home';

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <SiteLayout>
        <Home />
      </SiteLayout>
    </MotionConfig>
  );
}
