import { Link } from 'react-router';

import { PageHead } from '../components/SiteChrome';
import { UseCaseVisual } from '../components/UseCaseVisual';
import { metaFor } from '../site';
import { USE_CASES } from '../use-cases';

export function meta() {
  return metaFor('/use-cases');
}

/** The kinds of project people build, each with its own page. */
export default function UseCases() {
  return (
    <>
      <PageHead eyebrow="Use cases" title="Sites and apps, from one sentence" />
      <section className="lb-section lb-section--tight" aria-label="Use cases">
        <div className="lb-wrap">
          <ul className="lb-uses">
            {USE_CASES.map((useCase) => (
              <li
                key={useCase.slug}
                className={`lb-use lb-use--${useCase.slug} lb-tint--${useCase.tint}`}
              >
                <UseCaseVisual demo={useCase.demo} />
                <div className="lb-use__b">
                  <h2>
                    <Link to={`/use-cases/${useCase.slug}`}>
                      {useCase.title}
                    </Link>
                  </h2>
                  <p className="lb-use__q">{useCase.asks[0]}</p>
                  <p className="lb-use__lead">{useCase.lead}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="lb-more-link">
            <Link className="lb-link" to="/examples">
              Real output, exactly as generated
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}
