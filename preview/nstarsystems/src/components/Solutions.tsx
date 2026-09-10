import { solutions } from '../data/content'

export default function Solutions() {
  return (
    <section className="section solutions" id="solutions">
      <div className="shell">
        <div className="section__head" data-reveal>
          <p className="eyebrow">
            <span className="eyebrow__dot" />
            What we do
          </p>
          <h2 className="section__title">Six disciplines, one accountable team.</h2>
          <p className="section__lede">
            Every engagement is delivered by the same engineers who scoped it. No handoffs to
            subcontractors, no tickets that disappear into a queue.
          </p>
        </div>

        <div className="solution-grid">
          {solutions.map((solution, index) => (
            <div className="solution-slot" data-reveal key={solution.id}>
              <article className={`solution-card solution-card--${solution.accent}`}>
                <span className="solution-card__glow" aria-hidden="true" />
                <span className="solution-card__index">{String(index + 1).padStart(2, '0')}</span>
                <h3 className="solution-card__title">{solution.title}</h3>
                <p className="solution-card__summary">{solution.summary}</p>
                <ul className="solution-card__points">
                  {solution.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </article>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
