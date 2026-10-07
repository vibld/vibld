import { type RouteConfig, index, route } from '@react-router/dev/routes';

import {
  TEMPLATE_GROUPS,
  TEMPLATE_SUBCATEGORIES,
} from '@vibld/ai/design-categories';
import { DESIGN_TEMPLATE_INDEX } from '@vibld/ai/design-template-index';
import { STYLE_GALLERY_INDEX } from '@vibld/ai/style-gallery-index';

import { LAYERS } from './layers';
import { STYLE_CARD_PATHS } from './style-cards';
import { USE_CASES } from './use-cases';

export default [
  index('routes/home.tsx'),
  // Not in ROUTES (app/site.ts) on purpose: it is prerendered but must never
  // appear in the sitemap. postbuild.ts moves it to /404.html.
  route('404', 'routes/not-found.tsx'),
  route('legal', 'routes/legal.index.tsx'),
  route('legal/terms', 'routes/legal.terms.tsx'),
  route('legal/privacy', 'routes/legal.privacy.tsx'),
  route('legal/acceptable-use', 'routes/legal.acceptable-use.tsx'),
  route('legal/security', 'routes/legal.security.tsx'),
  route('legal/subprocessors', 'routes/legal.subprocessors.tsx'),
  route('legal/cookies', 'routes/legal.cookies.tsx'),
  route('legal/refunds', 'routes/legal.refunds.tsx'),
  route('legal/licenses', 'routes/legal.licenses.tsx'),
  route('how-it-works', 'routes/how-it-works.tsx'),
  route('features', 'routes/features.tsx'),
  route('pricing', 'routes/pricing.tsx'),
  route('use-cases', 'routes/use-cases.index.tsx'),
  // One module for every use case, declared once per path rather than as
  // `use-cases/:slug`: a dynamic segment on a prerendered, server-less site
  // makes the build emit an SPA fallback page, which the asset store would
  // then serve at a URL nobody links to.
  ...USE_CASES.map((useCase) =>
    route(`use-cases/${useCase.slug}`, 'routes/use-case.tsx', {
      id: `use-case-${useCase.slug}`,
    }),
  ),
  route('styles', 'routes/styles.tsx'),
  // The style gallery (D143), one path per style for the same reason as the
  // use cases above.
  route('styles/gallery', 'routes/style-gallery.tsx'),
  ...STYLE_GALLERY_INDEX.map((style) =>
    route(`styles/gallery/${style.id}`, 'routes/style.tsx', {
      id: `style-${style.id}`,
    }),
  ),
  route('templates', 'routes/templates.tsx'),
  // The gallery once per category and subcategory (D161), each a page of
  // its own with only its own designs, for the same reason as the use cases
  // above.
  ...TEMPLATE_GROUPS.map((group) =>
    route(`templates/${group.slug}`, 'routes/templates.tsx', {
      id: `templates-${group.slug}`,
    }),
  ),
  ...TEMPLATE_SUBCATEGORIES.map((sub) =>
    route(`templates/${sub.group}/${sub.slug}`, 'routes/templates.tsx', {
      id: `templates-${sub.group}-${sub.slug}`,
    }),
  ),
  // The style cards' previews, fetched by the gallery (D162). Files, not
  // pages, so they are not in ROUTES or the sitemap.
  ...STYLE_CARD_PATHS.map((path, n) =>
    route(path.slice(1), 'routes/style-cards.ts', { id: `style-cards-${n}` }),
  ),
  // One module for every design, declared once per path for the same reason
  // as the use cases above.
  ...DESIGN_TEMPLATE_INDEX.map((template) =>
    route(`templates/${template.id}`, 'routes/template.tsx', {
      id: `template-${template.id}`,
    }),
  ),
  ...LAYERS.map((layer) =>
    route(`templates/${layer.slug}`, 'routes/layer.tsx', {
      id: `layer-${layer.slug}`,
    }),
  ),
  route('inspiration', 'routes/inspiration.tsx'),
  route('examples', 'routes/examples.tsx'),
  route('roadmap', 'routes/roadmap.tsx'),
  route('docs', 'routes/docs.index.tsx'),
  route('docs/getting-started', 'routes/docs.getting-started.tsx'),
  route('docs/the-builder', 'routes/docs.the-builder.tsx'),
  route('docs/running-your-project', 'routes/docs.running-your-project.tsx'),
  route('docs/taking-your-code', 'routes/docs.taking-your-code.tsx'),
  route('docs/credits-and-plans', 'routes/docs.credits-and-plans.tsx'),
  route('docs/self-hosting', 'routes/docs.self-hosting.tsx'),
  route('docs/configuration', 'routes/docs.configuration.tsx'),
  route('docs/deploying', 'routes/docs.deploying.tsx'),
  route('docs/hosted-vs-self-hosted', 'routes/docs.hosted-vs-self-hosted.tsx'),
] satisfies RouteConfig;
