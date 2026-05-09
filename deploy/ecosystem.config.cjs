module.exports = {
  apps: [
    {
      name: 'lexiland-read-backend',
      cwd: '/opt/lexiland-read/backend',
      script: 'dist/index.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        LEARNING_DATA_DIR: '/srv/lexiland/data',
        AI_TEXT_PROVIDER: 'openai',
        OPENAI_MODEL: 'gpt-4o-mini',
        ALLOWED_ORIGINS: 'https://read.echosun.link',
      },
    },
  ],
};
