# America's Food Basket Chili Rewards Tracker

A Vercel-ready Chili rewards tracker branded for **America's Food Basket** and configured for the public wallet:

`0x7d6eB946664f1dEFA40c9582819e251ae994a05e`

## What it does

- Tracks **Base CHI** activity tied to the wallet above
- Classifies an exact **5 CHI incoming** transfer as a **Reward**
- Classifies an exact **3 CHI outgoing** transfer as a **Redemption**
- Shows live metrics and a recent activity table
- Uses a Vercel serverless function at `/api/live`

## Files

- `index.html` — dashboard markup
- `styles.css` — America's Food Basket branding and layout
- `app.js` — frontend logic and rendering
- `api/live.js` — live Base data fetch and wallet-specific filtering
- `assets/` — logo, favicon, and Chili mascot

## Deploy on GitHub + Vercel

1. Upload this folder into your GitHub repo.
2. Keep this structure exactly:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `api/live.js`
   - `assets/...`
3. Import the repo into Vercel.
4. Framework preset can be **Other**.
5. No environment variables are required for this version.
6. Deploy.

## Live logic

The API endpoint reads Base CHI transfer history from Blockscout and filters it down to the tracked wallet only.

Metrics are wallet-scoped, not network-wide.
