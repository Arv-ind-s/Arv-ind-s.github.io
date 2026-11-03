# Aravind S - portfolio

A static, buildless portfolio for GitHub Pages. HTML, CSS, a small enhancement script, self-hosted fonts, and no trackers or runtime dependencies.

## Preview

Run `python3 -m http.server 8000` from this directory. Open http://localhost:8000.

## Content and hierarchy

- `index.html`: concise introduction, featured Thought2Build product, supporting builds, engineering approach, experience, compact credentials, and contact.
- `work/`: three case studies with confirmed solo ownership, decisions, tradeoffs, scope, and evidence.
- `assets/Aravind_S_AI_Engineer_Resume_v2.pdf`: the user-supplied resume, published unchanged. `assets/Aravind-S-Resume.pdf` is an identical compatibility copy for existing links.
- `assets/thought2build-live.webp`: capture of the public product page. The caption distinguishes its marketing preview from a private workspace.
- `assets/onboarding-worked-example.md`: manually authored teaching example used by the four-stage artifact explorer. It is not generated output or customer data.
- `style.css`: responsive typography, sticky navigation, 3D responsibility layers, print and reduced-motion styles.
- `site.js`: artifact and approach controls, finite motion, copy email. All essential content and navigation work without JavaScript.

Thought2Build has priority as the fully working, deployed product. SentinelIQ and Covenant Radar are solo hackathon demonstrators with public source code. Their scope and evaluation context must stay explicit. Do not add unsupported launch dates, usage figures, testimonials, or claims of enterprise deployment.

The SentinelIQ figures refer to the repository evaluation report generated 10 August 2026 on simulated data with templated narration and the LLM disabled. They must not be presented as live-plant performance.

## Publishing

`.github/workflows/pages.yml` stages only website files, publishes CSS/JS under content-hashed filenames, and writes `release.json` with the exact commit and asset map. One release runs at a time. `main` is the publication branch. Confirm the public release marker and browser behavior before reporting a release live.

## Spatial treatment

The desktop introduction previews Thought2Build as four physical artifact sheets. Selecting a sheet selects the corresponding teaching example; selecting an example updates the preview. The public product capture uses a raised frame and bounded pointer perspective. Reading text stays on a stable plane. Mobile retains shallow static depth without pointer tilt, and reduced-motion preferences disable dynamic transforms.
