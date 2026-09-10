import { aboutPoints } from '../data/content'

const mockBars = [42, 68, 55, 82, 61, 94]

export default function About() {
  return (
    <section className="section about" id="about">
      <div className="shell about__grid">
        <div className="about__media" data-reveal>
          <div className="media-stack" aria-hidden="true">
            <div className="media-card media-card--back">
              <span className="mock-bar" />
              <span className="mock-line" />
              <span className="mock-line mock-line--short" />
            </div>

            <div className="media-card media-card--mid">
              <span className="mock-bar" />
              <div className="mock-chart">
                {mockBars.map((height, index) => (
                  <span key={index} style={{ height: `${height}%` }} />
                ))}
              </div>
            </div>

            <div className="media-card media-card--front">
              <span className="mock-bar" />
              <span className="mock-line" />
              <span className="mock-line" />
              <span className="mock-line mock-line--short" />
              <div className="mock-footer">
                <span className="mock-dot mock-dot--amber" />
                <span className="mock-dot mock-dot--teal" />
                <span className="mock-dot mock-dot--steel" />
              </div>
            </div>
          </div>
        </div>

        <div className="about__copy" data-reveal>
          <p className="eyebrow">
            <span className="eyebrow__dot" />
            About NStar Systems
          </p>
          <h2 className="section__title">Twenty years of doing the unglamorous work well.</h2>
          <p className="section__lede">
            NStar Systems was founded by engineers who were tired of watching organizations buy
            technology they could not maintain. We stay deliberately mid-sized so the people who
            design your environment are the people who answer when something breaks.
          </p>

          <ul className="about__list">
            {aboutPoints.map((point) => (
              <li key={point}>
                <span className="about__bullet" aria-hidden="true" />
                {point}
              </li>
            ))}
          </ul>

          <a className="btn btn--primary" href="#contact">
            Request an Assessment
          </a>
        </div>
      </div>
    </section>
  )
}
