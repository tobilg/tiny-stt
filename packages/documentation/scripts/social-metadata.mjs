import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { JSX, RendererEvent } from 'typedoc';

const siteTitle = 'tiny-stt API documentation';
const description =
  'Guides and API reference for tiny-stt: local speech-to-text in browsers and Node.js with a TypeScript SDK, CLI and React hooks.';
const imageAlt =
  'tiny-stt: local speech-to-text for browsers and Node.js, with a TypeScript SDK, CLI and React hooks.';

/** Add static social previews to every generated page, including watch builds. */
export function load(app) {
  app.renderer.on(RendererEvent.BEGIN, () => {
    app.renderer.preRenderAsyncJobs.push(async ({ outputDirectory }) => {
      const assets = join(outputDirectory, 'assets');
      await mkdir(assets, { recursive: true });
      await copyFile(
        new URL('../assets/opengraph.jpg', import.meta.url),
        join(assets, 'opengraph.jpg'),
      );
    });
  });

  app.renderer.hooks.on('head.end', (context) => {
    const baseUrl = context.options.getValue('hostedBaseUrl');
    const isHome = context.page.url === 'index.html';
    const title = isHome ? siteTitle : `${context.page.model.name} | ${siteTitle}`;
    const url = new URL(context.page.url.replace(/index\.html$/, ''), baseUrl).href;
    const imageUrl = new URL('assets/opengraph.jpg', baseUrl).href;
    const openGraph = {
      'og:type': 'website',
      'og:site_name': 'tiny-stt',
      'og:title': title,
      'og:description': description,
      'og:url': url,
      'og:image': imageUrl,
      'og:image:type': 'image/jpeg',
      'og:image:width': '1200',
      'og:image:height': '630',
      'og:image:alt': imageAlt,
    };
    const twitter = {
      'twitter:card': 'summary_large_image',
      'twitter:title': title,
      'twitter:description': description,
      'twitter:image': imageUrl,
      'twitter:image:alt': imageAlt,
    };

    return JSX.createElement(
      JSX.Fragment,
      null,
      // TypeDoc supplies the homepage canonical link via hostedBaseUrl.
      !isHome && JSX.createElement('link', { rel: 'canonical', href: url }),
      ...Object.entries(openGraph).map(([property, content]) =>
        JSX.createElement('meta', { property, content }),
      ),
      ...Object.entries(twitter).map(([name, content]) =>
        JSX.createElement('meta', { name, content }),
      ),
    );
  });
}
