import HeroSection from "@/components/HeroSection";
import ServicesSection from "@/components/ServicesSection";
import CaseStudiesSection from "@/components/CaseStudiesSection";

interface HomePageProps {
  onNavigateContact: () => void;
}

export default function HomePage({ onNavigateContact }: HomePageProps) {
  return (
    <>
      <HeroSection onNavigateContact={onNavigateContact} />
      <ServicesSection />
      <CaseStudiesSection />
    </>
  );
}
