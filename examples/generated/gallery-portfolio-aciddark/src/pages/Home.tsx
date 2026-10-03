import { Hero } from '@/components/sections/Hero';
import { Gallery } from '@/components/sections/Gallery';
import { Bio } from '@/components/sections/Bio';
import { Contact } from '@/components/sections/Contact';

export function Home() {
  return (
    <>
      <Hero />
      <Gallery />
      <Bio />
      <Contact />
    </>
  );
}
