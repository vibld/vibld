/**
 * How the template catalog is browsed (docs/decisions.md, D161): a category
 * (websites, apps or app screens) and, inside websites and apps, a
 * subcategory, laid out the way lovable.dev/templates lays out its own.
 *
 * The catalog carries its own `category` on every design, 38 of them, some
 * with only one design. A subcategory gathers one or more of those, so
 * nothing in the catalog changes; `ids` adds designs by name where no
 * catalog category says it (the Shopify storefronts, whose purpose names
 * Shopify).
 *
 * The style gallery's entries are listed here too (D162). Every one is a
 * website, and `styleGroups` names the gallery industries a website
 * subcategory takes.
 *
 * Small on purpose: the builder and every vibld.com page read it, and it
 * never imports the catalog.
 */

export type TemplateGroup = 'websites' | 'apps' | 'screens';

export interface TemplateGroupInfo {
  slug: TemplateGroup;
  label: string;
  /** "website", as a sentence says one. */
  noun: string;
}

export const TEMPLATE_GROUPS: readonly TemplateGroupInfo[] = [
  { slug: 'websites', label: 'Websites', noun: 'website' },
  { slug: 'apps', label: 'Apps', noun: 'app' },
  { slug: 'screens', label: 'App screens', noun: 'app screen' },
];

export interface TemplateSubcategory {
  slug: string;
  label: string;
  group: Exclude<TemplateGroup, 'screens'>;
  /** The catalog categories it gathers. */
  categories: readonly string[];
  /** Designs it takes by id, beside those its categories bring. */
  ids?: readonly string[];
  /** The label starts with a proper noun, kept capitalized in a sentence. */
  proper?: boolean;
  /** The style gallery industries it takes (D162), websites only. */
  styleGroups?: readonly string[];
}

/** In the order a gallery lists them. */
export const TEMPLATE_SUBCATEGORIES: readonly TemplateSubcategory[] = [
  {
    slug: 'portfolio',
    label: 'Portfolio',
    group: 'websites',
    styleGroups: ['agency-portfolio'],
    categories: ['portfolio'],
  },
  {
    slug: 'services',
    label: 'Local services',
    group: 'websites',
    categories: ['services'],
  },
  {
    slug: 'ecommerce',
    label: 'Ecommerce',
    group: 'websites',
    styleGroups: ['ecommerce'],
    categories: ['ecommerce'],
  },
  {
    slug: 'shopify',
    label: 'Shopify',
    group: 'websites',
    proper: true,
    categories: [],
    ids: ['hardline-depot', 'plain-matter'],
  },
  {
    slug: 'saas',
    label: 'SaaS',
    group: 'websites',
    styleGroups: [
      'saas',
      'design-tools',
      'devtools',
      'fintech',
      'productivity',
      'web3',
    ],
    categories: [
      'crm-sales',
      'analytics',
      'fintech',
      'hr-people',
      'marketing-tools',
      'productivity',
      'collaboration',
      'developer-tools',
    ],
  },
  {
    slug: 'ai-products',
    label: 'AI products',
    group: 'websites',
    styleGroups: ['ai'],
    categories: ['ai-product', 'automation'],
  },
  {
    slug: 'landing-page',
    label: 'Landing page',
    group: 'websites',
    styleGroups: ['general'],
    categories: [
      'landing-page',
      'marketing-site',
      'general-saas',
      'boilerplate',
    ],
  },
  { slug: 'blog', label: 'Blog', group: 'websites', categories: ['blog'] },
  {
    slug: 'editorial',
    label: 'Editorial',
    group: 'websites',
    styleGroups: ['media-publishing'],
    categories: ['editorial', 'documentation'],
  },
  { slug: 'music', label: 'Music', group: 'websites', categories: ['music'] },
  {
    slug: 'events',
    label: 'Events',
    group: 'websites',
    categories: ['events'],
  },
  {
    slug: 'resume',
    label: 'Resume',
    group: 'websites',
    categories: ['resume'],
  },
  {
    slug: 'internal-tools',
    label: 'Internal tools',
    group: 'apps',
    categories: ['internal-tools'],
  },
  { slug: 'saas', label: 'SaaS', group: 'apps', categories: ['saas'] },
  {
    slug: 'business-tools',
    label: 'Business tools',
    group: 'apps',
    categories: ['business-tools'],
  },
  {
    slug: 'dashboards',
    label: 'Dashboards',
    group: 'apps',
    categories: ['dashboard'],
  },
  {
    slug: 'productivity',
    label: 'Productivity',
    group: 'apps',
    categories: ['productivity', 'collaboration', 'editor'],
  },
  {
    slug: 'developer-tools',
    label: 'Developer tools',
    group: 'apps',
    categories: ['developer-tools', 'utility'],
  },
  {
    slug: 'starter-kits',
    label: 'Starter kits',
    group: 'apps',
    categories: ['boilerplate', 'multi-tenant', 'billing'],
  },
  { slug: 'finance', label: 'Finance', group: 'apps', categories: ['finance'] },
  {
    slug: 'project-management',
    label: 'Project management',
    group: 'apps',
    categories: ['project-management'],
  },
  {
    slug: 'product-management',
    label: 'Product management',
    group: 'apps',
    categories: ['product-management'],
  },
  {
    slug: 'education',
    label: 'Education',
    group: 'apps',
    categories: ['education'],
  },
  {
    slug: 'lifestyle',
    label: 'Lifestyle',
    group: 'apps',
    categories: ['lifestyle'],
  },
  {
    slug: 'presentations',
    label: 'Presentations',
    group: 'apps',
    categories: ['presentations'],
  },
];

