// pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'lead-contact',
      script: 'src/index.js',
      args: 'run --watch',
      cwd: __dirname, // .env va rc-store.json shu papkadan o'qiladi
      autorestart: true,
      restart_delay: 30000,
      max_memory_restart: '700M',
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      time: true,
    },
  ],
};
