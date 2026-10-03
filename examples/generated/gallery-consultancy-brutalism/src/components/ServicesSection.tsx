import { services } from "@/lib/data";
import ServiceCard from "./ServiceCard";

export default function ServicesSection() {
  return (
    <section id="services" className="scroll-mt-4 border-b-4 border-black bg-muted px-6 py-20 md:px-12 md:py-28 lg:px-24">
      <div className="max-w-6xl">
        <p className="text-sm font-bold uppercase tracking-wider text-black">What we do</p>
        <h2 className="mt-4 font-display text-4xl uppercase leading-tight tracking-tight sm:text-5xl md:text-6xl">
          Services
        </h2>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-black">
          Four places where mid-sized companies lose money without noticing. We work on one at a time and leave a routine the team keeps running.
        </p>
        <div className="mt-12 grid gap-8 md:grid-cols-2">
          {services.map((service) => (
            <ServiceCard key={service.title} service={service} />
          ))}
        </div>
      </div>
    </section>
  );
}
