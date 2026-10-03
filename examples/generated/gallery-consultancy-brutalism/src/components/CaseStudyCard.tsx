import type { CaseStudy } from "@/lib/data";

interface CaseStudyCardProps {
  caseStudy: CaseStudy;
}

export default function CaseStudyCard({ caseStudy }: CaseStudyCardProps) {
  return (
    <article className="border-4 border-black bg-white p-6 shadow-hard md:p-8">
      <h3 className="font-display text-2xl uppercase leading-tight tracking-tight md:text-3xl">
        {caseStudy.title}
      </h3>
      <p className="mt-2 text-sm font-bold uppercase tracking-wider text-black">
        {caseStudy.client}
      </p>
      <div className="mt-6 grid gap-6">
        <div>
          <h4 className="text-sm font-bold uppercase tracking-wider">Problem</h4>
          <p className="mt-2 text-base leading-relaxed text-black">
            {caseStudy.problem}
          </p>
        </div>
        <div>
          <h4 className="text-sm font-bold uppercase tracking-wider">Approach</h4>
          <p className="mt-2 text-base leading-relaxed text-black">
            {caseStudy.approach}
          </p>
        </div>
        <div>
          <h4 className="text-sm font-bold uppercase tracking-wider">Result</h4>
          <p className="mt-2 text-base leading-relaxed text-black">
            {caseStudy.result}
          </p>
        </div>
      </div>
    </article>
  );
}
