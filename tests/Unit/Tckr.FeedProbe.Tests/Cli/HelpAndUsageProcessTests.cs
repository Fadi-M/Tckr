using System.Diagnostics;

namespace Tckr.FeedProbe.Tests.Cli;

/// <summary>
/// End-to-end checks of the two paths that live in <c>Program.cs</c> rather than in
/// <see cref="ProbeOptions.Parse"/> itself: <c>-h</c>/<c>--help</c> is intercepted before <c>Parse</c>
/// is ever called (see <see cref="ProbeOptionsParseTests.PassingHelpDirectlyToParseIsTreatedAsAnUnknownFlag"/>
/// for why that matters), and a malformed command line exits <c>64</c> — the one exit code the
/// documented 0/1/2/3 contract deliberately excludes. Both require actually running the built
/// <c>Tckr.FeedProbe</c> executable, so unlike the rest of this project these are process-level
/// tests rather than pure in-process calls; no wall-clock sleeps are involved, only a bounded
/// synchronous wait for the (near-instant) process exit.
/// </summary>
public class HelpAndUsageProcessTests
{
    [Fact]
    public void HelpFlagPrintsUsageAndExitsZero()
    {
        (int exitCode, string stdout, string _) = RunFeedProbe("--help");

        exitCode.ShouldBe(0);
        stdout.ShouldContain("Usage:");
        stdout.ShouldContain("--host");
    }

    [Fact]
    public void ShortHelpFlagAlsoPrintsUsageAndExitsZero()
    {
        (int exitCode, string stdout, string _) = RunFeedProbe("-h");

        exitCode.ShouldBe(0);
        stdout.ShouldContain("Usage:");
    }

    [Fact]
    public void AMalformedCommandLineExitsSixtyFour()
    {
        (int exitCode, string _, string stderr) = RunFeedProbe("--bogus-flag");

        exitCode.ShouldBe(64);
        stderr.ShouldContain("Unknown flag");
        stderr.ShouldContain("Usage:");
    }

    [Fact]
    public void AFlagMissingItsValueAlsoExitsSixtyFour()
    {
        (int exitCode, string _, string stderr) = RunFeedProbe("--port");

        exitCode.ShouldBe(64);
        stderr.ShouldContain("expects a value");
    }

    private static (int ExitCode, string Stdout, string Stderr) RunFeedProbe(params string[] args)
    {
        string dllPath = ResolveFeedProbeDll();

        var psi = new ProcessStartInfo("dotnet")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        psi.ArgumentList.Add(dllPath);
        foreach (string arg in args)
        {
            psi.ArgumentList.Add(arg);
        }

        using Process process = Process.Start(psi) ?? throw new InvalidOperationException("Failed to start dotnet.");
        string stdout = process.StandardOutput.ReadToEnd();
        string stderr = process.StandardError.ReadToEnd();

        bool exited = process.WaitForExit(30_000);
        exited.ShouldBeTrue("Tckr.FeedProbe did not exit within 30s for args: " + string.Join(' ', args));

        return (process.ExitCode, stdout, stderr);
    }

    /// <summary>
    /// Locates the real build output of <c>tools/Tckr.FeedProbe</c> by walking up from this test
    /// assembly's own output directory to the repo root (marked by <c>src/Tckr.slnx</c>). Building
    /// this test project builds <c>Tckr.FeedProbe</c> first as a project-reference dependency, so
    /// the executable's own <c>.dll</c>/<c>.deps.json</c>/<c>.runtimeconfig.json</c> are guaranteed
    /// to exist there by the time these tests run.
    /// </summary>
    private static string ResolveFeedProbeDll()
    {
        DirectoryInfo? dir = new(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "src", "Tckr.slnx")))
        {
            dir = dir.Parent;
        }

        if (dir is null)
        {
            throw new InvalidOperationException(
                $"Could not locate the repo root (src/Tckr.slnx) above {AppContext.BaseDirectory}.");
        }

        string config =
#if DEBUG
            "Debug";
#else
            "Release";
#endif

        string dll = Path.Combine(dir.FullName, "tools", "Tckr.FeedProbe", "bin", config, "net10.0", "Tckr.FeedProbe.dll");
        if (!File.Exists(dll))
        {
            throw new FileNotFoundException(
                $"Expected a Tckr.FeedProbe build at {dll}. Build tools/Tckr.FeedProbe (or the whole " +
                "solution) before running this test.", dll);
        }

        return dll;
    }
}
