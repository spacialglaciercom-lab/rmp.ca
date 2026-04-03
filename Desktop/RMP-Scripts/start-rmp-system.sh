#!/bin/bash
# Comprehensive startup script for the RMP.ca system
# Handles jails, services, and development environment

set -e

# Configuration
REPO_ROOT="/root/rmp.ca"
JAILS="rmpcabackend rmpcacelery rmpcadb rmpcaextract rmpcamoonshine rmpcanginxopt rmpcaoptimizer rmpcaredis"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored messages
info() { echo -e "${BLUE}[INFO]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }
success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }

# Check if running as root
check_root() {
    if [ "$(id -u)" -ne 0 ]; then
        error "This script must be run as root"
        exit 1
    fi
}

# Check if bastille is installed
check_bastille() {
    if ! command -v bastille >/dev/null 2>&1; then
        error "Bastille is not installed. Please run: pkg install bastille"
        exit 1
    fi
}

# Enable and start bastille service
setup_bastille_service() {
    info "Setting up bastille service..."
    if ! sysrc bastille_enable 2>/dev/null | grep -q "YES"; then
        sysrc bastille_enable=YES
        success "Bastille service enabled for auto-start"
    fi
    
    # Check if bastille service is running
    if ! service bastille status >/dev/null 2>&1; then
        info "Starting bastille service..."
        service bastille start >/dev/null 2>&1 || service bastille onestart >/dev/null 2>&1
        success "Bastille service started"
    fi
}

# Start all jails
start_jails() {
    info "Starting all jails..."
    for jail in $JAILS; do
        if bastille list | grep -q "$jail"; then
            if bastille list | grep "$jail" | grep -q "Down"; then
                info "Starting jail: $jail"
                bastille start "$jail" >/dev/null 2>&1
                success "Jail $jail started"
            else
                info "Jail $jail is already running"
            fi
        else
            error "Jail $jail does not exist. Run bootstrap.sh first."
        fi
    done
}

# Check jail status
check_jail_status() {
    info "Jail status:"
    bastille list
}

# Deploy code to jails (simplified version)
deploy_to_jails() {
    info "Deploying code to jails..."
    
    # Check if we're in the repo root
    if [ ! -d "$REPO_ROOT" ]; then
        error "Repository not found at $REPO_ROOT"
        return 1
    fi
    
    cd "$REPO_ROOT"
    
    # Deploy extract service
    info "Deploying extract service..."
    if [ -d "extract" ]; then
        bastille cmd rmpcaextract mkdir -p /app/extract
        tar -C extract -cf - . | bastille cmd rmpcaextract sh -c "mkdir -p /app/extract && tar -C /app/extract -xf -"
        bastille cmd rmpcaextract sh -c "cd /app/extract && npm install --omit=dev 2>/dev/null || true"
        bastille cmd rmpcaextract sh -c "chown -R www:www /app/extract"
        success "Extract service deployed"
    else
        error "Extract directory not found"
    fi
    
    # Deploy backend (simplified)
    info "Deploying backend..."
    bastille cmd rmpcabackend mkdir -p /app
    
    # Check if backend is already built
    if [ -d "dist" ]; then
        tar -C . -cf - dist | bastille cmd rmpcabackend sh -c "mkdir -p /app && tar -C /app -xf -"
    else
        error "Backend not built. Run 'pnpm build:server' first."
    fi
    
    # Create backend environment file
    bastille cmd rmpcabackend sh -c "cat > /usr/local/etc/rmpca/backend.env <<'ENV'
NODE_ENV=production
PORT=3000
EXTRACT_WS_UPSTREAM=http://10.10.0.2:4000
ENV"
    
    bastille cmd rmpcabackend sh -c "chown -R www:www /app"
    success "Backend deployed"
}

# Start services in jails
start_jail_services() {
    info "Starting services in jails..."
    
    # Start extract service
    info "Starting extract service..."
    bastille cmd rmpcaextract service extract start 2>/dev/null || {
        error "Failed to start extract service"
        bastille cmd rmpcaextract sh -c "cd /app/extract && node . >/dev/null 2>&1 &"
    }
    
    # Start backend service
    info "Starting backend service..."
    bastille cmd rmpcabackend service backend start 2>/dev/null || {
        error "Failed to start backend service"
        bastille cmd rmpcabackend sh -c "cd /app && node dist/index.js >/dev/null 2>&1 &"
    }
    
    success "Services started"
}

# Start development environment
start_dev_env() {
    info "Starting development environment..."
    
    # Check for dependencies
    if ! command -v pnpm >/dev/null 2>&1; then
        info "pnpm not found, installing..."
        npm install -g pnpm
    fi
    
    cd "$REPO_ROOT"
    
    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        info "Installing dependencies (this may take a while)..."
        pnpm install --no-frozen-lockfile
    fi
    
    # Build if needed
    if [ ! -d "dist" ]; then
        info "Building server..."
        pnpm run build:server
    fi
    
    # Start development server
    info "Starting development server..."
    pnpm dev &
    
    # Give it time to start
    sleep 5
    
    success "Development server running at http://localhost:3000"
}

# Main menu
show_menu() {
    clear
    echo "${BLUE}RMP.ca System Startup Menu${NC}"
    echo "================================"
    echo "1. Start all jails"
    echo "2. Check jail status"
    echo "3. Deploy code to jails"
    echo "4. Start services in jails"
    echo "5. Start development environment"
    echo "6. Full system startup (jails + services)"
    echo "7. Exit"
    echo ""
}

# Main execution
main() {
    check_root
    check_bastille
    setup_bastille_service
    
    if [ "$1" = "auto" ]; then
        # Automatic full startup
        start_jails
        deploy_to_jails
        start_jail_services
        start_dev_env
    else
        # Interactive menu
        while true; do
            show_menu
            read -p "Enter your choice [1-7]: " choice
            
            case $choice in
                1) start_jails ;;
                2) check_jail_status ;;
                3) deploy_to_jails ;;
                4) start_jail_services ;;
                5) start_dev_env ;;
                6) 
                    start_jails
                    deploy_to_jails
                    start_jail_services
                    start_dev_env
                    ;;
                7)
                    info "Exiting..."
                    exit 0
                    ;;
                *)
                    error "Invalid option, please try again."
                    ;;
            esac
            
            read -p "Press Enter to continue..." 
        done
    fi
}

# Run main function
main "$@"
