import { type RouteConfig, index, route } from '@react-router/dev/routes';

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
] satisfies RouteConfig;
