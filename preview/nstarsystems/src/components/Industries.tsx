import { industries } from '../data/content'

export default function Industries() {
  return (
    <section className="section industries" id="industries">
      <div className="shell">
        <div className="section__head" data-reveal>
          <p className="eyebrow">
            <span className="eyebrow__dot" />
            Who we serve
          </p>
          <h2 className="section__title">Built for the industries we know best.</h2>
          <p className="section__lede">
            Regulated environments reward experience. We bring reference designs, compliance
            knowledge and support habits refined across hundreds of similar deployments.
          </p>
        </div>

        <div className="industry-grid">
          {industries.map((industry, index) => (
            <article className="industry-card" data-reveal key={industry.name}>
              <span className={`glyph glyph--${index}`} aria-hidden="true" />
              <h3 className="industry-card__name">{industry.name}</h3>
              <p className="industry-card__text">{industry.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
