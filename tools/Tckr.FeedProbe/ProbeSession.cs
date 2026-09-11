using System.Buffers;
using System.Diagnostics;
using System.IO.Pipelines;
using System.Net.Sockets;
using Tckr.MockExchange.Protocol;

namespace Tckr.FeedProbe;

/// <summary>
/// Runs one probe session end to end: connect, decode <c>SessionStart</c>, stream, measure, and
/// build the final <see cref="ProbeReport"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Codec choice: shared, not copied.</b> <see cref="FeedFrameReader"/> is <c>internal</c> in
/// <c>Tckr.MockExchange</c> and reachable here only through <c>InternalsVisibleTo</c>; this class
/// uses it directly rather than carrying a second decoder. The brief frames this as open: a shared
/// codec makes a layout bug invisible to both sides, a copy is duplication in exchange for a
/// genuinely independent implementation. Copying loses on its own terms here, though. Task 01 pins
/// the wire layout with a hard-coded byte-level test, which is what "genuinely independent" is
/// actually buying against a shared codec — a second hand-written decoder would not add a second
/// opinion on the layout, only a second place for the same 44/28/36-byte contract to be encoded and
/// a second place to update every time it changes, with no test forcing the two to be checked
/// against each other. What this probe is independent <em>witness to</em> is sequencing, pacing,
/// distribution and loss — properties that exist above the framing layer and that a duplicated
/// decoder would not make any more trustworthy. A shared decoder that is already pinned by a
/// byte-level test is the cheaper way to get the same assurance.
/// </para>
/// <para>
/// <b>How the probe learns the slow-consumer policy.</b> A decoded gap means the same thing under
/// both policies — the exchange withheld records and told you exactly how many — but it means a
/// different thing about whether the run passed: under the default <c>Disconnect</c> a gap should
/// never happen, and its presence is a failure; under <c>DropOldest</c> it is the documented,
/// expected disclosure of a drop. The wire carries no field naming the policy, so
/// <see cref="ProbeOptions.ExpectDrops"/> is how an operator (or task 09, scripting a
/// <c>DropOldest</c> run) tells the probe which reading applies. The alternative considered was
/// reporting every gap as a bare fact and always exiting 0 on one, leaving policy interpretation to
/// whoever reads the report — rejected because it defeats the point of an exit-code contract: a CI
/// check that must treat "the default policy leaked a gap" as a failure would have nothing to key
/// on. A sequence-number reorder or duplicate is a different matter and is always a failure: no
/// policy makes that a legitimate outcome on a single TCP session.
/// </para>
/// <para>
/// Single-threaded by design: one socket, one read loop, no concurrent access to any counter here.
/// That is also what makes the per-event hot path (<see cref="HandleTick"/>) safe to leave
/// unsynchronised.
/// </para>
/// </remarks>
internal sealed class ProbeSession
{
    private const int MaxGapEvents = 10_000;
    private const int MaxIntegrityViolations = 1_000;
    private const int MaxFramingErrors = 64;
    private const int MaxOrderViolations = 2_000;
    private const int ReservoirCapacity = 2_000_000;

    private readonly ProbeOptions _options;
    private readonly double _nanosPerStopwatchTick = 1_000_000_000.0 / Stopwatch.Frequency;

    private readonly SymbolTable _symbols = new();
    private readonly ReservoirSampler _interArrival = new(ReservoirCapacity);
    private readonly ReservoirSampler _latency = new(ReservoirCapacity);
    private readonly List<GapEvent> _gaps = [];
    private readonly List<SequenceIntegrityViolation> _integrityViolations = [];
    private readonly List<FramingErrorEvent> _framingErrors = [];
    private readonly List<OrderViolationEvent> _orderViolations = [];

    private Guid _sessionId;
    private uint _heartbeatIntervalMs;

