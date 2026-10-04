import { createBlobApp } from '../server/blob-app.mjs';

let appPromise;

export default async function handler(req, res) {
  appPromise ??= createBlobApp().catch((error) => {
    appPromise = undefined;
    throw error;
  });
  const app = await appPromise;
  return app(req, res);
}
