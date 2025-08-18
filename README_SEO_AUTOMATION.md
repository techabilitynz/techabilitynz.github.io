# Tech Ability – SEO & Sitemap Automation (NZ ISP)

This repo fragment adds two automations:

- **Auto SEO Inject** – updates every HTML file with consistent meta tags (title, description, canonical, OpenGraph, Twitter) and JSON‑LD for Organization + Services (Fibre & Hyperfibre in New Zealand). Includes your Facebook page in `sameAs`.
- **Sitemap** – generates `sitemap.xml` on each push to `main` and nightly. Excludes `/beta`, `/Beta`, `/backup`, `/Backup`, `/Backups`.

## Quick start

1. Copy the files into the **root** of your GitHub Pages repo.
2. Commit + push to `main`.
3. Done – the workflows will run automatically.

### Environment defaults
Edit these in `.github/workflows/auto-seo-inject.yml` if you ever need to change them:

```yaml
SITE_URL: https://www.techability.co.nz
SITE_NAME: Tech Ability
DEFAULT_IMAGE: https://i.postimg.cc/SQ6GFs1B/banner-1200-630.jpg
SITE_DESC: Tech ability Internet for New Zealand with Christchurch based support, plus tech support for phones, laptops, tablets, and smart homes, with friendly, accessible service.
FACEBOOK_URL: https://www.facebook.com/TechAbilityCHCH
```

### Run locally (optional)

```bash
npm run seo
npm run sitemap
```

This will update all `*.html` files in-place and write `sitemap.xml` at the repo root.
