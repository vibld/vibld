import type { CSSProperties } from 'react';

import type { DemoSite, DemoSiteId } from '../demo-sites.ts';
import { lookVars } from '../looks.ts';
import type { Look } from '../looks.ts';

/**
 * A small site, drawn in HTML and CSS, in one visual direction.
 *
 * The same drawing serves the home page's demonstration and every preview
 * on /styles, so a direction looks the same wherever it is shown. No image
 * and no screenshot: the treatment is real CSS (the blur is a backdrop
 * filter, the hard shadow is a box shadow), which is the only honest way to
 * show what a treatment does without a build to capture.
 *
 * Hidden from assistive technology, because it is an illustration with
 * invented text in it. Whatever shows it says in words what it is.
 */

/** The regions the demonstration builds one at a time, and inspects. */
export const MINIATURE_REGIONS = [
  'Nav',
  'Hero',
  'HeroCopy',
  'HeroArt',
  'Section',
] as const;
export type MiniatureRegion = (typeof MINIATURE_REGIONS)[number];

export interface MiniatureStage {
  /** Drawn as a wireframe: dashed outlines, text as grey bars. */
  wire: boolean;
  /** Regions not yet in `shown` are hidden while this is set. */
  building: boolean;
  shown: ReadonlySet<MiniatureRegion>;
}

