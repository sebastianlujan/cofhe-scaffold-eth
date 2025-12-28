#!/usr/bin/env node

/**
 * EVVM CLI - Command Line Interface for EVVM Development
 * 
 * Startup Order: chain -> deploy -> relayer -> frontend
 * 
 * Usage:
 *   evvm dev        - Start relayer + frontend (for Sepolia)
 *   evvm all        - Start chain + deploy + relayer + frontend (local dev)
 *   evvm chain      - Start local hardhat chain only
 *   evvm deploy     - Deploy contracts only
 *   evvm relayer    - Start fisher relayer only
 *   evvm frontend   - Start frontend only
 *   evvm status     - Check status of all services
 *   evvm help       - Show help
 */

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const net = require('net');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

const c = (color, text) => `${colors[color]}${text}${colors.reset}`;

// Banner
const banner = `
${c('green', '░▒▓████████▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓██████████████▓▒░')}
${c('green', '░▒▓█▓▒░      ░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░')}
${c('green', '░▒▓█▓▒░       ░▒▓█▓▒▒▓█▓▒░ ░▒▓█▓▒▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░')}
${c('green', '░▒▓██████▓▒░  ░▒▓█▓▒▒▓█▓▒░ ░▒▓█▓▒▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░')}
${c('green', '░▒▓█▓▒░        ░▒▓█▓▓█▓▒░   ░▒▓█▓▓█▓▒░ ░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░')}
${c('green', '░▒▓█▓▒░        ░▒▓█▓▓█▓▒░   ░▒▓█▓▓█▓▒░ ░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░')}
${c('green', '░▒▓████████▓▒░  ░▒▓██▓▒░     ░▒▓██▓▒░  ░▒▓█▓▒░░▒▓█▓▒░░▒▓█▓▒░')}

  ${c('yellow', 'Encrypted Virtual Virtual Machine')}
  ${c('cyan', 'Privacy-Preserving Payments with FHE')}
`;

// Root directory
const ROOT_DIR = path.resolve(__dirname, '..');

// Default ports
const DEFAULT_PORTS = {
  frontend: 3000,
  fisher: 3001,
  chain: 8545,
};

// Active ports (will be updated dynamically)
const activePorts = { ...DEFAULT_PORTS };

// Service configurations
const services = {
  frontend: {
    name: 'Frontend',
    command: 'yarn',
    args: ['workspace', '@se-2/nextjs', 'dev'],
    defaultPort: 3000,
    color: 'green',
    portEnv: 'PORT',
  },
  fisher: {
    name: 'Fisher Relayer',
    command: 'yarn',
    args: ['workspace', '@evvm/fisher', 'start:dev'],
    defaultPort: 3001,
    color: 'magenta',
    portEnv: 'PORT',
  },
  chain: {
    name: 'Hardhat Chain',
    command: 'yarn',
    args: ['workspace', '@se-2/hardhat', 'chain'],
    defaultPort: 8545,
    color: 'yellow',
    portEnv: null, // Hardhat doesn't use PORT env
  },
};

// Active processes
const processes = {};

// Cleanup handler
function cleanup() {
  console.log(c('yellow', '\n\nShutting down services...'));
  Object.entries(processes).forEach(([name, proc]) => {
    if (proc && !proc.killed) {
      console.log(c('yellow', `  Stopping ${name}...`));
      proc.kill('SIGTERM');
    }
  });
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Check if a port is available (TCP level)
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

// Find an available port
async function findAvailablePort(preferredPort, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = preferredPort + i;
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`Could not find available port after ${maxAttempts} attempts starting from ${preferredPort}`);
}

// Start a service with dynamic port
async function startService(serviceKey, options = {}) {
  const service = services[serviceKey];
  if (!service) {
    console.error(c('red', `Unknown service: ${serviceKey}`));
    return null;
  }

  const prefix = c(service.color, `[${service.name}]`);
  
  // Find available port
  let port = service.defaultPort;
  try {
    port = await findAvailablePort(service.defaultPort);
    if (port !== service.defaultPort) {
      console.log(`${prefix} ${c('yellow', `Port ${service.defaultPort} in use, using ${port}`)}`);
    }
  } catch (err) {
    console.error(`${prefix} ${c('red', err.message)}`);
    return null;
  }
  
  activePorts[serviceKey] = port;
  console.log(`${prefix} Starting on port ${port}...`);

  // Build environment with port
  const env = { ...process.env };
  if (service.portEnv) {
    env[service.portEnv] = String(port);
  }
  
  // For frontend, also set NEXT_PUBLIC_FISHER_URL if fisher port is different
  if (serviceKey === 'frontend' && activePorts.fisher) {
    env.NEXT_PUBLIC_FISHER_URL = `http://localhost:${activePorts.fisher}`;
  }

  const proc = spawn(service.command, service.args, {
    cwd: ROOT_DIR,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: true,
    env,
  });

  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    lines.forEach(line => {
      console.log(`${prefix} ${line}`);
    });
  });

  proc.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    lines.forEach(line => {
      // Filter out some noisy warnings
      if (line.includes('ExperimentalWarning') || line.includes('punycode')) return;
      console.log(`${prefix} ${c('red', line)}`);
    });
  });

  proc.on('close', (code) => {
    if (code !== 0 && code !== null) {
      console.log(`${prefix} ${c('red', `Exited with code ${code}`)}`);
    }
    delete processes[serviceKey];
  });

  processes[serviceKey] = proc;
  return proc;
}