    private ulong _eventsReceived;
    private ulong _lastTickSequence;
    private ulong _recordsLost;
    private long _tradeCount;
    private long _bidCount;
    private long _askCount;
    private long _auctionPrintCount;
    private long _totalBytes;

    private bool _haveLastTickMono;
    private long _lastTickMonoTicks;

    private long _heartbeatCount;
    private double _maxHeartbeatIntervalMs;
    private int _heartbeatExceeded2xCount;
    private bool _haveLastHeartbeat;
    private DateTimeOffset _lastHeartbeatAt;

    private double _minIntervalRate = double.MaxValue;
    private double _maxIntervalRate;

    internal ProbeSession(ProbeOptions options) => _options = options;

    internal async Task<ProbeReport> RunAsync(CancellationToken ctrlC)
    {
        DateTimeOffset startedAt = DateTimeOffset.UtcNow;
        Socket? socket = null;

        try
        {
            socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };

            using (CancellationTokenSource connectCts = CancellationTokenSource.CreateLinkedTokenSource(ctrlC))
            {
                connectCts.CancelAfter(TimeSpan.FromSeconds(10));
                await socket.ConnectAsync(_options.Host, _options.Port, connectCts.Token).ConfigureAwait(false);
            }
        }
        catch (Exception ex) when (ex is SocketException or OperationCanceledException)
        {
            socket?.Dispose();
            return ConnectionFailureReport(startedAt, $"connect-failed: {ex.Message}");
        }

        await using NetworkStream stream = new(socket, ownsSocket: true);
        PipeReader reader = PipeReader.Create(stream, new StreamPipeReaderOptions(bufferSize: 65536));

        try
        {
            using CancellationTokenSource handshakeCts = CancellationTokenSource.CreateLinkedTokenSource(ctrlC);
            handshakeCts.CancelAfter(TimeSpan.FromSeconds(15));

            bool established = await EstablishSessionAsync(reader, handshakeCts.Token).ConfigureAwait(false);
            if (!established)
            {
                return ConnectionFailureReport(startedAt, "refused: connection closed before a SessionStart frame arrived (server may be at MaxSessions)");
            }
        }
        catch (InvalidDataException ex)
        {
            RecordFramingError(ex.Message, DateTimeOffset.UtcNow);
            return BuildReport(startedAt, DateTimeOffset.UtcNow, 0, "framing-error", null, "n/a");
        }
        catch (OperationCanceledException)
        {
            // Either the 15s handshake bound fired or the caller cancelled before a session was
            // ever established; either way there is no session to report on, so both collapse to
            // the same exit code as any other pre-session failure.
            return ConnectionFailureReport(startedAt, "connect-failed: no SessionStart frame arrived");
        }
        catch (Exception ex) when (ex is SocketException or IOException)
        {
            return ConnectionFailureReport(startedAt, $"connect-failed: {ex.Message}");
        }

        (string endReason, double activeSeconds, string stallOutcome) =
            await RunReadLoopAsync(reader, ctrlC).ConfigureAwait(false);

