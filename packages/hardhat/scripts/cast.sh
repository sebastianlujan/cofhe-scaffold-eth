#!/bin/bash

# =============================================================================
# EVVM Cast Script - Interact with deployed contracts using Foundry's cast
# =============================================================================
#
# Usage:
#   ./scripts/cast.sh <command> [args...]
#
# Commands:
#   status              - Show contract state
#   block-info <n>      - Get info for virtual block n
#   gen-vaddr <addr>    - Generate vaddr for address
#   account-exists <va> - Check if vaddr account exists
#   get-nonce <vaddr>   - Get nonce for vaddr
#   update-state <hash> - Update state commitment
#   create-block <hash> - Create new virtual block
#   set-evvm-id <id>    - Set EVVM ID (owner only)
#   balance             - Check deployer ETH balance
#   help                - Show this help
#
# Environment:
#   Set EVVM_PRIVATE_KEY to override the default deployer key
#   Set EVVM_RPC_URL to override the default Sepolia RPC
#
# =============================================================================

set -e

# Configuration
RPC_URL="${EVVM_RPC_URL:-https://eth-sepolia.g.alchemy.com/v2/oKxs-03sij-U_N0iOlrSsZFr29-IqbuF}"
EVVM_CORE="0xD645DD0cCf4eA74547d3304BC01dd550F3548A50"
EVVM_CAFE="0xC74e79EDbfC0C8e5c76f68ca2385F117db23a6bc"

# Load private key from .env if not set
if [ -z "$EVVM_PRIVATE_KEY" ]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    ENV_FILE="$SCRIPT_DIR/../.env"
    if [ -f "$ENV_FILE" ]; then
        EVVM_PRIVATE_KEY=$(grep "^__RUNTIME_DEPLOYER_PRIVATE_KEY=" "$ENV_FILE" | cut -d'=' -f2)
        if [ -z "$EVVM_PRIVATE_KEY" ]; then
            EVVM_PRIVATE_KEY=$(grep "^DEPLOYER_PRIVATE_KEY=" "$ENV_FILE" | cut -d'=' -f2)
        fi
    fi
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
print_header() {
    echo -e "${BLUE}=== $1 ===${NC}"
}

print_success() {
    echo -e "${GREEN}$1${NC}"
}

print_warning() {
    echo -e "${YELLOW}$1${NC}"
}

print_error() {
    echo -e "${RED}$1${NC}"
}

# Check if cast is installed
check_cast() {
    if ! command -v cast &> /dev/null; then
        print_error "Error: 'cast' not found. Install Foundry: https://book.getfoundry.sh/getting-started/installation"
        exit 1
    fi
}

# Commands
cmd_status() {
    print_header "EVVMCore Contract State"
    echo "Contract: $EVVM_CORE"
    echo "Network: Sepolia"
    echo ""
    echo "vChainId:        $(cast call $EVVM_CORE 'vChainId()(uint64)' --rpc-url $RPC_URL)"
    echo "evvmID:          $(cast call $EVVM_CORE 'evvmID()(uint256)' --rpc-url $RPC_URL)"
    echo "vBlockNumber:    $(cast call $EVVM_CORE 'vBlockNumber()(uint64)' --rpc-url $RPC_URL)"
    echo "nextTxId:        $(cast call $EVVM_CORE 'nextTxId()(uint256)' --rpc-url $RPC_URL)"
    echo "owner:           $(cast call $EVVM_CORE 'owner()(address)' --rpc-url $RPC_URL)"
    echo "stateCommitment: $(cast call $EVVM_CORE 'stateCommitment()(bytes32)' --rpc-url $RPC_URL)"
    echo ""
    print_header "EVVMCafe Contract"
    echo "Contract: $EVVM_CAFE"
}

