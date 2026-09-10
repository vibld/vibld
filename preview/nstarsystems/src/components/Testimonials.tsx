import { quotes } from '../data/content'

export default function Testimonials() {
  return (
    <section className="section quotes" id="testimonials">
      <div className="shell">
        <div className="section__head" data-reveal>
          <p className="eyebrow">
            <span className="eyebrow__dot" />
            Client perspective
          </p>
          <h2 className="section__title">What our clients say when the pressure is on.</h2>
        </div>

        <div className="quote-grid">
          {quotes.map((quote) => (
            <figure className="quote-card" data-reveal key={quote.name}>
              <span className="quote-card__mark" aria-hidden="true">
                “
              </span>
              <blockquote className="quote-card__text">{quote.text}</blockquote>
              <figcaption className="quote-card__who">
                <strong className="quote-card__name">{quote.name}</strong>
                <span className="quote-card__role">
                  {quote.role}, {quote.organization}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  )
}
