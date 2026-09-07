using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace Tckr.MockExchange.Session;

/// <summary>
/// Paces the generation loop: blocks until the next batch is due, then answers the only question
/// that matters for a load source &#8212; how many events should have been emitted by now.
/// </summary>
/// <remarks>
/// <para>
/// Three properties make the achieved rate trustworthy, and all three are easy to get wrong:
/// </para>
/// <list type="number">
/// <item>
/// <description>
/// <b>Debt accounting in floating point, with the fraction carried.</b> Events owed accumulate as
/// a <see cref="double"/> and only the whole part is emitted; the remainder carries into the next
/// batch. Truncating per batch instead loses the fraction every time: at 17,384 events/sec over
/// 5 ms batches that is 0.92 of every 86.92 events, a permanent ~1% shortfall that no amount of
/// averaging recovers.
/// </description>
/// </item>
/// <item>
/// <description>
/// <b>Absolute deadlines.</b> The next deadline is the previous deadline plus one interval, never
/// "now plus one interval". A relative sleep accumulates every overshoot, so a loop that wakes
/// 0.4 ms late 200 times a second is 8% slow by construction and reports itself as on time.
/// </description>
/// </item>
/// <item>
/// <description>
/// <b>A capped catch-up.</b> After a stall the backlog is emitted only up to
/// <c>maxCatchUpBatches</c> intervals; the rest is abandoned, counted in
/// <see cref="CatchUpBatchesDropped"/> and logged. Emitting an unbounded backlog turns a GC pause
/// into a burst, the burst into a longer pause, and the loop into a death spiral. A mock exchange
/// that admits it fell behind is worth more than one that lies about its rate.
/// </description>
/// </item>
/// </list>
/// <para>
/// <b>CPU cost.</b> <see cref="Task.Delay(TimeSpan, TimeProvider, CancellationToken)"/> cannot
/// reliably wake at 5 ms granularity on any of the platforms we target, so the wait is hybrid:
/// delay while more than <c>spinThresholdMs</c> (default 2 ms) remains, then busy-wait the
/// remainder with <see cref="Thread.SpinWait"/> and periodic <see cref="Thread.Yield"/>. That
/// deliberately burns up to <c>spinThreshold</c> of every <c>batchInterval</c> on one thread
/// &#8212; up to two milliseconds in every five at the defaults, measured at roughly a fifth of a
/// core on an M-series Mac &#8212; and buys per-batch jitter with a median near two microseconds
/// for it. That is the right trade for a load generator, whose entire job is to be accurate about
/// time, and the wrong trade for a server, which should give the core back to request handling.
/// The spin phase is skipped when the requested rate is zero, so a closed market costs nothing.
/// </para>
/// <para>
/// Not thread-safe: one governor drives one generation loop.
/// </para>
/// </remarks>
internal sealed class RateGovernor
{
    /// <summary>Default batch interval: 5 ms, which is 125 events per batch at 25,000/sec.</summary>
    internal const int DefaultBatchIntervalMs = 5;

    /// <summary>Default catch-up ceiling, in batches.</summary>
    internal const int DefaultMaxCatchUpBatches = 4;

    /// <summary>Default point at which the wait switches from delaying to spinning.</summary>
    internal const double DefaultSpinThresholdMs = 2.0;

    private static readonly TimeSpan OneMillisecond = TimeSpan.FromMilliseconds(1);

    private readonly TimeSpan _batchInterval;
    private readonly int _maxCatchUpBatches;
    private readonly TimeSpan _spinThreshold;
    private readonly TimeProvider _timeProvider;
    private readonly ILogger _logger;
    private readonly bool _spinSupported;

    private bool _started;
    private DateTimeOffset _accruedThrough;
    private DateTimeOffset _nextDeadline;
    private double _owedEvents;

