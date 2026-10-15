<#
.SYNOPSIS
    Creates the RabbitOS donation / anchoring wallet key in Google Cloud KMS (project rabbitsoftware-io, us-west2). Idempotent. -WhatIf prints the plan and changes nothing.
.DESCRIPTION
    Key ring   rabbit-wallet
    Key        maxwell-donations   asymmetric signing, EC secp256k1 (the curve Bitcoin and Ethereum use), protection level HSM
    The private key is created inside Google's hardware security module and can never be exported or read, by anyone, including you and Google staff. It can only be asked to SIGN.
    Who can sign: only identities with roles/cloudkms.signer on this key. This script grants that to NOBODY (project owners can manage the key; use Grant-WalletSigner only if you decide on a signing service later).
    Deleting: Google keeps a destroyed key version recoverable for 30 days (destroy-scheduled duration). Funds sent to an address are only spendable while the key version exists.
    Public key  saved to wallet/public-key.pem in rabbitsoftware-cloudflare (it is public by design). Addresses are derived from it by workers/wallet (tested against published vectors).
    Cost        about $1-2.50 a month for an HSM key plus tiny signing fees.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Project = 'rabbitsoftware-io',
    [string]$Location = 'us-west2',
    [string]$KeyRing = 'rabbit-wallet',
    [string]$Key = 'maxwell-donations',
    [string]$PublicKeyOut = 'C:\Users\odaat\Projects\rabbitsoftware-cloudflare\workers\wallet\public-key.pem'
)
$ErrorActionPreference = 'Stop'
$preview = [bool]$WhatIfPreference
$WhatIfPreference = $false
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Invoke-IfLive([string]$what, [scriptblock]$run) { if ($preview) { Write-Host "What if: $what" } else { & $run } }
function Invoke-Gcloud { & gcloud @args; if ($LASTEXITCODE -ne 0) { throw "gcloud $($args[0..3] -join ' ') failed (exit $LASTEXITCODE)" } }
function Exists { $null = & gcloud @args 2>$null; return ($LASTEXITCODE -eq 0) }

Step 'Cloud KMS'
Invoke-IfLive 'enable cloudkms.googleapis.com' { Invoke-Gcloud services enable cloudkms.googleapis.com --project $Project }

Step "Key ring $KeyRing"
Invoke-IfLive "create the key ring in $Location" {
    if (-not (Exists kms keyrings describe $KeyRing --location $Location --project $Project)) { Invoke-Gcloud kms keyrings create $KeyRing --location $Location --project $Project; Write-Host "created: $KeyRing" }
    else { Write-Host "key ring exists: $KeyRing" }
}

Step "Key $Key (secp256k1, hardware protected)"
Invoke-IfLive 'create the signing key (EC_SIGN_SECP256K1_SHA256, HSM). The private key never leaves the HSM.' {
    if (-not (Exists kms keys describe $Key --keyring $KeyRing --location $Location --project $Project)) {
        Invoke-Gcloud kms keys create $Key --keyring $KeyRing --location $Location --project $Project --purpose asymmetric-signing --default-algorithm ec-sign-secp256k1-sha256 --protection-level hsm --destroy-scheduled-duration 30d
        Write-Host "created: $Key"
    } else { Write-Host "key exists: $Key" }
}

Step 'Public key (public by design)'
Invoke-IfLive "save the public key to $PublicKeyOut" {
    $version = 1
    foreach ($try in 1..12) {   # a new HSM key version takes a short while to become ENABLED
        $state = (& gcloud kms keys versions describe $version --key $Key --keyring $KeyRing --location $Location --project $Project --format 'value(state)' 2>$null)
        if ("$state".Trim() -eq 'ENABLED') { break }
        Write-Host "key version state: $state (waiting)"; Start-Sleep -Seconds 10
    }
    New-Item -ItemType Directory -Force (Split-Path -Parent $PublicKeyOut) | Out-Null
    Invoke-Gcloud kms keys versions get-public-key $version --key $Key --keyring $KeyRing --location $Location --project $Project --output-file $PublicKeyOut
    Write-Host "saved: $PublicKeyOut"
    & gcloud kms keys versions describe $version --key $Key --keyring $KeyRing --location $Location --project $Project --format 'value(algorithm,protectionLevel,state)'
}

Step 'Who can sign'
Invoke-IfLive 'list signer grants (there should be none)' {
    $pol = & gcloud kms keys get-iam-policy $Key --keyring $KeyRing --location $Location --project $Project --format json | ConvertFrom-Json
    $signers = @($pol.bindings | Where-Object { $_.role -match 'signer|signerVerifier' })
    Write-Host ("signer grants on the key: {0}" -f $signers.Count)
}
Write-Host "`nDone. Next: node workers/wallet/derive.mjs  (prints the Bitcoin and Ethereum addresses), then Test-Wallet.ps1 (proves the key can sign for that address)." -ForegroundColor Green
