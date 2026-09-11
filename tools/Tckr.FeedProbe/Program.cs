// Tckr.FeedProbe — independent verification client for the mock exchange feed.
//
// Connects, decodes the wire protocol with Tckr.MockExchange's own frame reader (see the codec
// choice recorded on ProbeSession), and proves what the exchange actually delivered: rate, gaps,
// ordering, distribution. See docs/phase-2-mock-exchange/08-feed-probe.md for the full contract.

using Tckr.FeedProbe;

if (args.Any(a => a is "-h" or "--help"))
{
    Console.WriteLine(ProbeOptions.Usage);
    return 0;
}

ProbeOptions options;
try
{
    options = ProbeOptions.Parse(args);
}
catch (ProbeArgumentException ex)
{
    Console.Error.WriteLine($"Tckr.FeedProbe: {ex.Message}");
    Console.Error.WriteLine();
    Console.Error.WriteLine(ProbeOptions.Usage);

    // Not one of the four documented exit codes (0/1/2/3) on purpose: malformed usage is not a
    // measurement outcome task 09 needs to branch on, it is a mistake in the invocation. 64 is the
    // BSD sysexits.h convention for "command line usage error" and does not collide with anything
    // the exit-code contract defines.
    return 64;
}

using CancellationTokenSource ctrlC = new();
Console.CancelKeyPress += (_, eventArgs) =>
{
    // Let the run finish its current iteration and print the report instead of the process dying
    // mid-write — that is the whole point of handling this rather than letting the default
    // SIGINT behaviour terminate the process immediately.
    eventArgs.Cancel = true;
    ctrlC.Cancel();
};

ConsoleReport.PrintBanner(options);

ProbeSession session = new(options);
ProbeReport report = await session.RunAsync(ctrlC.Token).ConfigureAwait(false);

ConsoleReport.PrintFinal(report);

if (options.OutputPath is not null)
{
    JsonReport.WriteToFile(report, options.OutputPath);
    Console.WriteLine($" Report written to {options.OutputPath}");
}

return report.ExitCode;