    /// <summary>Creates a governor.</summary>
    /// <param name="batchIntervalMs">Nominal spacing between batches. Must be at least 1 ms.</param>
    /// <param name="maxCatchUpBatches">
    /// How many missed batches may be made up in a single batch before the schedule is abandoned
    /// and reset to now.
    /// </param>
    /// <param name="timeProvider">Clock source; defaults to <see cref="TimeProvider.System"/>.</param>
    /// <param name="logger">Optional; used only for the catch-up warning.</param>
    /// <param name="spinThresholdMs">Remaining time at which the wait switches from delay to spin.</param>
    internal RateGovernor(
        int batchIntervalMs = DefaultBatchIntervalMs,
        int maxCatchUpBatches = DefaultMaxCatchUpBatches,
        TimeProvider? timeProvider = null,
        ILogger<RateGovernor>? logger = null,
        double spinThresholdMs = DefaultSpinThresholdMs)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(batchIntervalMs, 1);
        ArgumentOutOfRangeException.ThrowIfNegative(maxCatchUpBatches);
        ArgumentOutOfRangeException.ThrowIfNegative(spinThresholdMs);

        _batchInterval = TimeSpan.FromMilliseconds(batchIntervalMs);
        _maxCatchUpBatches = maxCatchUpBatches;
        _spinThreshold = TimeSpan.FromMilliseconds(Math.Min(spinThresholdMs, batchIntervalMs));
        _timeProvider = timeProvider ?? TimeProvider.System;
        _logger = logger ?? NullLogger<RateGovernor>.Instance;

