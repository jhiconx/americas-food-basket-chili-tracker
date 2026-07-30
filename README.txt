AMERICA'S FOOD BASKET TRACKER — V13 CLEAN TRANSFER FIX

This update keeps the existing CHILI login and dashboard unchanged.

Replace:
  api/live.js

Add at the repository root:
  vercel.json

The transfer request now uses Blockscout's canonical address token-transfer route without the optional query parameters that were returning HTTP 500. The code filters CHI transfers and outgoing 5 CHI rewards locally.

Commit message:
  Fix clean CHI transfer request
