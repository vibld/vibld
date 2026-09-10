const chartBars = [46, 62, 54, 78, 66, 88, 72, 94, 80, 100]

export default function Hero() {
  return (
    <section className="hero" id="top">
      <div className="hero__scene" aria-hidden="true">
        <span className="orb orb--amber" />
        <span className="orb orb--teal" />
        <span className="orb orb--navy" />
        <div className="grid-floor" />
      </div>

      <div className="shell hero__inner">
        <div className="hero__copy">
          <p className="eyebrow" data-reveal>
            <span className="eyebrow__dot" />
            Managed IT · Cloud · Cybersecurity
          </p>

          <h1 className="hero__title" data-reveal>
            Technology that carries
            <span className="hero__title-accent">your business forward.</span>
          </h1>

          <p className="lede" data-reveal>
            NStar Systems designs, deploys and manages the networks, cloud platforms and security
            programs that keep growing organizations running — reliably, securely and at scale.
          </p>

          <div className="hero__actions" data-reveal>
            <a className="btn btn--primary" href="#solutions">
              Explore Our Solutions
            </a>
            <a className="btn btn--ghost" href="#contact">
              Talk to an Expert
            </a>
          </div>

          <ul className="hero__proof" data-reveal>
            <li>
              <strong>99.98%</strong>
              <span>Network uptime, measured monthly</span>
            </li>
            <li>
              <strong>24/7</strong>
              <span>Live monitoring and service desk</span>
            </li>
            <li>
              <strong>500+</strong>
              <span>Organizations supported</span>
            </li>
          </ul>
        </div>

        <div className="hero__stage">
          <article className="float-card float-card--a">
            <header className="float-card__head">
              <span className="card-label">Network health</span>
              <span className="card-chip">
                <span className="card-chip__dot" />
                Live
              </span>
            </header>
            <p className="card-value">99.98%</p>
            <p className="float-card__meta">Across 1,240 monitored devices</p>
            <div className="bar-chart" aria-hidden="true">
              {chartBars.map((height, index) => (
                <span
                  key={index}
                  className="bar"
                  style={{ height: `${height}%`, animationDelay: `${index * 0.07}s` }}
                />
              ))}
            </div>
          </article>

          <article className="float-card float-card--b">
            <span className="card-label">Security posture</span>
            <div className="ring">
              <span className="ring__value">A</span>
            </div>
            <p className="float-card__meta">No critical findings open</p>
          </article>

          <article className="float-card float-card--c">
            <span className="card-label">Cloud migration</span>
            <p className="card-value card-value--sm">72%</p>
            <p className="float-card__meta">Workloads moved to Azure</p>
            <div className="progress" aria-hidden="true">
              <span className="progress__fill" />
            </div>
          </article>

          <article className="float-card float-card--d">
            <span className="card-chip">
              <span className="card-chip__dot" />
              Resolved
            </span>
            <p className="float-card__meta">Ticket #4821 closed in 6 minutes</p>
          </article>
        </div>
      </div>
    </section>
  )
}