cmd_block_info() {
    local block_num="${1:-1}"
    print_header "Virtual Block $block_num Info"
    
    local result=$(cast call $EVVM_CORE "getBlockInfo(uint64)((uint64,bytes32,uint256,uint256,bool))" $block_num --rpc-url $RPC_URL 2>&1)
    
    if [[ "$result" == *"revert"* ]]; then
        print_error "Block $block_num does not exist"
        return 1
    fi
    
    echo "Raw: $result"
    echo ""
    
    # Parse using sed (macOS compatible)
    local block_number=$(echo "$result" | sed 's/.*(\([0-9]*\),.*/\1/')
    local state_commitment=$(echo "$result" | sed 's/.*\(0x[a-fA-F0-9]\{64\}\).*/\1/')
    local timestamp=$(echo "$result" | sed 's/.*, \([0-9]*\) \[.*/\1/')
    local tx_count=$(echo "$result" | sed 's/.*\], \([0-9]*\),.*/\1/')
    
    echo "Parsed:"
    echo "  blockNumber:      $block_number"
    echo "  stateCommitment:  $state_commitment"
    echo "  timestamp:        $timestamp ($(date -r $timestamp 2>/dev/null || date -d @$timestamp 2>/dev/null || echo 'N/A'))"
    echo "  transactionCount: $tx_count"
    echo "  exists:           true"
}

cmd_gen_vaddr() {
    local addr="${1:-}"
    local salt="${2:-0x0000000000000000000000000000000000000000000000000000000000000000}"
    
    if [ -z "$addr" ]; then
        print_error "Usage: cast.sh gen-vaddr <address> [salt]"
        exit 1
    fi
    
    print_header "Generate Virtual Address"
    echo "Address: $addr"
    echo "Salt:    $salt"
    echo ""
    
    local vaddr=$(cast call $EVVM_CORE "generateVaddrFromAddress(address,bytes32)(bytes32)" $addr $salt --rpc-url $RPC_URL)
    echo "vaddr:   $vaddr"
}

cmd_account_exists() {
    local vaddr="${1:-}"
    
    if [ -z "$vaddr" ]; then
        print_error "Usage: cast.sh account-exists <vaddr>"
        exit 1
    fi
    
    print_header "Check Account Exists"
    echo "vaddr: $vaddr"
    
    local exists=$(cast call $EVVM_CORE "accountExists(bytes32)(bool)" $vaddr --rpc-url $RPC_URL)
    echo "exists: $exists"
}

cmd_get_nonce() {
    local vaddr="${1:-}"
    
    if [ -z "$vaddr" ]; then
        print_error "Usage: cast.sh get-nonce <vaddr>"
        exit 1
    fi
    
    print_header "Get Account Nonce"
    echo "vaddr: $vaddr"
    
    local nonce=$(cast call $EVVM_CORE "getNonce(bytes32)(uint64)" $vaddr --rpc-url $RPC_URL)
    echo "nonce: $nonce"
}

cmd_update_state() {
    local commitment="${1:-}"
    
    if [ -z "$commitment" ]; then
        # Generate random commitment if not provided
        commitment=$(cast keccak "state_$(date +%s)")
        print_warning "Generated random commitment: $commitment"
    fi
    
    if [ -z "$EVVM_PRIVATE_KEY" ]; then
        print_error "Error: No private key set. Set EVVM_PRIVATE_KEY or add to .env"
        exit 1
    fi
    
    print_header "Update State Commitment"
    echo "Commitment: $commitment"
    echo ""
    
    cast send $EVVM_CORE "updateStateCommitment(bytes32)" $commitment \
        --private-key $EVVM_PRIVATE_KEY \
        --rpc-url $RPC_URL
    
    print_success "State commitment updated!"
}

cmd_create_block() {
    local commitment="${1:-}"
    
    if [ -z "$commitment" ]; then
        # Generate random commitment if not provided
        commitment=$(cast keccak "block_$(date +%s)")
        print_warning "Generated random commitment: $commitment"
    fi
    
    if [ -z "$EVVM_PRIVATE_KEY" ]; then
        print_error "Error: No private key set. Set EVVM_PRIVATE_KEY or add to .env"
        exit 1
    fi
    
    print_header "Create Virtual Block"
    echo "Commitment: $commitment"
    echo ""
    
    cast send $EVVM_CORE "createVirtualBlock(bytes32)" $commitment \
        --private-key $EVVM_PRIVATE_KEY \
        --rpc-url $RPC_URL
    
    print_success "Virtual block created!"
    
    # Show new block number
    local new_block=$(cast call $EVVM_CORE 'vBlockNumber()(uint64)' --rpc-url $RPC_URL)
    echo "New vBlockNumber: $new_block"
}

