#!/bin/bash
# StealthPay Sepolia Deployment Script using starkli
# This bypasses the scaffold deploy script's compiled class hash bug.

set -e

# ─── Configuration ───
# Load from .env
source "$(dirname "$0")/packages/snfoundry/.env"

export STARKNET_RPC="$RPC_URL_SEPOLIA"
CONTRACTS_DIR="$(dirname "$0")/packages/snfoundry/contracts/target/dev"
DEPLOYER_ADDRESS="$ACCOUNT_ADDRESS_SEPOLIA"
DEPLOYER_PRIVKEY="$PRIVATE_KEY_SEPOLIA"

echo "═══════════════════════════════════════════"
echo "  StealthPay - Sepolia Deployment"
echo "═══════════════════════════════════════════"
echo ""
echo "RPC:      $STARKNET_RPC"
echo "Deployer: $DEPLOYER_ADDRESS"
echo ""

# ─── Step 1: Declare contracts ───
echo "📜 Declaring StealthAnnouncer..."
ANNOUNCER_HASH=$(starkli declare "$CONTRACTS_DIR/contracts_StealthAnnouncer.contract_class.json" \
    --private-key "$DEPLOYER_PRIVKEY" \
    --account-address "$DEPLOYER_ADDRESS" \
    --watch 2>&1 | tail -1)
echo "   Class hash: $ANNOUNCER_HASH"

echo "📜 Declaring StealthRegistry..."
REGISTRY_HASH=$(starkli declare "$CONTRACTS_DIR/contracts_StealthRegistry.contract_class.json" \
    --private-key "$DEPLOYER_PRIVKEY" \
    --account-address "$DEPLOYER_ADDRESS" \
    --watch 2>&1 | tail -1)
echo "   Class hash: $REGISTRY_HASH"

echo "📜 Declaring StealthPay..."
PAY_HASH=$(starkli declare "$CONTRACTS_DIR/contracts_StealthPay.contract_class.json" \
    --private-key "$DEPLOYER_PRIVKEY" \
    --account-address "$DEPLOYER_ADDRESS" \
    --watch 2>&1 | tail -1)
echo "   Class hash: $PAY_HASH"

# ─── Step 2: Deploy contracts ───
echo ""
echo "🚀 Deploying StealthAnnouncer..."
ANNOUNCER_ADDR=$(starkli deploy "$ANNOUNCER_HASH" \
    --private-key "$DEPLOYER_PRIVKEY" \
    --account-address "$DEPLOYER_ADDRESS" \
    --watch 2>&1 | tail -1)
echo "   Address: $ANNOUNCER_ADDR"

echo "🚀 Deploying StealthRegistry..."
REGISTRY_ADDR=$(starkli deploy "$REGISTRY_HASH" \
    --private-key "$DEPLOYER_PRIVKEY" \
    --account-address "$DEPLOYER_ADDRESS" \
    --watch 2>&1 | tail -1)
echo "   Address: $REGISTRY_ADDR"

echo "🚀 Deploying StealthPay (with announcer address)..."
PAY_ADDR=$(starkli deploy "$PAY_HASH" \
    "$ANNOUNCER_ADDR" \
    --private-key "$DEPLOYER_PRIVKEY" \
    --account-address "$DEPLOYER_ADDRESS" \
    --watch 2>&1 | tail -1)
echo "   Address: $PAY_ADDR"

echo ""
echo "═══════════════════════════════════════════"
echo "  ✅ Deployment Complete!"
echo "═══════════════════════════════════════════"
echo ""
echo "StealthAnnouncer: $ANNOUNCER_ADDR"
echo "StealthRegistry:  $REGISTRY_ADDR"
echo "StealthPay:       $PAY_ADDR"
echo ""
echo "⚠️  Now update packages/nextjs/contracts/deployedContracts.ts"
echo "    with the new addresses above (under the 'sepolia' key)."
