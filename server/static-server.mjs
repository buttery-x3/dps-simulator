import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from './app.mjs';

const distRoot = fileURLToPath(new URL('../dist/', import.meta.url));
await access(new URL('../dist/index.html', import.meta.url));
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 4009);
const server = await createStaticServer(distRoot);
server.listen(port, host, () =>
  console.log(`dps-simulator serving on http://${host}:${port}`)
);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
