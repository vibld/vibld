import { useState } from 'react';
import { MotionConfig } from 'motion/react';
import { SiteHeader } from '@/components/SiteHeader';
import { Hero } from '@/components/Hero';
import { Services } from '@/components/Services';
import { Hours } from '@/components/Hours';
import { Directions } from '@/components/Directions';
import { SiteFooter } from '@/components/SiteFooter';
import { BookingDialog } from '@/components/BookingDialog';

export default function App() {
  const [bookingOpen, setBookingOpen] = useState(false);

  return (
    <MotionConfig reducedMotion="user">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-full focus:bg-card focus:px-5 focus:py-3 focus:font-medium focus:shadow-soft"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="outline-none">
        <Hero onBook={() => setBookingOpen(true)} />
        <Services />
        <Hours />
        <Directions />
      </main>
      <SiteFooter />
      <BookingDialog open={bookingOpen} onOpenChange={setBookingOpen} />
    </MotionConfig>
  );
}
