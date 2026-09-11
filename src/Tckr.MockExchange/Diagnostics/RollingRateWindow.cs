namespace Tckr.MockExchange.Diagnostics;

/// <summary>
/// A fixed-memory, time-bucketed count of events over the recent past, used to answer the only
/// question a load source is really asked: <em>what rate is it achieving right now?</em>
/// </summary>
/// <remarks>
/// <para>
/// A since-startup average is the obvious implementation and the wrong one. It reports the mean of
/// a run rather than its shape, so a generator that produced 25,000/sec for fifty seconds and then
/// collapsed to 2,000/sec still reports ~22,700/sec at the sixty-second mark &#8212; the exact
/// failure a benchmark exists to catch, hidden by the exact statistic used to report it. This
/// window forgets, on purpose.
/// </para>
/// <para>
/// <b>The partial bucket is excluded.</b> The rate is the sum of the <c>buckets</c> most recent
/// <em>complete</em> buckets divided by their span. Including the bucket currently being filled
/// would divide a fraction of a bucket's events by a whole bucket's duration and report a dip that
/// is an artefact of when the reader happened to look. The cost is that the answer trails reality
/// by up to one bucket &#8212; 500 ms at the defaults &#8212; which is why the default is ten
/// short buckets rather than five one-second ones.
/// </para>
/// <para>
/// Before a full window has elapsed the divisor is only the buckets that have actually completed
/// since construction, so a run reports its true rate from the first completed bucket rather than
/// ramping up through a fictitious slow start.
/// </para>
/// <para>
/// <see cref="Add"/> is called once per batch (200/sec at the default 5 ms batch), not once per
/// event, and takes an uncontended <see cref="Lock"/>. That is deliberate: a lock at 200/sec costs
/// nothing measurable, whereas the interlocked-ring alternative would trade correct bucket
/// eviction for torn sums. It allocates nothing.
/// </para>
/// </remarks>
internal sealed class RollingRateWindow
{
    /// <summary>Default span of history the rate is computed over.</summary>
    internal static readonly TimeSpan DefaultWindow = TimeSpan.FromSeconds(5);

    /// <summary>Default number of buckets the window is divided into.</summary>
    internal const int DefaultBuckets = 10;

    private readonly TimeProvider _timeProvider;
    private readonly long _bucketTicks;
    private readonly int _buckets;

    // One slot more than the window, because the bucket being filled is held but not counted.
    private readonly long[] _counts;
    private readonly Lock _gate = new();

    private readonly long _startBucket;
    private long _headBucket;

    /// <summary>Creates a window.</summary>
    /// <param name="timeProvider">
    /// Clock source. Injected rather than read from <see cref="DateTime.UtcNow"/> so a test can
    /// simulate a stall without waiting for one.
    /// </param>
    /// <param name="window">Span of history the rate covers. Defaults to five seconds.</param>
    /// <param name="buckets">
    /// Resolution. Higher means the reported rate trails reality by less, at one <see cref="long"/>
    /// of memory each.
    /// </param>
    internal RollingRateWindow(TimeProvider timeProvider, TimeSpan? window = null, int buckets = DefaultBuckets)
    {
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentOutOfRangeException.ThrowIfLessThan(buckets, 1);

        TimeSpan span = window ?? DefaultWindow;
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(span, TimeSpan.Zero, nameof(window));

        _timeProvider = timeProvider;
        _buckets = buckets;
        _bucketTicks = Math.Max(1, span.Ticks / buckets);
        _counts = new long[buckets + 1];

        _startBucket = BucketOf(timeProvider.GetUtcNow());
        _headBucket = _startBucket;
    }

    /// <summary>The span the reported rate is averaged over once the window is full.</summary>
    internal TimeSpan Window => TimeSpan.FromTicks(_bucketTicks * _buckets);

    /// <summary>Adds <paramref name="count"/> events at the current time. Allocation-free.</summary>
    internal void Add(long count)
    {
        if (count == 0)
        {
            return;
        }

        long bucket = BucketOf(_timeProvider.GetUtcNow());

        lock (_gate)
        {
            AdvanceTo(bucket);
            _counts[Slot(bucket)] += count;
        }
    }

    /// <summary>
    /// Events per second over the most recent complete buckets, or zero before the first bucket
    /// has completed.
    /// </summary>
    /// <remarks>
    /// Reading advances the window, so a feed that has gone silent decays to zero without anyone
    /// having to add a zero to make it happen.
    /// </remarks>
    internal double EventsPerSecond()
    {
        long current = BucketOf(_timeProvider.GetUtcNow());

        long total = 0;
        long complete;

        lock (_gate)
        {
            AdvanceTo(current);

            // Complete buckets are everything strictly older than the one being filled, bounded by
            // the window and by how long this instance has existed.
            complete = Math.Min(_buckets, current - _startBucket);

            for (long bucket = current - complete; bucket < current; bucket++)
            {
                total += _counts[Slot(bucket)];
            }
        }

        if (complete <= 0)
        {
            return 0;
        }

        double seconds = complete * _bucketTicks / (double)TimeSpan.TicksPerSecond;
        return total / seconds;
    }

    private long BucketOf(DateTimeOffset now) => now.UtcTicks / _bucketTicks;

    private int Slot(long bucket) => (int)(((bucket % _counts.Length) + _counts.Length) % _counts.Length);

    /// <summary>
    /// Moves the head to <paramref name="bucket"/>, clearing every slot passed over so that stale
    /// counts from a previous lap of the ring cannot be read as recent ones.
    /// </summary>
    private void AdvanceTo(long bucket)
    {
        if (bucket <= _headBucket)
        {
            return;
        }

        // A gap wider than the ring means every slot is stale; clearing the whole array is both
        // cheaper and the only correct answer.
        long steps = bucket - _headBucket;

        if (steps >= _counts.Length)
        {
            Array.Clear(_counts);
        }
        else
        {
            for (long b = _headBucket + 1; b <= bucket; b++)
            {
                _counts[Slot(b)] = 0;
            }
        }

        _headBucket = bucket;
    }
}
