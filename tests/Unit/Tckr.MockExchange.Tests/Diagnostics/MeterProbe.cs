using System.Diagnostics.Metrics;

namespace Tckr.MockExchange.Tests.Diagnostics;

/// <summary>
/// Listens to every instrument on one scoped meter and records what was measured, including the
/// tag set.
/// </summary>
/// <remarks>
/// <c>MetricCollector&lt;T&gt;</c> is the right tool for asserting one instrument's values, but it
/// cannot answer "does <em>anything</em> carry a high-cardinality tag?" &#8212; and that is the
/// question the cardinality guard has to ask, because the way a symbol tag gets added is by
/// someone adding it to an instrument nobody thought to check. Subscribing by meter scope means a
/// new instrument is in this probe's field of view the moment it is created.
/// </remarks>
internal sealed class MeterProbe : IDisposable
{
    private readonly MeterListener _listener = new();
    private readonly Lock _gate = new();
    private readonly List<Measurement> _measurements = [];

    internal MeterProbe(object scope)
    {
        _listener.InstrumentPublished = (instrument, listener) =>
        {
            if (ReferenceEquals(instrument.Meter.Scope, scope))
            {
                listener.EnableMeasurementEvents(instrument);
            }
        };

        _listener.SetMeasurementEventCallback<long>((i, v, t, _) => Record(i, v, t));
        _listener.SetMeasurementEventCallback<int>((i, v, t, _) => Record(i, v, t));
        _listener.SetMeasurementEventCallback<double>((i, v, t, _) => Record(i, v, t));

        _listener.Start();
    }

    /// <summary>One recorded measurement, flattened to <see cref="double"/> so one list holds all three types.</summary>
    internal readonly record struct Measurement(string Name, string? Unit, double Value, KeyValuePair<string, object?>[] Tags);

    /// <summary>Everything measured so far, oldest first.</summary>
    internal IReadOnlyList<Measurement> Measurements
    {
        get
        {
            lock (_gate)
            {
                return [.. _measurements];
            }
        }
    }

    /// <summary>Polls every observable instrument on the meter, so gauges appear in <see cref="Measurements"/>.</summary>
    internal void ObserveGauges() => _listener.RecordObservableInstruments();

    /// <summary>The sum of every measurement recorded against <paramref name="name"/>.</summary>
    internal double Total(string name)
    {
        lock (_gate)
        {
            double total = 0;

            foreach (Measurement m in _measurements)
            {
                if (m.Name == name)
                {
                    total += m.Value;
                }
            }

            return total;
        }
    }

    /// <summary>Every measurement recorded against <paramref name="name"/>.</summary>
    internal IReadOnlyList<Measurement> For(string name)
    {
        lock (_gate)
        {
            return [.. _measurements.Where(m => m.Name == name)];
        }
    }

    /// <summary>The distinct instrument names seen, which is every instrument that has been used.</summary>
    internal IReadOnlyCollection<string> Names
    {
        get
        {
            lock (_gate)
            {
                return [.. _measurements.Select(m => m.Name).Distinct()];
            }
        }
    }

    public void Dispose() => _listener.Dispose();

    private void Record<T>(Instrument instrument, T value, ReadOnlySpan<KeyValuePair<string, object?>> tags)
        where T : struct
    {
        Measurement measurement = new(
            instrument.Name,
            instrument.Unit,
            Convert.ToDouble(value),
            tags.ToArray());

        lock (_gate)
        {
            _measurements.Add(measurement);
        }
    }
}
