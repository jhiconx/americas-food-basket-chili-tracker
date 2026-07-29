# America's Food Basket Chili Rewards Tracker

A Vercel-ready Chili rewards tracker branded for **America's Food Basket** and configured for the public wallet:

`0x7d6eB946664f1dEFA40c9582819e251ae994a05e`

## What it tracks

- **Rewards Issued:** exact 5 CHI transfers into the tracked store wallet
- **Chilis Rewarded:** total CHI across those reward transfers
- **Shopper Wallets:** every unique counterparty address tied to the tracked store wallet, excluding the tracked wallet, the CHI token contract, and the zero address
- **Redemptions Completed:** exact 3 CHI transfers out of the tracked store wallet
- **Total Chilis Redeemed:** the total CHI across those redemption transfers
- Latest wallet-specific Base CHI activity

The dashboard includes manual refresh controls and automatically refreshes every 20 seconds.

## Files

- `index.html` — dashboard markup
- `styles.css` — America's Food Basket branding and layout
- `app.js` — frontend logic and 20-second refresh cycle
- `api/live.js` — live Base data fetch, wallet filtering, and real-time metric calculations
- `assets/` — logo, favicon, and Chili mascot

## Update an existing GitHub/Vercel deployment

1. Replace the existing repository files with the contents of this folder.
2. Keep this structure exactly:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `api/live.js`
   - `assets/...`
3. Commit directly to `main`.
4. Vercel should redeploy automatically.

No environment variables are required for this version.
