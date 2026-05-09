# LexiLand MVP Deployment

This folder contains the first-pass deployment files for the MVP server setup.

Target host:

- `read.echosun.link`

Current deployment assumptions:

- single shared data space
- existing `worddrop` stays on the same server
- `lexiland_read` backend listens on a different internal port
- reverse proxy handles routing by hostname
- app code lives under `/opt/lexiland-read`
- persistent data lives under `/srv/lexiland/data`

Files:

- `ecosystem.config.cjs`
  PM2 process config for the backend
- `Caddyfile.lexiland-read`
  Example Caddy site block for `read.echosun.link`
- `.env.production.example`
  Production backend environment example
