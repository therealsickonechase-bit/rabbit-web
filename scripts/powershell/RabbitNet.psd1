@{
    RootModule            = 'RabbitNet.psm1'
    ModuleVersion         = '1.0.0'
    GUID                  = '6f0b3d52-6c1e-4a58-9f0d-2b7e8c5a41d3'
    Author                = 'RabbitOS'
    CompanyName           = 'RabbitOS'
    Description           = 'Connection checks for RabbitOS and a local, hash-verified copy of the public chain ledger. Reads only; uploads nothing.'
    PowerShellVersion     = '7.0'
    CompatiblePSEditions  = @('Core')
    FunctionsToExport     = @('Test-RabbitConnection', 'Get-RabbitChainHead', 'Sync-RabbitChain', 'Test-RabbitChain')
    CmdletsToExport       = @()
    VariablesToExport     = @()
    AliasesToExport       = @()
    PrivateData           = @{ PSData = @{ Tags = @('RabbitOS', 'ledger', 'diagnostics') } }
}
