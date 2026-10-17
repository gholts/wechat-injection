import { buildIPA } from './builder.js';

self.onmessage = async ({ data }) => {
  try {
    const blob = await buildIPA(data, (message) => self.postMessage({ type: 'progress', message }));
    self.postMessage({ type: 'done', blob });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Signing stopped. Try a desktop browser with more available memory.' });
  } finally { self.close(); }
};
