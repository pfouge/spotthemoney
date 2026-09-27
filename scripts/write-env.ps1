# Builds .env from a database password pasted at the prompt, then applies migrations.
# Usage:  .\scripts\write-env.ps1   (paste the password when asked, press Enter)
Set-Location (Split-Path $PSScriptRoot -Parent)
$pw = (Read-Host "Paste the Supabase database password, then press Enter").Trim()
if ($pw.Length -lt 8 -or $pw -match '\s') { Write-Error "That does not look like a password (length $($pw.Length))."; exit 1 }
@"
DATABASE_URL=postgresql://postgres.phjjhazaiejrykmbyrpy:$pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require
PUBLIC_SITE_URL=https://spotthemoney.com
PUBLIC_CF_ANALYTICS_TOKEN=
PUBLIC_AD_CLIENT=
FEC_API_KEY=
TWELVEDATA_API_KEY=
LDA_API_KEY=
"@ | Set-Content -Encoding utf8 .env
Clear-Host
Write-Host ".env written (password length $($pw.Length))"
npm run migrate
