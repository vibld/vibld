import { RoadmapBoard } from '../components/RoadmapBoard';
import { PageHead } from '../components/SiteChrome';
import { metaFor } from '../site';

export function meta() {
  return metaFor('/roadmap');
}

/**
 * The public roadmap, from app/roadmap.ts, with a vote on everything not yet
 * shipped (Chris, 2026-09-27).
 *
 * The page says the counts are indicative because that is all they can be:
 * a vote is one per browser, not one per person, and nothing short of an
 * account could make it more. Saying so beside the numbers is cheaper than
 * anyone reading them as a poll.
 */
export default function Roadmap() {
  return (
    <>
      <PageHead
        eyebrow="Roadmap"
        title="What is being built, and what comes next"
        lead="Outcomes, not delivery dates. Vote for anything not yet built: there is no sign-in, and a second press takes the vote back."
      >
        <p className="lb-honest">
          Counts are indicative: one vote per browser, not per person.
        </p>
      </PageHead>
      <RoadmapBoard />
    </>
  );
}
