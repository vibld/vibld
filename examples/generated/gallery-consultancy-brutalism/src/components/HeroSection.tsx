import { Button } from "@/components/ui/button";

interface HeroSectionProps {
  onNavigateContact?: () => void;
}

export default function HeroSection({ onNavigateContact }: HeroSectionProps) {
  const scrollToServices = () => {
    document.getElementById("services")?.scrollIntoView({
      behavior: "auto",
      block: "start",
    });
  };

  return (
    <section className="border-b-4 border-black bg-white px-6 py-20 md:px-12 md:py-28 lg:px-24">
      <div className="max-w-5xl">
        <h1 className="font-display text-6xl uppercase leading-[0.95] tracking-tight sm:text-8xl lg:text-9xl">
          We fix how work moves through your company
        </h1>
        <p className="mt-8 max-w-2xl text-lg leading-relaxed text-black md:text-xl">
          Hale & Voss is a management consultancy that installs operating systems managers can run themselves. We leave a weekly routine your managers run without us.
        </p>
        <div className="mt-10 flex flex-col gap-4 sm:flex-row">
          <Button
            type="button"
            size="lg"
            onClick={scrollToServices}
          >
            Our services
          </Button>
          <Button
            type="button"
            size="lg"
            variant="secondary"
            onClick={onNavigateContact}
          >
            Contact us
          </Button>
        </div>
      </div>
    </section>
  );
}
