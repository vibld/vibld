import type { DemoSiteId } from '../demo-sites.ts';

/**
 * A small drawing of the kind of page a use case produces: a gallery, a
 * dashboard, a menu, a calendar, a phone, a ticket. Shapes in the brand's
 * inks on a tinted card, no text, so nothing here has to be read.
 */
export function UseCaseVisual({ demo }: { demo: DemoSiteId }) {
  switch (demo) {
    case 'portfolio':
      return (
        <div className="lb-use__v lb-u-port" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
      );
    case 'saas':
      return (
        <div className="lb-use__v lb-u-saas" aria-hidden="true">
          <div className="lb-u-saas__side" />
          <div className="lb-u-saas__main">
            <i style={{ height: '40%' }} />
            <i style={{ height: '62%' }} />
            <i style={{ height: '48%' }} />
            <i style={{ height: '78%' }} />
            <i style={{ height: '92%' }} />
          </div>
        </div>
      );
    case 'clinic':
      return (
        <div className="lb-use__v lb-u-clin" aria-hidden="true">
          {['M', 'T', 'W', 'T', 'F'].map((day, index) => (
            <span key={index}>{day}</span>
          ))}
          {[
            '',
            'gone',
            '',
            '',
            'gone',
            'gone',
            '',
            'pick',
            '',
            '',
            '',
            '',
            'gone',
            '',
            '',
          ].map((state, index) => (
            <i key={index} className={state ? `is-${state}` : undefined} />
          ))}
        </div>
      );
    case 'cafe':
      return (
        <div className="lb-use__v lb-u-cafe" aria-hidden="true">
          <ul>
            {[40, 30, 48, 36].map((width) => (
              <li key={width}>
                <i style={{ width: `${width}%` }} />
                <s />
                <b />
              </li>
            ))}
          </ul>
          <div className="lb-cup" />
        </div>
      );
    case 'event':
    case 'pottery':
      return (
        <div className="lb-use__v lb-u-evt" aria-hidden="true">
          <div className="lb-ticket">
            <div className="lb-ticket__l">
              <i />
              <i />
            </div>
            <div className="lb-ticket__r" />
          </div>
        </div>
      );
    case 'app':
      return (
        <div className="lb-use__v lb-u-app" aria-hidden="true">
          <div className="lb-phone">
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
        </div>
      );
  }
}
