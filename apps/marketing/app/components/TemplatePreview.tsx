import type { CSSProperties, ReactNode } from 'react';

import type { PreviewBlock, PreviewSpec } from '../template-preview.ts';

/**
 * A template's homepage, mocked up in HTML and CSS from its own layout,
 * palette and typefaces (D106; see app/template-preview.ts for what each
 * block comes from). Everything is sized in container units, so the same
 * drawing fills a card, a template's page or its share image.
 *
 * Hidden from assistive technology: it is an illustration, and the card
 * around it says in words what it is.
 */
export function TemplatePreview({ spec }: { spec: PreviewSpec }) {
  const c = spec.colors;
  const vars = {
    '--tp-bg': c.background,
    '--tp-fg': c.foreground,
    '--tp-card': c.card,
    '--tp-card-fg': c.cardForeground,
    '--tp-muted': c.muted,
    '--tp-muted-fg': c.mutedForeground,
    '--tp-primary': c.primary,
    '--tp-on-primary': c.onPrimary,
    '--tp-accent': c.accent,
    '--tp-border': c.border,
    '--tp-radius': spec.radius,
    '--tp-display': spec.display,
    '--tp-body': spec.body,
  } as CSSProperties;
  const nav = spec.blocks.find(
    (b): b is Extract<PreviewBlock, { kind: 'nav' }> => b.kind === 'nav',
  );
  const rest = spec.blocks.filter((b) => b.kind !== 'nav');

  const content = rest.map((block, i) => (
    <Block key={i} block={block} spec={spec} />
  ));

  return (
    <div className="tp" style={vars} aria-hidden="true">
      <div className="tp__page">
        {spec.shell === 'sidebar' ? (
          <div className="tp__shell">
            <aside className="tp__rail">
              <b className="tp__brand">{spec.name}</b>
              {(nav?.links ?? []).map((link) => (
                <span key={link} className="tp__rail-link">
                  {link}
                </span>
              ))}
            </aside>
            <div className="tp__main">{content}</div>
          </div>
        ) : (
          <>
            {nav ? (
              <div className="tp__nav">
                <b className="tp__brand">{spec.name}</b>
                <span className="tp__links">
                  {nav.links.map((link) => (
                    <span key={link}>{link}</span>
                  ))}
                </span>
                <span className="tp__button tp__button--sm">{spec.cta}</span>
              </div>
            ) : null}
            {content}
          </>
        )}
      </div>
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <span className="tp__label">{children}</span>;
}

function Block({ block, spec }: { block: PreviewBlock; spec: PreviewSpec }) {
  switch (block.kind) {
    case 'hero': {
      const copy = (
        <div className="tp__hero-copy">
          <b className="tp__headline">{spec.headline}</b>
          <span className="tp__sub">{spec.sub}</span>
          <span className="tp__actions">
            <span className="tp__button">{spec.cta}</span>
            <span className="tp__button tp__button--ghost">Learn more</span>
          </span>
        </div>
      );
      return (
        <div className={`tp__hero tp__hero--${block.layout}`}>
          {copy}
          {block.layout === 'split' ? <div className="tp__art" /> : null}
        </div>
      );
    }
    case 'grid':
      return (
        <div className="tp__section">
          <Label>{block.label}</Label>
          <div className={`tp__grid tp__grid--${block.columns}`}>
            {Array.from({ length: block.columns }, (_, i) => (
              <div key={i} className="tp__card">
                <i className="tp__icon" />
                <i className="tp__line" />
                <i className="tp__line tp__line--short" />
              </div>
            ))}
          </div>
        </div>
      );
    case 'bento':
      return (
        <div className="tp__section">
          <Label>{block.label}</Label>
          <div className="tp__bento">
            <div className="tp__card tp__card--wide">
              <i className="tp__figure">$42k</i>
            </div>
            <div className="tp__card" />
            <div className="tp__card tp__card--tint" />
            <div className="tp__card" />
          </div>
        </div>
      );
    case 'stats':
      return (
        <div className="tp__section tp__stats">
          {['98%', '4.9', '12k'].map((figure) => (
            <span key={figure}>
              <b>{figure}</b>
              <i className="tp__line tp__line--short" />
            </span>
          ))}
        </div>
      );
    case 'quote':
      return (
        <div className="tp__section">
          <div className="tp__card tp__quote">
            <b>“</b>
            <i className="tp__line" />
            <i className="tp__line tp__line--short" />
          </div>
        </div>
      );
    case 'list':
      return (
        <div className="tp__section">
          <Label>{block.label}</Label>
          <div className="tp__list">
            {[0, 1, 2].map((i) => (
              <span key={i}>
                <i className="tp__dot" />
                <i className="tp__line" />
                <i className="tp__pill" />
              </span>
            ))}
          </div>
        </div>
      );
    case 'timeline':
      return (
        <div className="tp__section">
          <Label>{block.label}</Label>
          <div className="tp__steps">
            {[1, 2, 3, 4].map((n) => (
              <span key={n}>
                <b>{n}</b>
                <i className="tp__line tp__line--short" />
              </span>
            ))}
          </div>
        </div>
      );
    case 'form':
      return (
        <div className="tp__section">
          <div className="tp__card tp__form">
            <Label>{block.label}</Label>
            <i className="tp__field" />
            <i className="tp__field" />
            <span className="tp__button">Continue</span>
          </div>
        </div>
      );
    case 'pricing':
      return (
        <div className="tp__section">
          <Label>{block.label}</Label>
          <div className="tp__grid tp__grid--3">
            {['$0', '$19', '$49'].map((price, i) => (
              <div
                key={price}
                className={`tp__card${i === 1 ? ' tp__card--pick' : ''}`}
              >
                <b className="tp__price">{price}</b>
                <i className="tp__line" />
                <i className="tp__line tp__line--short" />
              </div>
            ))}
          </div>
        </div>
      );
    case 'gallery':
      return (
        <div className="tp__section">
          <Label>{block.label}</Label>
          <div className="tp__gallery">
            {[0, 1, 2, 3].map((i) => (
              <i key={i} className="tp__art" />
            ))}
          </div>
        </div>
      );
    case 'text':
      return (
        <div className="tp__section">
          <Label>{block.label}</Label>
          <i className="tp__line" />
          <i className="tp__line" />
          <i className="tp__line tp__line--short" />
        </div>
      );
    case 'footer':
      return (
        <div className="tp__footer">
          <b className="tp__brand">{spec.name}</b>
          <i className="tp__line tp__line--short" />
        </div>
      );
    case 'nav':
      return null;
  }
}