cmd_set_evvm_id() {
    local new_id="${1:-}"
    
    if [ -z "$new_id" ]; then
        print_error "Usage: cast.sh set-evvm-id <id>"
        exit 1
    fi
    
    if [ -z "$EVVM_PRIVATE_KEY" ]; then
        print_error "Error: No private key set. Set EVVM_PRIVATE_KEY or add to .env"
        exit 1
    fi
    
    print_header "Set EVVM ID"
    echo "New ID: $new_id"
    echo ""
    
    cast send $EVVM_CORE "setEvvmID(uint256)" $new_id \
        --private-key $EVVM_PRIVATE_KEY \
        --rpc-url $RPC_URL
    
    print_success "EVVM ID updated!"
}

cmd_balance() {
    print_header "Deployer Balance"
    
    if [ -z "$EVVM_PRIVATE_KEY" ]; then
        print_error "Error: No private key set"
        exit 1
    fi
    
    local addr=$(cast wallet address $EVVM_PRIVATE_KEY)
    local balance=$(cast balance $addr --rpc-url $RPC_URL)
    local balance_eth=$(cast from-wei $balance)
    
    echo "Address: $addr"
    echo "Balance: $balance_eth ETH"
}

cmd_help() {
    echo "EVVM Cast Script - Interact with deployed contracts"
    echo ""
    echo "Usage: ./scripts/cast.sh <command> [args...]"
    echo ""
    echo "Read Commands:"
    echo "  status                  Show contract state"
    echo "  block-info <n>          Get info for virtual block n"
    echo "  gen-vaddr <addr> [salt] Generate vaddr for address"
    echo "  account-exists <vaddr>  Check if vaddr account exists"
    echo "  get-nonce <vaddr>       Get nonce for vaddr"
    echo "  balance                 Check deployer ETH balance"
    echo ""
    echo "Write Commands (require private key):"
    echo "  update-state [hash]     Update state commitment"
    echo "  create-block [hash]     Create new virtual block"
    echo "  set-evvm-id <id>        Set EVVM ID (owner only)"
    echo ""
    echo "Environment Variables:"
    echo "  EVVM_PRIVATE_KEY        Deployer private key"
    echo "  EVVM_RPC_URL            RPC URL (default: Sepolia via Alchemy)"
    echo ""
    echo "Contract Addresses (Sepolia):"
    echo "  EVVMCore: $EVVM_CORE"
    echo "  EVVMCafe: $EVVM_CAFE"
    echo ""
    echo "Examples:"
    echo "  ./scripts/cast.sh status"
    echo "  ./scripts/cast.sh gen-vaddr 0x899b5BdA341044a476350CE30986D31174bc42a1"
    echo "  ./scripts/cast.sh create-block"
    echo "  ./scripts/cast.sh block-info 1"
}

# Main
check_cast

case "${1:-help}" in
    status)
        cmd_status
        ;;
    block-info)
        cmd_block_info "$2"
        ;;
    gen-vaddr)
        cmd_gen_vaddr "$2" "$3"
        ;;
    account-exists)
        cmd_account_exists "$2"
        ;;
    get-nonce)
        cmd_get_nonce "$2"
        ;;
    update-state)
        cmd_update_state "$2"
        ;;
    create-block)
        cmd_create_block "$2"
        ;;
    set-evvm-id)
        cmd_set_evvm_id "$2"
        ;;
    balance)
        cmd_balance
        ;;
    help|--help|-h)
        cmd_help
        ;;
    *)
        print_error "Unknown command: $1"
        echo ""
        cmd_help
        exit 1
        ;;
esac
