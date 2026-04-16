const EHECATL_WEBSERVER_VERSION = "001";

module.exports = {
  apps : [{
    name      : 'Ehecatl',
    script    : `${__dirname}/src/${EHECATL_WEBSERVER_VERSION}/main.js`,
    error_file: `${__dirname}/log/_pm2-err.log`,
    out_file  : `${__dirname}/log/_pm2-out.log`,
    max_memory_restart: '200M',
    exec_mode : "fork",
    //instances : "max", // Uses all available CPU cores
    //instances : 0,
    autorestart : true,
    //watch       : false,
    watch: [
      `${__dirname}/ecosystem.config.js`,
      `${__dirname}/src/${EHECATL_WEBSERVER_VERSION}`
    ], 
    watch_options: { "followSymlinks": false }, 
    watch_delay: 15000, //15s
    ignore_watch: ["*.log"],
    env: {
      NODE_ENV: 'development'
    },
    env_production: {
      NODE_ENV: 'production'
    }
  }]
};