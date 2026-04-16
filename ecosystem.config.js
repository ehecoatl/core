global.fs = global.fs ?? require('fs');
global.JSON5 = require('json5');

try{
  global.config = JSON5.parse( global.fs.readFileSync(`${__dirname}/app/_config.json`) );
}catch(e){
  global.config = { default_version: "001" };
}

const EHECATL_WEBSERVER_VERSION = global.config.default_version;
const EHECATL_LOG_OUT_FILE = `_log/_pm2-out.log`;
const EHECATL_LOG_ERROR_FILE = `_log/_pm2-err.log`;

module.exports = {
  apps : [{
    name      : 'Ehecatl',
    out_file  : `${__dirname}/${EHECATL_LOG_OUT_FILE}`,
    error_file: `${__dirname}/${EHECATL_LOG_ERROR_FILE}`,
    script    : `${__dirname}/app/${EHECATL_WEBSERVER_VERSION}/main.js`,
    max_memory_restart: '200M',
    //exec_mode : "fork",
    instances : "max", // Uses all available CPU cores
    //instances : 0,
    autorestart : true,
    //watch       : false,
    watch: [
      `${__dirname}/ecosystem.config.js`,
      `${__dirname}/app/${EHECATL_WEBSERVER_VERSION}`
    ], 
    watch_options: { "followSymlinks": false }, 
    watch_delay: 15000, //15s
    ignore_watch: ["*.log"],
    env: {
      NODE_ENV: 'development',
      LOG_OUT_FILE: EHECATL_LOG_OUT_FILE,
      LOG_ERROR_FILE: EHECATL_LOG_ERROR_FILE
    },
    env_production: {
      NODE_ENV: 'production',
      LOG_OUT_FILE: EHECATL_LOG_OUT_FILE,
      LOG_ERROR_FILE: EHECATL_LOG_ERROR_FILE
    }
  }]
};