// index.js


'use strict';


try {
  require(`module-alias/register`);
  const { intro } = require(`@/utils/logger/logger-startup`);

  intro()
    .then(require(`@/bootstrap/bootstrap-main`)) //BOOTSTRAP COMPOSE
    .catch(async (e) => {
      //BOOTSTRAP COMPOSING FAILED
      console.error("[FATAL BOOTSTAP ERROR]");
      console.error(e);
      console.error("Bootstrap composing failed");
      await new Promise((r) => setTimeout(r, 500));
      process.exit(0); // Process end with no restart
    });
} catch (e) {
  console.error("[FATAL STARTUP ERROR]");
  console.error(e);
  console.error(`Shutting down process.`);
  (async () => {
    await new Promise((r) => setTimeout(r, 500));
    process.exit(0); // Process end with no restart
  })();
}
