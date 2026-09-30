import { useState } from 'react';
import { Link, data, useLoaderData } from 'react-router';

import type { Route } from './+types/layer';
import { PageHead } from '../components/SiteChrome';
import { LAYERS } from '../layers';
import { SITE, metaFor } from '../site';

/** routes.ts declares one path per layer, as it does for each design. */
function slugOf(pathname: string): string {
  return (
    pathname
      .replace(/\/+$/, '')
      .replace(/\.data$/, '')
      .split('/')
      .pop() ?? ''
  );
}

export function meta({ location }: Route.MetaArgs) {
  return metaFor(`/templates/${slugOf(location.pathname)}`);
}

export async function loader({ request }: Route.LoaderArgs) {
  const { layerPrompt } = await import('../layer-prompts.server');
  const slug = slugOf(new URL(request.url).pathname);
  const layer = LAYERS.find((candidate) => candidate.slug === slug);
  if (!layer) throw data('Not found', { status: 404 });
  return { layer, prompt: layerPrompt(slug) };
}

/**
 * One of Chris's clean-room layers (D101): the reference page it produced,
 * served as it is, and the prompt that directs an AI to produce it.
 */
export default function Layer() {
  const { layer, prompt } = useLoaderData<typeof loader>();
  const kind = layer.kind === 'page' ? 'Landing page' : 'Page section';
  return (
    <>
      <PageHead
        eyebrow={`Templates · ${kind}`}
        title={layer.name}
        lead={layer.summary}
      />
      <section className="lb-section lb-section--tight">
        <div className="lb-wrap lb-tpl-detail">
          <a className="lb-layer__shot" href={layer.livePath}>
            <img
              src={layer.screenshot}
              width={1440}
              height={900}
              alt={`${layer.name}, as its prompt produced it`}
            />
          </a>
          <p className="lb-after__cta">
            <a className="button" href={layer.livePath}>
              Open the live page
            </a>
            <a className="lb-link" href={layer.promptPath}>
              Download the prompt
            </a>
          </p>
          <p className="lb-tpl__facts">{layer.stack}.</p>

          <h2 id="prompt">The prompt</h2>
          <p>
            One prompt that asks for one self-contained HTML file. The live page
            is the reference output it produced.
          </p>
          <CopyPrompt text={prompt} />
          <pre className="lb-tpl-prompt">{prompt.trim()}</pre>

          <p className="lb-after__cta">
            <a className="button" href={SITE.appUrl}>
              Open the builder
            </a>
            <Link className="lb-link" to="/templates">
              All templates
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}

function CopyPrompt({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <p>
      <button
        type="button"
        className="button"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
      >
        Copy the prompt
      </button>{' '}
      <span role="status">{copied ? 'Copied.' : ''}</span>
    </p>
  );
}
