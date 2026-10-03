import type { Service } from "@/lib/data";

interface ServiceCardProps {
  service: Service;
}

export default function ServiceCard({ service }: ServiceCardProps) {
  return (
    <article className="border-4 border-black bg-white p-6 shadow-hard md:p-8">
      <h3 className="font-display text-2xl uppercase leading-tight tracking-tight md:text-3xl">
        {service.title}
      </h3>
      <p className="mt-4 text-base leading-relaxed text-black">
        {service.description}
      </p>
    </article>
  );
}
