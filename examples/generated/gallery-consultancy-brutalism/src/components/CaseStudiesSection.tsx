import { caseStudies } from "@/lib/data";
import CaseStudyCard from "./CaseStudyCard";

export default function CaseStudiesSection() {
  return (
    <section className="border-b-4 border-black bg-white px-6 py-20 md:px-12 md:py-28 lg:px-24">
      <div className="max-w-6xl">
        <p className="text-sm font-bold uppercase tracking-wider text-black">Proof</p>
        <h2 className="mt-4 font-display text-4xl uppercase leading-tight tracking-tight sm:text-5xl md:text-6xl">
          Case studies
        </h2>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-black">
          Two engagements where the fix stayed after we left.
        </p>
        <div className="mt-12 grid gap-8 lg:grid-cols-2">
          {caseStudies.map((caseStudy) => (
            <CaseStudyCard key={caseStudy.title} caseStudy={caseStudy} />
          ))}
        </div>
      </div>
    </section>
  );
}
