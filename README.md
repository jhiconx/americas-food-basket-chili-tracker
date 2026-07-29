# America's Food Basket Chili Rewards Tracker

A Vercel-ready Chili rewards tracker branded for **America's Food Basket** and configured for the public wallet:

`0x7d6eB946664f1dEFA40c9582819e251ae994a05e`

## What it does

- Tracks **Base CHI** activity tied to the wallet above
- Counts every exact **5 CHI outgoing** transfer as one **Reward Issued**
- Adds those exact 5 CHI reward distributions together for **Chilis Rewarded**
- Counts the unique recipient wallets for **Shopper Wallets**
- Reads the wallet's current CHI token balance for **Store CHI Balance**
- Refreshes automatically every 20 seconds and supports manual refresh
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

The API reads wallet-specific Base CHI transfer history from the public Base Blockscout indexer. The current token balance is read from Blockscout with a direct Base mainnet `balanceOf` RPC fallback. BaseScan links remain available in the dashboard for public verification.

Metrics are wallet-scoped, not network-wide.


## V5 stability fix

- Makes all live-status DOM updates null-safe.
- Removes obsolete redemption element references.
- Adds cache-busting query strings to CSS and JavaScript assets.


## New in V6

- Adds a **Live Campaigns** carousel above the activity table
- Shows campaign items scrolling from right to left
- Displays each product card with a visual tile and SKU text underneath