// Check if a port has an HTTP service
function checkPort(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}`, () => {
      resolve(true);
    });
    req.on('error', () => {
      resolve(false);
    });
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

// Find running service on a port range
async function findRunningService(basePort, maxOffset = 10) {
  for (let i = 0; i < maxOffset; i++) {
    const port = basePort + i;
    if (await checkPort(port)) {
      return port;
    }
  }
  return null;
}

// Check status of all services
async function checkStatus() {
  console.log(banner);
  console.log(c('bright', 'Service Status:\n'));

  const statusInfo = {};

  for (const [key, service] of Object.entries(services)) {
    // Check both default port and nearby ports
    const runningPort = await findRunningService(service.defaultPort);
    const isRunning = runningPort !== null;
    const status = isRunning 
      ? c('green', `RUNNING (port ${runningPort})`) 
      : c('red', 'STOPPED');
    console.log(`  ${c(service.color, service.name.padEnd(20))} ${status}`);
    statusInfo[key] = { running: isRunning, port: runningPort };
  }

  // Check Fisher health endpoint
  const fisherPort = statusInfo.fisher.port;
  if (fisherPort) {
    try {
      const response = await fetch(`http://localhost:${fisherPort}/health`);
      if (response.ok) {
        const data = await response.json();
        console.log(c('bright', '\nFisher Health:'));
        console.log(`  Wallet: ${data.fisher?.address || 'N/A'}`);
        console.log(`  Balance: ${data.fisher?.balance || 'N/A'}`);
        console.log(`  Shop Registered: ${data.contract?.shopRegistered ? c('green', 'Yes') : c('red', 'No')}`);
      }
    } catch (e) {
      // Fisher health check failed
    }
  }

  console.log('');
}

// Run yarn command
function runYarn(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yarn', args, {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      shell: true,
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
  });
}

