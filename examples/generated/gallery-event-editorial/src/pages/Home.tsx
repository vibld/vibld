import { Hero } from '@/components/home/Hero';
import { FeaturedLineup } from '@/components/home/FeaturedLineup';
import { PullQuote } from '@/components/home/PullQuote';
import { LogisticsPreview } from '@/components/home/LogisticsPreview';

export default function Home() {
  return (
    <>
      <Hero />
      <FeaturedLineup />
      <PullQuote />
      <LogisticsPreview />
    </>
  );
}
