import { steps } from '../data/content'

export default function Process() {
  return (
    <section className="section process" id="process">
      <div className="shell">
        <div className="section__head" data-reveal>
          <p className="eyebrow">
            <span className="eyebrow__dot" />
            Our process
          </p>
          <h2 className="section__title">Four phases, documented at every step.</h2>
          <p className="section__lede">
            The same method applies whether we are replacing a firewall or rebuilding a data
            center. You always know what happens next and who is responsible for it.
          </p>
        </div>

        <div className="process__wrap">
          <div className="process__rail" aria-hidden="true">
            <span className="process__fill" />
          </div>

          <ol className="process__steps">
            {steps.map((step) => (
              <li className="step" data-reveal key={step.number}>
                <div className="step__card">
                  <span className="step__num">{step.number}</span>
                  <h3 className="step__title">{step.title}</h3>
                  <p className="step__body">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}
