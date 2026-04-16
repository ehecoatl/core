/** @format */

const fs = require(`node:fs`);

const EHECATL_LOG_DIR = `/var/opt/ehecatl/logs`;
const EHECATL_LOG_OUT_FILE = `${EHECATL_LOG_DIR}/pm2-out.log`;
const EHECATL_LOG_ERROR_FILE = `${EHECATL_LOG_DIR}/pm2-err.log`;

fs.mkdirSync(EHECATL_LOG_DIR, { recursive: true });

module.exports = {
  apps: [
    {
      name: "Ehecatl",
      out_file: EHECATL_LOG_OUT_FILE,
      error_file: EHECATL_LOG_ERROR_FILE,
      script: `${__dirname}`,
      max_memory_restart: "200M",
      stop_exit_codes: [0],
      restart_delay: 1000,
      //exp_backoff_restart_delay: 1000,
      exec_mode: "fork",
      instances: 1, // PM2 runs one main runtime; engine fan-out is controlled inside Ehecatl.
      autorestart: true,
      watch: false,
      //watch: [
      //  `${__dirname}/ecosystem.config.js`,
      //  `${__dirname}`
      //],
      //watch_options: { "followSymlinks": false },
      //watch_delay: 15000, //15s
      //ignore_watch: ["*.log"],
      env: {
        NODE_ENV: "development"
      },
      env_production: {
        NODE_ENV: "production"
      },
    },
  ],
};
