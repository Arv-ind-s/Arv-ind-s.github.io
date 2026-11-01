# Aravind S — portfolio

A buildless, self-hosted portfolio for GitHub Pages. HTML, CSS, and a small progressive-enhancement script. No runtime dependencies or tracking.

## Preview

Run `python3 -m http.server 8000` from this directory and open http://localhost:8000. URLs are root-relative, matching the user GitHub Pages domain.

## Content

- `index.html`: introduction, five projects, experience, credentials, contact.
- `work/`: three project write-ups.
- `style.css`: responsive layout, reduced-motion and print styles.
- `site.js`: project workflow controls, the Define / Verify / Deliver approach explorer, Kochi clock, and copy email.
- `assets/`: self-hosted Manrope fonts (OFL license), favicon, social preview.

All essential content and navigation work without JavaScript. Project illustrations are explanatory, not product screenshots or measured metrics. The legacy WebGL site and Three.js dependencies have been removed; they remain recoverable in Git history.

## Deployment

GitHub Pages is published by `.github/workflows/pages.yml` from `main`. The workflow stages only the static site files and writes `release.json` with the exact deployed commit. Releases run one at a time. No framework build or runtime dependencies are required.

## Portfolio hierarchy

Thought2Build is the featured live product and takes precedence over the other projects. The hero introduces Aravind’s engineering approach, with project evidence attached to each responsibility. The three spatial layers are Define, Verify, and Deliver; their purpose is explained in adjacent readable content. Without JavaScript, all three explanations remain available.