export function SiteMiniature({
  site,
  look,
  stage,
  className,
}: {
  site: DemoSite;
  look: Look;
  stage?: MiniatureStage;
  className?: string;
}) {
  const on = (region: MiniatureRegion) =>
    stage?.building && stage.shown.has(region) ? '' : undefined;
  const t = site.text;

  return (
    <div
      aria-hidden="true"
      className={`ms${className ? ` ${className}` : ''}`}
      data-look={look.id}
      data-ground={look.ground}
      data-source={look.source}
      data-site={site.id}
      data-wire={stage?.wire ? '' : undefined}
      data-building={stage?.building ? '' : undefined}
      style={lookVars(look) as CSSProperties}
    >
      <div className="ms-fx" />
      <div className="ms-in">
        <div className="ms-nav" data-el="Nav" data-on={on('Nav')}>
          <span className="ms-logo">{t.brand}</span>
          <span className="ms-links">
            {t.links.map((link) => (
              <span key={link}>{link}</span>
            ))}
          </span>
          <span className="ms-btn ms-btn--nav">{t.nav}</span>
        </div>
        <div className="ms-hero" data-el="Hero" data-on={on('Hero')}>
          <div className="ms-copy" data-el="HeroCopy" data-on={on('HeroCopy')}>
            <span className="ms-eyebrow">{t.eyebrow}</span>
            <span className="ms-h">{t.headline}</span>
            <span className="ms-p">{t.lead}</span>
            <span className="ms-row">
              <span className="ms-btn">{t.primary}</span>
              <span className="ms-btn ms-btn--ghost">{t.secondary}</span>
            </span>
          </div>
          <div className="ms-media" data-el="HeroArt" data-on={on('HeroArt')}>
            <Art site={site.id} />
          </div>
        </div>
        <div
          className="ms-cards"
          data-el="Section"
          data-name={site.section}
          data-on={on('Section')}
        >
          {t.cards.map(([title, detail], index) => (
            <div className="ms-card" key={title}>
              <b>{title}</b>
              <span>{detail}</span>
              <span className="ms-bar">
                <i style={{ width: `${site.bars[index]}%` }} />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * One illustration per kind of site. Shapes only, coloured from the look's
 * decoration hues by class, so the same drawing re-skins with the look.
 */
function Art({ site }: { site: DemoSiteId }) {
  switch (site) {
    case 'pottery':
      return (
        <svg viewBox="0 0 200 160">
          <circle className="a-sun" cx="150" cy="44" r="26" />
          <ellipse className="a-strong" cx="100" cy="136" rx="80" ry="15" />
          <ellipse className="a-top" cx="100" cy="131" rx="64" ry="10" />
          <path
            className="a-soft"
            d="M64 130c-12-26-8-56 14-70 5-4 6-11 2-18h40c-4 7-3 14 2 18 22 14 26 44 14 70z"
          />
          <path
            className="a-line"
            d="M70 92h60M68 108h64M76 74h48"
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'portfolio':
      return (
        <svg viewBox="0 0 200 160">
          <rect
            className="a-soft"
            x="26"
            y="24"
            width="86"
            height="112"
            rx="6"
          />
          <rect
            className="a-strong"
            x="122"
            y="24"
            width="52"
            height="52"
            rx="6"
          />
          <rect
            className="a-sun"
            x="122"
            y="84"
            width="52"
            height="52"
            rx="6"
          />
          <path
            className="a-line"
            d="M44 110c10-26 24-40 50-52"
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'saas':
      return (
        <svg viewBox="0 0 200 160">
          <rect
            className="a-soft"
            x="22"
            y="24"
            width="156"
            height="112"
            rx="12"
          />
          <rect
            className="a-strong"
            x="42"
            y="96"
            width="18"
            height="24"
            rx="3"
          />
          <rect
            className="a-strong"
            x="70"
            y="80"
            width="18"
            height="40"
            rx="3"
          />
          <rect
            className="a-strong"
            x="98"
            y="88"
            width="18"
            height="32"
            rx="3"
          />
          <rect
            className="a-strong"
            x="126"
            y="64"
            width="18"
            height="56"
            rx="3"
          />
          <path
            className="a-line"
            d="M42 64l30-12 28 8 44-22"
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle className="a-sun" cx="154" cy="44" r="10" />
        </svg>
      );
    case 'cafe':
      return (
        <svg viewBox="0 0 200 160">
          <circle className="a-sun" cx="100" cy="72" r="54" />
          <ellipse className="a-strong" cx="96" cy="136" rx="66" ry="9" />
          <path className="a-soft" d="M52 62h88v34a44 44 0 0 1-88 0z" />
          <path
            className="a-line"
            d="M140 70h10a14 14 0 0 1 0 28h-12"
            fill="none"
            strokeWidth="7"
            strokeLinecap="round"
          />
          <path
            className="a-line"
            d="M80 46c-6-8 6-12 0-22M100 46c-6-8 6-12 0-22M120 46c-6-8 6-12 0-22"
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'clinic':
      return (
        <svg viewBox="0 0 200 160">
          <rect
            className="a-soft"
            x="34"
            y="28"
            width="132"
            height="108"
            rx="12"
          />
          <rect
            className="a-strong"
            x="34"
            y="28"
            width="132"
            height="24"
            rx="12"
          />
          <g className="a-sun">
            <rect x="50" y="66" width="18" height="14" rx="3" />
            <rect x="76" y="66" width="18" height="14" rx="3" />
            <rect x="102" y="66" width="18" height="14" rx="3" />
            <rect x="50" y="90" width="18" height="14" rx="3" />
            <rect x="102" y="90" width="18" height="14" rx="3" />
            <rect x="50" y="112" width="18" height="14" rx="3" />
          </g>
          <rect
            className="a-strong"
            x="76"
            y="90"
            width="18"
            height="14"
            rx="3"
          />
          <circle className="a-strong" cx="146" cy="112" r="16" />
          <path
            className="a-cross"
            d="M146 104v16M138 112h16"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'event':
      return (
        <svg viewBox="0 0 200 160">
          <circle className="a-sun" cx="100" cy="64" r="46" />
          <rect
            className="a-soft"
            x="28"
            y="62"
            width="144"
            height="66"
            rx="12"
          />
          <path
            className="a-line"
            d="M132 66v58"
            fill="none"
            strokeWidth="2"
            strokeDasharray="4 4"
          />
          <rect
            className="a-strong"
            x="44"
            y="80"
            width="70"
            height="10"
            rx="3"
          />
          <rect
            className="a-strong"
            x="44"
            y="98"
            width="46"
            height="8"
            rx="3"
            opacity=".5"
          />
          <rect
            className="a-strong"
            x="142"
            y="80"
            width="18"
            height="30"
            rx="3"
          />
        </svg>
      );
    case 'app':
      return (
        <svg viewBox="0 0 200 160">
          <circle className="a-sun" cx="140" cy="50" r="30" />
          <rect
            className="a-soft"
            x="64"
            y="18"
            width="72"
            height="128"
            rx="14"
          />
          <rect
            className="a-strong"
            x="74"
            y="34"
            width="52"
            height="16"
            rx="4"
          />
          <circle className="a-strong" cx="82" cy="68" r="5" />
          <rect className="a-sun" x="92" y="64" width="34" height="8" rx="3" />
          <circle className="a-strong" cx="82" cy="88" r="5" />
          <rect className="a-sun" x="92" y="84" width="26" height="8" rx="3" />
          <circle
            className="a-line"
            cx="82"
            cy="108"
            r="5"
            fill="none"
            strokeWidth="2"
          />
          <rect className="a-sun" x="92" y="104" width="30" height="8" rx="3" />
        </svg>
      );
  }
}
