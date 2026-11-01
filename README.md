# Aravind S — portfolio

A buildless, self-hosted portfolio for GitHub Pages. HTML, CSS, and a small progressive-enhancement script. No runtime dependencies or tracking.

## Preview

Run `python3 -m http.server 8000` from this directory and open http://localhost:8000. URLs are root-relative, matching the user GitHub Pages domain.

## Content

- `index.html`: introduction, five projects, experience, credentials, contact.
- `work/`: three project write-ups.
- `style.css`: responsive layout, reduced-motion and print styles.
- `site.js`: workflow illustration controls, Kochi clock, copy email.
- `assets/`: self-hosted Manrope fonts (OFL license), favicon, social preview.

All essential content and navigation work without JavaScript. Project illustrations are explanatory, not product screenshots or measured metrics. The legacy WebGL site and Three.js dependencies have been removed; they remain recoverable in Git history.

## Deployment

GitHub Pages serves the root of `main`. No build step is needed. `.nojekyll` prevents processing. Check the Pages deployment after publishing a commit.