/** What a design is browsed by: its kind, format, catalog category and id. */
export interface Categorized {
  id: string;
  kind: 'site' | 'app';
  format: string;
  category: string;
}

export function templateGroup(
  t: Pick<Categorized, 'kind' | 'format'>,
): TemplateGroup {
  if (t.format === 'screen') return 'screens';
  return t.kind === 'site' ? 'websites' : 'apps';
}

/** The subcategories a design is listed under, in gallery order. */
export function templateSubcategories(t: Categorized): TemplateSubcategory[] {
  const group = templateGroup(t);
  return TEMPLATE_SUBCATEGORIES.filter(
    (s) =>
      s.group === group &&
      (s.categories.includes(t.category) || (s.ids?.includes(t.id) ?? false)),
  );
}

/** The subcategory a style gallery entry is listed under, by its industry. */
export function styleSubcategory(
  styleGroup: string,
): TemplateSubcategory | undefined {
  return TEMPLATE_SUBCATEGORIES.find((s) =>
    s.styleGroups?.includes(styleGroup),
  );
}

/** A subcategory by its path, `websites/ecommerce`. */
export function findSubcategory(
  group: string,
  slug: string,
): TemplateSubcategory | undefined {
  return TEMPLATE_SUBCATEGORIES.find(
    (s) => s.group === group && s.slug === slug,
  );
}

/** The first subcategory's label, for a card that names one. */
export function primarySubcategoryLabel(t: Categorized): string | undefined {
  return templateSubcategories(t)[0]?.label;
}

/**
 * A subcategory as a heading names it: "Ecommerce templates", and "SaaS
 * website templates" where websites and apps share a label.
 */
export function subcategoryTitle(sub: TemplateSubcategory): string {
  const shared =
    TEMPLATE_SUBCATEGORIES.filter((s) => s.label === sub.label).length > 1;
  const noun = TEMPLATE_GROUPS.find((g) => g.slug === sub.group)!.noun;
  return `${sub.label} ${shared ? `${noun} ` : ''}templates`;
}

/**
 * A subcategory as a sentence says it: "local services", "SaaS" and
 * "Shopify".
 */
export function subcategoryPhrase(sub: TemplateSubcategory): string {
  const { label } = sub;
  if (sub.proper || /[A-Z]/.test(label.slice(1))) return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}