        // A busy-wait against a virtual clock never ends: the clock only moves when a test moves
        // it, and a spinning thread never yields control back to the test to do so. Spin only
        // against the real clock; under a fake one the delay path alone is exact anyway.
        _spinSupported = ReferenceEquals(_timeProvider, TimeProvider.System);
    }

    /// <summary>Total events the governor has told the caller to emit since it started.</summary>
    internal long TotalEventsScheduled { get; private set; }

    /// <summary>
    /// How far past its deadline the most recent batch woke. Zero in the steady state; a
    /// sustained non-zero value means the generation loop, not the governor, is the bottleneck.
    /// </summary>
    internal TimeSpan CurrentLag { get; private set; }

    /// <summary>
    /// Batches worth of events abandoned because the loop fell further behind than
    /// <c>maxCatchUpBatches</c>. Any non-zero value invalidates a throughput claim for that run.
    /// </summary>
    internal long CatchUpBatchesDropped { get; private set; }

    /// <summary>Fractional events carried into the next batch. Always in <c>[0, 1)</c>.</summary>
    internal double PendingFraction => _owedEvents;

    /// <summary>
    /// Busy-wait iterations spent closing the last few milliseconds to a deadline. This is the
    /// CPU the governor trades for pacing accuracy; it stays at zero whenever the requested rate
    /// is zero, so a closed market is free.
    /// </summary>
    internal long SpinIterations { get; private set; }

    /// <summary>
    /// Blocks until the next batch is due, then returns how many events to emit for it.
    /// </summary>
    /// <param name="eventsPerSecond">
    /// The rate in force for this batch. Changing it between calls takes effect on the next batch
    /// with neither a burst nor a gap: only the sub-event remainder carries across the change.
    /// </param>
    /// <param name="ct">Cancels the wait.</param>
    /// <remarks>
    /// The first call establishes the schedule and returns immediately with one batch's worth of
    /// events, so a governor constructed long before the loop starts does not report a stall it
    /// did not have.
    /// </remarks>
    internal ValueTask<int> WaitForNextBatchAsync(double eventsPerSecond, CancellationToken ct)
    {
        if (double.IsNaN(eventsPerSecond) || eventsPerSecond < 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(eventsPerSecond), eventsPerSecond, "Rate must be a non-negative number.");
        }

        if (!_started)
        {
            _started = true;
            DateTimeOffset start = _timeProvider.GetUtcNow();
            _accruedThrough = start - _batchInterval;
            _nextDeadline = start;
        }

        DateTimeOffset now = _timeProvider.GetUtcNow();
        if (now >= _nextDeadline)
        {
            ct.ThrowIfCancellationRequested();
            return new ValueTask<int>(ScheduleBatch(eventsPerSecond, now));
        }

        return WaitThenScheduleAsync(eventsPerSecond, ct);
    }

    private async ValueTask<int> WaitThenScheduleAsync(double eventsPerSecond, CancellationToken ct)
    {
        await WaitUntilDueAsync(eventsPerSecond > 0, ct).ConfigureAwait(false);
        return ScheduleBatch(eventsPerSecond, _timeProvider.GetUtcNow());
    }

    private async ValueTask WaitUntilDueAsync(bool rateIsPositive, CancellationToken ct)
    {
        int spins = 0;

        while (true)
        {
            TimeSpan remaining = _nextDeadline - _timeProvider.GetUtcNow();
            if (remaining <= TimeSpan.Zero)
            {
                return;
            }

            if (remaining > _spinThreshold)
            {
                await Task.Delay(remaining - _spinThreshold, _timeProvider, ct).ConfigureAwait(false);
                continue;
            }

            // A closed market has nothing to be accurate about, and a virtual clock cannot be
            // spun towards. Both fall back to the coarse-but-free delay.
            if (!rateIsPositive || !_spinSupported)
            {
                // Against the real clock a sub-millisecond delay completes immediately, which
                // would turn this fallback into the busy-wait it exists to avoid; round it up.
                TimeSpan delay = _spinSupported && remaining < OneMillisecond ? OneMillisecond : remaining;
                await Task.Delay(delay, _timeProvider, ct).ConfigureAwait(false);
                continue;
            }

            ct.ThrowIfCancellationRequested();

            SpinIterations++;

            if ((++spins & 0x1F) == 0)
            {
                Thread.Yield();
            }
            else
            {
                Thread.SpinWait(50);
            }
        }
    }

    /// <summary>
    /// The pure accounting step: given that the batch due at <see cref="_nextDeadline"/> has
    /// arrived at <paramref name="now"/>, decide how many events it owes and where the next
    /// deadline sits.
    /// </summary>
    private int ScheduleBatch(double eventsPerSecond, DateTimeOffset now)
    {
        TimeSpan lag = now - _nextDeadline;
        if (lag < TimeSpan.Zero)
        {
            lag = TimeSpan.Zero;
        }

        // Whole batches missed on top of the one that is due.
        long behind = lag.Ticks / _batchInterval.Ticks;
        bool capped = behind > _maxCatchUpBatches;
        long batchesToAccrue = 1 + (capped ? _maxCatchUpBatches : behind);

        DateTimeOffset accrueTo = _accruedThrough + TimeSpan.FromTicks(_batchInterval.Ticks * batchesToAccrue);
        _owedEvents += (accrueTo - _accruedThrough).TotalSeconds * eventsPerSecond;

        int emit = 0;
        if (_owedEvents >= 1.0)
        {
            emit = _owedEvents >= int.MaxValue ? int.MaxValue : (int)_owedEvents;
            _owedEvents -= emit;
        }

        TotalEventsScheduled += emit;
        CurrentLag = lag;

        if (capped)
        {
            long dropped = behind - _maxCatchUpBatches;
            CatchUpBatchesDropped += dropped;

            // Abandon the missed schedule rather than chase it. Restarting from `now` is the one
            // place a deadline is allowed to come from the clock instead of from its predecessor.
            _accruedThrough = now;
            _nextDeadline = now + _batchInterval;

            _logger.LogWarning(
                "Rate governor fell {LagMs:F1} ms behind schedule ({BehindBatches} batches). Emitted {EmittedEvents} events for the {CappedBatches} batches allowed by the catch-up cap and abandoned {DroppedBatches} batches; schedule reset. Total dropped: {TotalDroppedBatches}.",
                lag.TotalMilliseconds, behind, emit, batchesToAccrue, dropped, CatchUpBatchesDropped);
        }
        else
        {
            _accruedThrough = accrueTo;
            _nextDeadline = accrueTo + _batchInterval;
        }

        return emit;
    }
}
