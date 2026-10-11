import {
  MAX_SCREENSHOT_HEIGHT,
  type Screenshot,
  type ScreenshotWidth,
} from './mcp-server.ts';

/**
 * take_screenshot's browser (D190): Cloudflare Browser Rendering, driven
 * with `@cloudflare/puppeteer` over the Worker's `BROWSER` binding.
 *
 * Every capture is bounded, because the browser's time is billed and an
 * assistant's answer has to stay a size it can take in: the page gets a
 * fixed time to load and a capped wait for the network to go quiet, a
 * full page is cut at `MAX_SCREENSHOT_HEIGHT`, an image past
 * `MAX_SCREENSHOT_BYTES` is taken again as a JPEG, and the browser is
 * closed whatever happens.
 *
 * Only the slice of puppeteer used here is typed, so tests can lend a fake
 * browser and `node --test` never loads the package.
 */

/** Each width's window height: the builder's Desktop, Tablet and Phone frames. */
export const VIEWPORT_HEIGHTS: Record<ScreenshotWidth, number> = {
  1280: 800,
  768: 1024,
  390: 844,
};

/** How long the page has to load. */
export const NAVIGATION_TIMEOUT_MS = 20_000;
/** How long to wait, after it loads, for its requests to settle. */
export const NETWORK_IDLE_TIMEOUT_MS = 5_000;
/**
 * The largest image passed on, in bytes before base64. A PNG past it is
 * taken again as a JPEG, at falling quality until it fits.
 */
export const MAX_SCREENSHOT_BYTES = 1_500_000;
const JPEG_QUALITIES = [70, 45, 25];

export interface ScreenshotOptions {
  type: 'png' | 'jpeg';
  quality?: number;
  clip?: { x: number; y: number; width: number; height: number };
  captureBeyondViewport?: boolean;
}

export interface BrowserPage {
  setViewport(viewport: { width: number; height: number }): Promise<unknown>;
  goto(
    url: string,
    options: { waitUntil: 'load'; timeout: number },
  ): Promise<unknown>;
  waitForNetworkIdle(options: {
    idleTime: number;
    timeout: number;
  }): Promise<unknown>;
  evaluate<T>(fn: () => T): Promise<T>;
  screenshot(options: ScreenshotOptions): Promise<Uint8Array>;
}

export interface HeadlessBrowser {
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}

/** The binding, as `@cloudflare/puppeteer` takes it. */
export interface BrowserBinding {
  fetch: typeof fetch;
}

/** Opens a browser on the binding; loaded only when a capture is asked for. */
export async function launchBrowser(
  binding: BrowserBinding,
): Promise<HeadlessBrowser> {
  const puppeteer = (await import('@cloudflare/puppeteer')).default;
  return (await puppeteer.launch(binding)) as unknown as HeadlessBrowser;
}

export async function captureScreenshot(
  launch: () => Promise<HeadlessBrowser>,
  url: string,
  { width, fullPage }: { width: ScreenshotWidth; fullPage: boolean },
): Promise<Screenshot> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    const viewport = VIEWPORT_HEIGHTS[width];
    await page.setViewport({ width, height: viewport });
    await page.goto(url, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS });
    // A dev server keeps a socket open, and a page may poll: quiet enough
    // is enough, and a page that never goes quiet is taken as it is.
    await page
      .waitForNetworkIdle({ idleTime: 500, timeout: NETWORK_IDLE_TIMEOUT_MS })
      .catch(() => undefined);

    let height = viewport;
    let clipped = false;
    if (fullPage) {
      const scrollHeight = await page.evaluate(() =>
        Math.max(
          document.documentElement.scrollHeight,
          document.body?.scrollHeight ?? 0,
        ),
      );
      const whole = Math.max(viewport, Math.ceil(Number(scrollHeight) || 0));
      height = Math.min(whole, MAX_SCREENSHOT_HEIGHT);
      clipped = whole > MAX_SCREENSHOT_HEIGHT;
    }
    const clip = { x: 0, y: 0, width, height };
    const shoot = (options: Omit<ScreenshotOptions, 'clip'>) =>
      page.screenshot({ ...options, clip, captureBeyondViewport: fullPage });

    let image = await shoot({ type: 'png' });
    let mimeType: Screenshot['mimeType'] = 'image/png';
    for (const quality of JPEG_QUALITIES) {
      if (image.byteLength <= MAX_SCREENSHOT_BYTES) break;
      image = await shoot({ type: 'jpeg', quality });
      mimeType = 'image/jpeg';
    }
    if (image.byteLength > MAX_SCREENSHOT_BYTES) {
      throw new Error(`screenshot still ${image.byteLength} bytes`);
    }
    return { data: toBase64(image), mimeType, width, height, clipped };
  } finally {
    await browser.close().catch((error: unknown) => {
      console.error('could not close the screenshot browser', error);
    });
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
