**- Server Functionalities**

 - Routes
  - Multiple domains/subdomains routing
  - Alias domains/subdomains router
  - Session & CSRF Token handling
  - Unnoficial Crawler protection
  - Access rate limiting

 - Response
  - Translated response building

 - Services
  - Debugging options
  - Autobackup files (TODO: after changes)

**Extras:**
- 404 pages response cache

**Default Scripts/Config to be loaded**
- loader.json

**Cloudflare Settings**
- config/services.json

Scripts & Config match names

**Ehecatl Future**
- CUSTOM LIMITER PER ROUTE
- Easy --websocket-- setup (HTTP POOLING IN API / WSS FOR REALTIME)
- Clear cache for route groups
- Cleaning cache for those (Last modified in cached_routes)
- Check if there was modification
- Sync Backup to Drive

- Ehecatl Panel Access
 - See Server Dentais / Config
 - List Domains
 - Toggle/Watch Log
 - Restart PM2 app
 - List Backups / Make Backup / Download Backup
 - Update Server Config
 - Custom Domains Endpoints

 - PER SITE: WOLIMP
 - - sync cloudflare config ips for subdomains
 - - sync data/updates between servers