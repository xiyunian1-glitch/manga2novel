## Manga2Novel

Manga2Novel is a static-exported Next.js app for turning manga image batches into novel-style text in the browser.

## Getting Started

Install dependencies and run the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## GitHub Pages

Build a Pages-ready static export with:

```bash
npm run build
```

That build now writes `out/.nojekyll` automatically so GitHub Pages will serve the `/_next` assets instead of returning `404`.

Recommended setup:

- Push this source repo to GitHub.
- In GitHub `Settings > Pages`, set the source to `GitHub Actions`.
- Let `.github/workflows/deploy.yml` publish the `out/` directory.

If you temporarily deploy by committing exported files directly to a branch, keep `.nojekyll` committed at the published site root.

## Commands

- `npm run dev` starts the local dev server.
- `npm run build` creates the static export in `out/`.
- `npm run lint` runs ESLint.