        DateTimeOffset endedAt = DateTimeOffset.UtcNow;
        return BuildReport(startedAt, endedAt, activeSeconds, endReason, _options.StallAfterSeconds, stallOutcome);
    }

    // ---- handshake ------------------------------------------------------------------------

    /// <summary>
    /// Reads exactly the first frame and requires it to be <c>SessionStart</c>.
    /// </summary>
    /// <returns><see langword="false"/> if the connection closed before a full frame arrived.</returns>
    /// <exception cref="InvalidDataException">
    /// A frame arrived but failed to decode, or the first frame was not <c>SessionStart</c>.
    /// </exception>
    private async Task<bool> EstablishSessionAsync(PipeReader reader, CancellationToken ct)
    {
        while (true)
        {
            ReadResult result = await reader.ReadAsync(ct).ConfigureAwait(false);
            ReadOnlySequence<byte> buffer = result.Buffer;

            if (FeedFrameReader.TryReadFrame(ref buffer, out FeedMessageType type, out ReadOnlySequence<byte> payload))
            {
                // Decode before advancing: AdvanceTo can let the pipe reclaim the memory backing
                // `payload`, so touching it after that call reads freed or recycled bytes instead
                // of the frame. This inverted order is exactly what bit the first version of this
                // method (see the framing-error report it produced against a live server).
                if (type != FeedMessageType.SessionStart)
                {
                    reader.AdvanceTo(buffer.Start, buffer.Start);
                    throw new InvalidDataException(
                        $"First frame on the connection was {type}, not SessionStart.");
                }

                Span<byte> scratch = stackalloc byte[FeedFrameWriter.SessionStartPayloadSize];
                FeedFrameReader.ReadSessionStart(
                    ToSpan(payload, scratch), out _sessionId, out _heartbeatIntervalMs, out _);

                reader.AdvanceTo(buffer.Start, buffer.Start);
                return true;
            }

            if (result.IsCompleted)
            {
                reader.AdvanceTo(buffer.Start, buffer.End);
                return false;
            }

            reader.AdvanceTo(buffer.Start, buffer.End);
        }
    }

    // ---- steady-state read loop -------------------------------------------------------------

    /// <summary>
    /// Streams frames until the run's stopping condition, tracking every measurement in the brief.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Staleness watchdog.</b> Every read is bounded by <c>heartbeatIntervalMs &#215; 1.5</c> —
    /// the bound task 05's own tests use for "a heartbeat arrived in time" — so a socket that is
    /// open but has gone truly silent (no ticks, no heartbeat, nothing) ends the run instead of
    /// hanging the probe forever. This is a liveness bound on the probe's own wait, distinct from
    /// the heartbeats measurement in the final report, which flags any observed interval exceeding
    /// 2&#215; the configured value without ending anything.
    /// </para>
    /// <para>
    /// <b><c>--stall-after</c>.</b> Reproducing the slow-consumer path only requires not reading:
    /// <see cref="PipeReader.ReadAsync"/> is the only thing that drains the socket, so simply not
    /// calling it for the pause window lets the OS receive buffer fill and the server observe
    /// exactly the backpressure a genuinely slow consumer would produce. Reading resumes afterward
    /// (rather than staying stopped for the rest of the run) specifically so a <c>DropOldest</c> run
    /// can show the gap the drop produces within the same run, not just infer it from a disconnect.
    /// </para>
    /// </remarks>
    private async Task<(string EndReason, double ActiveSeconds, string StallOutcome)> RunReadLoopAsync(
        PipeReader reader, CancellationToken ctrlC)
    {
        DateTimeOffset connectedAt = DateTimeOffset.UtcNow;
        DateTimeOffset? hardDeadline = _options.DurationSeconds > 0
            ? connectedAt + TimeSpan.FromSeconds(_options.DurationSeconds)
            : null;
        DateTimeOffset? stallAt = _options.StallAfterSeconds is { } s ? connectedAt + TimeSpan.FromSeconds(s) : null;

        TimeSpan staleTimeout = TimeSpan.FromMilliseconds(Math.Max(1000, _heartbeatIntervalMs * 1.5));

        DateTimeOffset activePeriodStart = connectedAt;
        double activeSeconds = 0;
        bool stallTriggered = false;
        bool stallInPause = false;
        string stallOutcome = "n/a";

        DateTimeOffset nextReportAt = connectedAt + TimeSpan.FromSeconds(_options.ReportIntervalSeconds);
        ulong lastReportEvents = 0;
        DateTimeOffset lastReportAt = connectedAt;

        // Folds "finish accounting" into every exit point of the loop below instead of repeating
        // it at each one. Declared ahead of the loop even though C# would let them come after it
        // (local functions are hoisted), because every use is textually inside the loop and a
        // reader should not have to look past it to find what they do.
        string Finish(string reason)
        {
            if (stallTriggered && stallOutcome == "n/a" && reason is "duration-elapsed" or "ctrl-c")
            {
                stallOutcome = "continued";
            }

            return reason;
        }

        double FinalActiveSeconds() => activeSeconds + (DateTimeOffset.UtcNow - activePeriodStart).TotalSeconds;

        while (true)
        {
            DateTimeOffset now = DateTimeOffset.UtcNow;

            if (hardDeadline is { } hd && now >= hd)
            {
                return (Finish("duration-elapsed"), FinalActiveSeconds(), stallOutcome);
            }

            if (ctrlC.IsCancellationRequested)
            {
                return (Finish("ctrl-c"), FinalActiveSeconds(), stallOutcome);
            }

            if (!stallTriggered && stallAt is { } sa && now >= sa)
            {
                stallTriggered = true;
                stallInPause = true;
                activeSeconds += (now - activePeriodStart).TotalSeconds;

                ConsoleReport.PrintNotice(
                    $"--stall-after reached: pausing reads for {_options.StallDurationSeconds}s " +
                    "to exercise the slow-consumer policy.");

                DateTimeOffset pauseUntil = now + TimeSpan.FromSeconds(_options.StallDurationSeconds);
                if (hardDeadline is { } hd2 && hd2 < pauseUntil)
                {
                    pauseUntil = hd2;
                }

                try
                {
                    await Task.Delay(pauseUntil - now, ctrlC).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    stallOutcome = "interrupted";
                    return (Finish("ctrl-c"), FinalActiveSeconds(), stallOutcome);
                }

                stallInPause = false;
                activePeriodStart = DateTimeOffset.UtcNow;
                ConsoleReport.PrintNotice("resuming reads.");
                continue;
            }

            using CancellationTokenSource readCts = CancellationTokenSource.CreateLinkedTokenSource(ctrlC);
            readCts.CancelAfter(staleTimeout);

            ReadResult result;
            try
            {
                result = await reader.ReadAsync(readCts.Token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                if (ctrlC.IsCancellationRequested)
                {
                    return (Finish("ctrl-c"), FinalActiveSeconds(), stallOutcome);
                }

                ConsoleReport.PrintNotice(
                    $"no data received for {staleTimeout.TotalMilliseconds:F0}ms " +
                    "(> 1.5x the advertised heartbeat interval); ending the run.");

                if (stallTriggered)
                {
                    stallOutcome = "stale";
                }

                return (Finish("stale"), FinalActiveSeconds(), stallOutcome);
            }
            catch (Exception ex) when (ex is IOException or SocketException)
            {
                if (stallTriggered)
                {
                    stallOutcome = "reset";
                }

                ConsoleReport.PrintNotice($"connection reset: {ex.Message}");
                return (Finish("reset"), FinalActiveSeconds(), stallOutcome);
            }

            long nowMonoTicks = Stopwatch.GetTimestamp();
            long nowWallNanos = UtcNowNanos();
            DateTimeOffset frameTime = DateTimeOffset.UtcNow;

            ReadOnlySequence<byte> buffer = result.Buffer;
            SequencePosition consumedTo;
            bool framingBroke = false;

            try
            {
                ProcessBuffer(ref buffer, nowMonoTicks, nowWallNanos, frameTime);
                consumedTo = buffer.Start;
            }
            catch (InvalidDataException ex)
            {
                RecordFramingError(ex.Message, frameTime);
                consumedTo = buffer.Start;
                framingBroke = true;
            }

            reader.AdvanceTo(consumedTo, result.Buffer.End);

            if (framingBroke)
            {
                if (stallTriggered)
                {
                    stallOutcome = "framing-error";
                }

                return (Finish("framing-error"), FinalActiveSeconds(), stallOutcome);
            }

            if (result.IsCompleted)
            {
                if (stallTriggered)
                {
                    stallOutcome = "eof";
                }

                return (Finish("eof"), FinalActiveSeconds(), stallOutcome);
            }

            now = DateTimeOffset.UtcNow;
            if (now >= nextReportAt && !stallInPause)
            {
                double intervalSeconds = (now - lastReportAt).TotalSeconds;
                double intervalRate = intervalSeconds > 0 ? (_eventsReceived - lastReportEvents) / intervalSeconds : 0;
                double overallElapsed = activeSeconds + (now - activePeriodStart).TotalSeconds;
                double overallRate = overallElapsed > 0 ? _eventsReceived / overallElapsed : 0;

                if (intervalRate < _minIntervalRate)
                {
                    _minIntervalRate = intervalRate;
                }

                if (intervalRate > _maxIntervalRate)
                {
                    _maxIntervalRate = intervalRate;
                }

                ConsoleReport.PrintInterval(
                    now - connectedAt, _eventsReceived, intervalRate, overallRate,
                    _gaps.Count, _framingErrors.Count);

                lastReportEvents = _eventsReceived;
                lastReportAt = now;
                nextReportAt = now + TimeSpan.FromSeconds(_options.ReportIntervalSeconds);
            }
        }
    }

    // ---- frame dispatch --------------------------------------------------------------------

    /// <summary>Internal rather than private so tests can drive frame dispatch directly with a synthetic buffer.</summary>
    internal void ProcessBuffer(
        ref ReadOnlySequence<byte> buffer, long nowMonoTicks, long nowWallNanos, DateTimeOffset now)
    {
        while (FeedFrameReader.TryReadFrame(ref buffer, out FeedMessageType type, out ReadOnlySequence<byte> payload))
        {
            _totalBytes += FrameWireSize(type);

            switch (type)
            {
                case FeedMessageType.Trade or FeedMessageType.BidQuote or FeedMessageType.AskQuote:
                    HandleTick(type, payload, nowMonoTicks, nowWallNanos);
                    break;

                case FeedMessageType.Heartbeat:
                    HandleHeartbeat(payload, now);
                    break;

                case FeedMessageType.SessionStart:
                    throw new InvalidDataException("Unexpected SessionStart frame mid-stream.");

                default:
                    throw new InvalidDataException(
                        $"Unrecognised message type {(byte)type} reached the probe's dispatcher.");
            }
        }
    }

    private void HandleTick(FeedMessageType type, ReadOnlySequence<byte> payload, long nowMonoTicks, long nowWallNanos)
    {
        FeedRecord record = FeedFrameReader.ReadTick(payload);
        _eventsReceived++;

        switch (type)
        {
            case FeedMessageType.Trade: _tradeCount++; break;
            case FeedMessageType.BidQuote: _bidCount++; break;
            case FeedMessageType.AskQuote: _askCount++; break;
        }

        if (record.IsAuctionPrint)
        {
            _auctionPrintCount++;
        }

        // Sequence integrity. See the class remarks: a gap is admitted loss and its pass/fail
        // meaning depends on ExpectDrops; a number at or below one already seen cannot happen on a
        // single TCP session and is always reported as a bug, never as a gap.
        ulong expected = _lastTickSequence + 1;
        if (record.SequenceNumber > expected)
        {
            ulong gapSize = record.SequenceNumber - expected;
            _recordsLost += gapSize;
            if (_gaps.Count < MaxGapEvents)
            {
                _gaps.Add(new GapEvent(expected, record.SequenceNumber, gapSize, DateTimeOffset.UtcNow));
            }
        }
        else if (record.SequenceNumber < expected)
        {
            if (_integrityViolations.Count < MaxIntegrityViolations)
            {
                _integrityViolations.Add(
                    new SequenceIntegrityViolation(expected, record.SequenceNumber, DateTimeOffset.UtcNow));
            }
        }

        _lastTickSequence = record.SequenceNumber;

        if (_haveLastTickMono)
        {
            long deltaTicks = nowMonoTicks - _lastTickMonoTicks;
            if (deltaTicks < 0)
            {
                deltaTicks = 0;
            }

            _interArrival.Add((long)(deltaTicks * _nanosPerStopwatchTick));
        }

        _haveLastTickMono = true;
        _lastTickMonoTicks = nowMonoTicks;

        _latency.Add(nowWallNanos - record.ExchangeTimestampNanos);

        int slot = _symbols.Record(record.Symbol, record.PriceScaled);

        if (_options.VerifyOrder
            && !_symbols.CheckTimestampOrder(slot, record.ExchangeTimestampNanos, out long previous)
            && _orderViolations.Count < MaxOrderViolations)
        {
            _orderViolations.Add(new OrderViolationEvent(
                record.SymbolAsString(), record.SequenceNumber, previous, record.ExchangeTimestampNanos));
        }
    }

    private void HandleHeartbeat(ReadOnlySequence<byte> payload, DateTimeOffset now)
    {
        Span<byte> scratch = stackalloc byte[FeedFrameWriter.HeartbeatPayloadSize];
        FeedFrameReader.ReadHeartbeat(ToSpan(payload, scratch), out _, out _);

        _heartbeatCount++;

        if (_haveLastHeartbeat)
        {
            double intervalMs = (now - _lastHeartbeatAt).TotalMilliseconds;
            if (intervalMs > _maxHeartbeatIntervalMs)
            {
                _maxHeartbeatIntervalMs = intervalMs;
            }

            if (_heartbeatIntervalMs > 0 && intervalMs > _heartbeatIntervalMs * 2.0)
            {
                _heartbeatExceeded2xCount++;
            }
        }

        _haveLastHeartbeat = true;
        _lastHeartbeatAt = now;
    }

    private void RecordFramingError(string message, DateTimeOffset now)
    {
        if (_framingErrors.Count < MaxFramingErrors)
        {
            _framingErrors.Add(new FramingErrorEvent(message, now));
        }
    }

    // ---- report assembly --------------------------------------------------------------------

    /// <summary>Internal rather than private so tests can assemble a report from state built via <see cref="ProcessBuffer"/>.</summary>
    internal ProbeReport BuildReport(
        DateTimeOffset startedAt, DateTimeOffset endedAt, double activeSeconds, string endReason,
        int? stallAfterSeconds, string stallOutcome)
    {
        double denominator = Math.Max(activeSeconds, 1e-9);
        double achievedRate = _eventsReceived / denominator;

        IReadOnlyList<SymbolShare> topSymbols = BuildTopSymbols(out double top1, out double top10, out double top50);

        int exitCode = DetermineExitCode(
            sessionEstablished: true,
            framingErrorCount: _framingErrors.Count,
            integrityViolationCount: _integrityViolations.Count,
            gapCount: _gaps.Count,
            expectDrops: _options.ExpectDrops,
            achievedRate: achievedRate,
            targetRate: _options.TargetEventsPerSecond);

        return new ProbeReport
        {
            Host = _options.Host,
            Port = _options.Port,
            SessionEstablished = true,
            SessionId = _sessionId,
            HeartbeatIntervalMsAdvertised = _heartbeatIntervalMs,
            StartedAtUtc = startedAt,
            EndedAtUtc = endedAt,
            ActiveSeconds = activeSeconds,
            EndReason = endReason,
            EventsReceived = _eventsReceived,
            AchievedRateOverall = achievedRate,
            AchievedRateMin = _minIntervalRate == double.MaxValue ? achievedRate : _minIntervalRate,
            AchievedRateMax = Math.Max(_maxIntervalRate, 0),
            TargetEventsPerSecond = _options.TargetEventsPerSecond,
            Gaps = _gaps,
            RecordsLost = _recordsLost,
            IntegrityViolations = _integrityViolations,
            FramingErrors = _framingErrors,
            ExpectDrops = _options.ExpectDrops,
            TotalBytes = _totalBytes,
            BytesPerSecond = _totalBytes / denominator,
            MeanBytesPerEvent = _eventsReceived == 0 ? 0 : (double)_totalBytes / _eventsReceived,
            InterArrival = PercentileSummary.FromNanoseconds(_interArrival.Snapshot()),
            DeliveryLatency = PercentileSummary.FromNanoseconds(_latency.Snapshot()),
            TradeCount = _tradeCount,
            BidCount = _bidCount,
            AskCount = _askCount,
            TopSymbols = topSymbols,
            Top1Percent = top1,
            Top10Percent = top10,
            Top50Percent = top50,
            DistinctSymbolsSeen = _symbols.SymbolCount,
            PriceSummaries = BuildPriceSummaries(),
            AuctionPrintCount = _auctionPrintCount,
            HeartbeatCount = _heartbeatCount,
            MaxHeartbeatIntervalMs = _maxHeartbeatIntervalMs,
            HeartbeatIntervalExceeded2x = _heartbeatExceeded2xCount,
            VerifyOrderEnabled = _options.VerifyOrder,
            OrderViolations = _orderViolations,
            StallAfterSeconds = stallAfterSeconds,
            StallDurationSeconds = _options.StallDurationSeconds,
            StallOutcome = stallOutcome,
            ExitCode = exitCode,
        };
    }

    private ProbeReport ConnectionFailureReport(DateTimeOffset startedAt, string reason)
    {
        DateTimeOffset now = DateTimeOffset.UtcNow;
        return new ProbeReport
        {
            Host = _options.Host,
            Port = _options.Port,
            SessionEstablished = false,
            StartedAtUtc = startedAt,
            EndedAtUtc = now,
            ActiveSeconds = 0,
            EndReason = reason,
            EventsReceived = 0,
            AchievedRateOverall = 0,
            AchievedRateMin = 0,
            AchievedRateMax = 0,
            TargetEventsPerSecond = _options.TargetEventsPerSecond,
            Gaps = [],
            RecordsLost = 0,
            IntegrityViolations = [],
            FramingErrors = [],
            ExpectDrops = _options.ExpectDrops,
            TotalBytes = 0,
            BytesPerSecond = 0,
            MeanBytesPerEvent = 0,
            InterArrival = PercentileSummary.Empty,
            DeliveryLatency = PercentileSummary.Empty,
            TradeCount = 0,
            BidCount = 0,
            AskCount = 0,
            TopSymbols = [],
            Top1Percent = 0,
            Top10Percent = 0,
            Top50Percent = 0,
            DistinctSymbolsSeen = 0,
            PriceSummaries = [],
            AuctionPrintCount = 0,
            HeartbeatCount = 0,
            MaxHeartbeatIntervalMs = 0,
            HeartbeatIntervalExceeded2x = 0,
            VerifyOrderEnabled = _options.VerifyOrder,
            OrderViolations = [],
            StallAfterSeconds = _options.StallAfterSeconds,
            StallDurationSeconds = _options.StallDurationSeconds,
            StallOutcome = "n/a",
            ExitCode = 3,
        };
    }

    /// <summary>
    /// The exit-code contract task 09 scripts against: 0 pass, 1 sequence gaps or framing errors,
    /// 2 achieved rate outside &#177;2% of target, 3 connection failure.
    /// </summary>
    /// <remarks>
    /// Priority when more than one condition holds, highest first: no session at all (3) — nothing
    /// else could have been measured; then integrity failures (1) — framing errors, reorder or
    /// duplication, or an unexpected gap, all of which mean the tape itself cannot be trusted; then
    /// rate (2), which is a pacing complaint about an otherwise-trustworthy tape. A gap only counts
    /// against (1) when <paramref name="expectDrops"/> is false — see the class remarks for why the
    /// probe needs that flag at all.
    /// </remarks>
    /// <summary>Internal rather than private so tests can exercise the priority logic directly.</summary>
    internal static int DetermineExitCode(
        bool sessionEstablished, int framingErrorCount, int integrityViolationCount, int gapCount,
        bool expectDrops, double achievedRate, double targetRate)
    {
        if (!sessionEstablished)
        {
            return 3;
        }

        if (framingErrorCount > 0 || integrityViolationCount > 0 || (gapCount > 0 && !expectDrops))
        {
            return 1;
        }

        double tolerance = targetRate <= 0 ? 0 : Math.Abs(achievedRate - targetRate) / targetRate;
        return tolerance > 0.02 ? 2 : 0;
    }

    /// <summary>Internal rather than private so tests can exercise the top-N/skew computation directly.</summary>
    internal IReadOnlyList<SymbolShare> BuildTopSymbols(out double top1, out double top10, out double top50)
    {
        IReadOnlyList<int> order = _symbols.AllSlotsByCountDescending();

        long total = 0;
        foreach (int slot in order)
        {
            total += _symbols.CountAt(slot);
        }

        top1 = PercentOfTop(order, total, 1);
        top10 = PercentOfTop(order, total, 10);
        top50 = PercentOfTop(order, total, 50);

        int take = Math.Min(_options.TopSymbols, order.Count);
        var list = new List<SymbolShare>(take);
        for (int i = 0; i < take; i++)
        {
            int slot = order[i];
            long count = _symbols.CountAt(slot);
            double share = total == 0 ? 0 : 100.0 * count / total;
            list.Add(new SymbolShare(_symbols.SymbolAt(slot).ToString(), count, share));
        }

        return list;
    }

    /// <summary>Internal rather than private so tests can exercise the top-N share computation directly.</summary>
    internal double PercentOfTop(IReadOnlyList<int> orderedSlots, long total, int n)
    {
        if (total == 0)
        {
            return 0;
        }

        long sum = 0;
        for (int i = 0; i < Math.Min(n, orderedSlots.Count); i++)
        {
            sum += _symbols.CountAt(orderedSlots[i]);
        }

        return 100.0 * sum / total;
    }

    private IReadOnlyList<SymbolPriceSummary> BuildPriceSummaries()
    {
        var list = new List<SymbolPriceSummary>(_symbols.SymbolCount);
        for (int slot = 0; slot < _symbols.SymbolCount; slot++)
        {
            list.Add(new SymbolPriceSummary(
                _symbols.SymbolAt(slot).ToString(),
                _symbols.CountAt(slot),
                PriceScale.FromScaled(_symbols.MinPriceScaledAt(slot)),
                PriceScale.FromScaled(_symbols.MaxPriceScaledAt(slot)),
                PriceScale.FromScaled(_symbols.MaxMoveScaledAt(slot))));
        }

        return list;
    }

    private static int FrameWireSize(FeedMessageType type) => type switch
    {
        FeedMessageType.Trade or FeedMessageType.BidQuote or FeedMessageType.AskQuote => FeedFrameWriter.TickFrameSize,
        FeedMessageType.Heartbeat => FeedFrameWriter.HeartbeatFrameSize,
        FeedMessageType.SessionStart => FeedFrameWriter.SessionStartFrameSize,
        _ => 0,
    };

    /// <summary>Returns a contiguous view of a payload, copying to <paramref name="scratch"/> only when it straddles a pipe segment boundary.</summary>
    private static ReadOnlySpan<byte> ToSpan(in ReadOnlySequence<byte> sequence, Span<byte> scratch)
    {
        if (sequence.IsSingleSegment)
        {
            return sequence.FirstSpan;
        }

        sequence.CopyTo(scratch);
        return scratch[..(int)sequence.Length];
    }

    private static long UtcNowNanos() => (DateTime.UtcNow.Ticks - DateTime.UnixEpoch.Ticks) * 100L;
}
