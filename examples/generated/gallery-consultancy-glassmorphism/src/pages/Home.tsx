import { Hero } from '@/components/sections/Hero';
import { Services } from '@/components/sections/Services';
import { CaseStudies } from '@/components/sections/CaseStudies';
import { ContactForm } from '@/components/sections/ContactForm';

export default function Home() {
  return (
    <>
      <Hero />
      <Services />
      <CaseStudies />
      <ContactForm />
    </>
  );
}
