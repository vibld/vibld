import ContactForm from "@/components/ContactForm";

export default function ContactPage() {
  return (
    <section className="border-b-4 border-black bg-white px-6 py-20 md:px-12 md:py-28 lg:px-24">
      <div className="max-w-2xl">
        <p className="text-sm font-bold uppercase tracking-wider text-black">Contact</p>
        <h1 className="mt-4 font-display text-4xl uppercase leading-tight tracking-tight sm:text-5xl md:text-6xl">
          Tell us what is stuck
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-black">
          Send a short note about a process that keeps breaking or a team that cannot keep up. We reply within one business day.
        </p>
        <div className="mt-12">
          <ContactForm />
        </div>
      </div>
    </section>
  );
}
