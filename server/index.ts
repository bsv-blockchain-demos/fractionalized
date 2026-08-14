import { getPort } from './config';
import { boot } from './boot';
import { buildApp } from './app';

boot()
  .then(() => {
    const app = buildApp();
    app.listen(getPort(), () => {
      console.log(`[server] listening on :${getPort()}`);
    });
  })
  .catch((err) => {
    console.error('[server] boot failed:', err);
    process.exit(1);
  });
