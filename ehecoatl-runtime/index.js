// index.js


'use strict';


try {
  require(`module-alias/register`);
  const bootstrap = require(`@/bootstrap/bootstrap`);

  bootstrap()
    .catch(async (e) => {
      console.error("[FATAL BOOTSTAP ERROR]");
      console.error(e);
      console.error("Bootstrap composing failed");
      await new Promise((r) => setTimeout(r, 500));
      process.exit(1);
    });
} catch (e) {
  console.error("[FATAL STARTUP ERROR]");
  console.error(e);
  console.error(`Shutting down process.`);
  (async () => {
    await new Promise((r) => setTimeout(r, 500));
    process.exit(1);
  })();
}
