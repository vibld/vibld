import SiteLayout from '@/components/SiteLayout';
import HeroSection from '@/components/sections/HeroSection';
import LineupSection from '@/components/sections/LineupSection';
import ScheduleSection from '@/components/sections/ScheduleSection';
import TicketsSection from '@/components/sections/TicketsSection';
import DirectionsSection from '@/components/sections/DirectionsSection';

export default function Home() {
  return (
    <SiteLayout>
      <HeroSection />
      <LineupSection />
      <ScheduleSection />
      <TicketsSection />
      <DirectionsSection />
    </SiteLayout>
  );
}
