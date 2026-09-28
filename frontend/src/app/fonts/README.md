# Self-hosted fonts

Latin variable subsets, downloaded once and committed so `next/font/local`
(`src/lib/fonts.ts`) never needs the network — not at build time, not at
runtime. Files come from Google Fonts; all three families are SIL Open Font
License 1.1.

| File | Family | Axis served | Used for |
|---|---|---|---|
| `inter-latin-var.woff2` | Inter | `wght 100 900` | UI text (`--font-sans`) |
| `jost-latin-var.woff2` | Jost | `wght 400 700` | brand + display type (`--font-display`) |
| `jetbrains-mono-latin-var.woff2` | JetBrains Mono | `wght 400 700` | ids, seeds, timings (`--font-mono`) |

Jost is the wordmark typeface of the VDN logo lockup (`assets/Logo/source`), so
brand surfaces match the supplied artwork exactly.

To refresh a file:

```powershell
$ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
$css = (Invoke-WebRequest "https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap" `
        -Headers @{ 'User-Agent' = $ua } -UseBasicParsing).Content
# the last url(...woff2) in the sheet is the `latin` subset
[regex]::Matches($css, 'url\((https://fonts\.gstatic\.com/[^)]+\.woff2)\)') |
  Select-Object -Last 1 | ForEach-Object { $_.Groups[1].Value }
```

Swap the family query for `Jost:wght@400..700` or
`JetBrains+Mono:wght@400..700` and keep the same filenames so
`src/lib/fonts.ts` stays valid.