// Commands
const commands = {
  // Development mode for Sepolia: relayer + frontend (separate PIDs)
  async dev() {
    console.log(banner);
    console.log(c('bright', 'Starting Sepolia development environment...\n'));
    console.log(c('cyan', 'Order: relayer -> frontend\n'));

    // Start relayer first (frontend depends on it for gasless)
    await startService('fisher');
    
    // Small delay before starting frontend
    await new Promise(r => setTimeout(r, 3000));
    await startService('frontend');

    console.log('');
    console.log(c('bright', 'Services started:'));
    console.log(c('magenta', `  Relayer:   http://localhost:${activePorts.fisher}`));
    console.log(c('green', `  Frontend:  http://localhost:${activePorts.frontend}`));
    console.log(c('cyan', `  Cafe:      http://localhost:${activePorts.frontend}/evvm-cafe-gasless`));
    console.log(c('yellow', '\nPress Ctrl+C to stop all services\n'));
  },

  // Full local development: chain -> deploy -> relayer -> frontend
  async all() {
    console.log(banner);
    console.log(c('bright', 'Starting full local development environment...\n'));
    console.log(c('cyan', 'Order: chain -> deploy -> relayer -> frontend\n'));

    // 1. Start chain
    console.log(c('yellow', '[1/4] Starting chain...'));
    await startService('chain');
    
    // Wait for chain to be ready
    console.log(c('yellow', '      Waiting for chain to be ready...'));
    await new Promise(r => setTimeout(r, 5000));

    // 2. Deploy contracts
    console.log(c('blue', '[2/4] Deploying contracts...'));
    try {
      await runYarn(['dev:deploy']);
    } catch (e) {
      console.log(c('red', '      Deploy failed, continuing anyway...'));
    }

    // 3. Start relayer (needs contracts deployed)
    console.log(c('magenta', '[3/4] Starting relayer...'));
    await new Promise(r => setTimeout(r, 2000));
    await startService('fisher');

    // 4. Start frontend (needs relayer for gasless)
    console.log(c('green', '[4/4] Starting frontend...'));
    await new Promise(r => setTimeout(r, 3000));
    await startService('frontend');

    console.log('');
    console.log(c('bright', 'Services started:'));
    console.log(c('yellow', `  Chain:     http://localhost:${activePorts.chain}`));
    console.log(c('magenta', `  Relayer:   http://localhost:${activePorts.fisher}`));
    console.log(c('green', `  Frontend:  http://localhost:${activePorts.frontend}`));
    console.log(c('cyan', `  Cafe:      http://localhost:${activePorts.frontend}/evvm-cafe-gasless`));
    console.log(c('yellow', '\nPress Ctrl+C to stop all services\n'));
  },

  // Individual service commands
  async chain() {
    console.log(banner);
    console.log(c('bright', 'Starting Hardhat chain...\n'));
    await startService('chain');
    console.log(c('cyan', `  Chain: http://localhost:${activePorts.chain}\n`));
  },

  async deploy() {
    console.log(banner);
    console.log(c('bright', 'Deploying contracts...\n'));
    await runYarn(['dev:deploy']);
  },

  async relayer() {
    console.log(banner);
    console.log(c('bright', 'Starting Fisher relayer...\n'));
    await startService('fisher');
    console.log(c('cyan', `  Relayer: http://localhost:${activePorts.fisher}\n`));
  },

  async frontend() {
    console.log(banner);
    console.log(c('bright', 'Starting frontend...\n'));
    await startService('frontend');
    console.log(c('cyan', `  Frontend: http://localhost:${activePorts.frontend}\n`));
  },

  async status() {
    await checkStatus();
  },

  help() {
    console.log(banner);
    console.log(c('bright', 'Usage:') + ' yarn evvm <command>\n');
    console.log(c('bright', 'Startup Order:') + ' chain -> deploy -> relayer -> frontend\n');
    
    console.log(c('bright', 'Combined Commands:'));
    console.log(`  ${c('green', 'dev')}       Start relayer + frontend (for Sepolia)`);
    console.log(`  ${c('green', 'all')}       Start chain + deploy + relayer + frontend (local)\n`);
    
    console.log(c('bright', 'Individual Commands:'));
    console.log(`  ${c('yellow', 'chain')}     Start local hardhat chain`);
    console.log(`  ${c('blue', 'deploy')}    Deploy contracts`);
    console.log(`  ${c('magenta', 'relayer')}   Start fisher relayer`);
    console.log(`  ${c('green', 'frontend')}  Start frontend\n`);
    
    console.log(c('bright', 'Utility Commands:'));
    console.log(`  ${c('cyan', 'status')}    Check status of all services`);
    console.log(`  ${c('cyan', 'help')}      Show this help message\n`);
    
    console.log(c('bright', 'Examples:'));
    console.log(`  ${c('cyan', 'yarn dev')}          # Sepolia: relayer + frontend`);
    console.log(`  ${c('cyan', 'yarn dev:all')}      # Local: chain + deploy + relayer + frontend`);
    console.log(`  ${c('cyan', 'yarn dev:status')}   # Check what's running\n`);
    
    console.log(c('bright', 'Manual (separate terminals):'));
    console.log(`  ${c('cyan', 'yarn dev:chain')}    # Terminal 1`);
    console.log(`  ${c('cyan', 'yarn dev:deploy')}   # Terminal 2 (after chain ready)`);
    console.log(`  ${c('cyan', 'yarn dev:relayer')}  # Terminal 3`);
    console.log(`  ${c('cyan', 'yarn dev:frontend')} # Terminal 4\n`);
    
    console.log(c('bright', 'Note:') + ' Ports are assigned dynamically if defaults are in use.');
    console.log(`  Default ports: Frontend=${DEFAULT_PORTS.frontend}, Relayer=${DEFAULT_PORTS.fisher}, Chain=${DEFAULT_PORTS.chain}`);
    console.log('');
  },

  // Aliases for backward compatibility
  async start() { await commands.frontend(); },
  async fisher() { await commands.relayer(); },
};

// Main
async function main() {
  const command = process.argv[2] || 'help';

  if (commands[command]) {
    try {
      await commands[command]();
    } catch (error) {
      console.error(c('red', `Error: ${error.message}`));
      process.exit(1);
    }
  } else {
    console.error(c('red', `Unknown command: ${command}`));
    console.log(`Run ${c('cyan', 'evvm help')} for usage information.`);
    process.exit(1);
  }
}

main();
