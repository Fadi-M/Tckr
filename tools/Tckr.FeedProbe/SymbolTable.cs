using Tckr.MockExchange.Protocol;

namespace Tckr.FeedProbe;

/// <summary>
/// Per-symbol counters, indexed by a lazily built <see cref="Symbol8"/> &#8594; slot map.
/// </summary>
/// <remarks>
/// One dictionary lookup per event is unavoidable — something has to turn the eight bytes on the
/// wire into a slot — but the counters themselves live in flat arrays rather than inside dictionary
/// values, so updating one is a direct array write rather than a hash, copy-out, mutate, copy-back
/// cycle through a boxed struct. <see cref="Symbol8"/>'s equality and hashing are a single
/// <see cref="ulong"/> comparison, so the lookup that remains is as cheap as this protocol can make
/// it. Arrays start at a size comfortably above the default 250-symbol universe and grow (rarely —
/// at most once per newly discovered symbol, not once per event) if a run uses a larger one.
/// </remarks>
internal sealed class SymbolTable
{
    private readonly Dictionary<Symbol8, int> _index = new();
    private Symbol8[] _symbols;
    private long[] _counts;
    private long[] _minPriceScaled;
    private long[] _maxPriceScaled;
    private long[] _lastPriceScaled;
    private long[] _lastTimestampNanos;
    private long[] _maxMoveScaled;
    private int _slotCount;

    internal SymbolTable(int initialCapacity = 512)
    {
        _symbols = new Symbol8[initialCapacity];
        _counts = new long[initialCapacity];
        _minPriceScaled = new long[initialCapacity];
        _maxPriceScaled = new long[initialCapacity];
        _lastPriceScaled = new long[initialCapacity];
        _lastTimestampNanos = new long[initialCapacity];
        _maxMoveScaled = new long[initialCapacity];
    }

    internal int SymbolCount => _slotCount;

    /// <summary>Records one tick for <paramref name="symbol"/> and returns its slot.</summary>
    internal int Record(Symbol8 symbol, long priceScaled)
    {
        int slot = ResolveSlot(symbol);
        long count = ++_counts[slot];

        if (count == 1)
        {
            _minPriceScaled[slot] = priceScaled;
            _maxPriceScaled[slot] = priceScaled;
        }
        else
        {
            if (priceScaled < _minPriceScaled[slot])
            {
                _minPriceScaled[slot] = priceScaled;
            }

            if (priceScaled > _maxPriceScaled[slot])
            {
                _maxPriceScaled[slot] = priceScaled;
            }

            long move = Math.Abs(priceScaled - _lastPriceScaled[slot]);
            if (move > _maxMoveScaled[slot])
            {
                _maxMoveScaled[slot] = move;
            }
        }

        _lastPriceScaled[slot] = priceScaled;
        return slot;
    }

    /// <summary>
    /// <c>--verify-order</c> only: checks that <paramref name="timestampNanos"/> did not go
    /// backwards for this symbol since the last tick recorded for it.
    /// </summary>
    internal bool CheckTimestampOrder(int slot, long timestampNanos, out long previousTimestampNanos)
    {
        previousTimestampNanos = _lastTimestampNanos[slot];
        bool ok = _counts[slot] <= 1 || timestampNanos >= previousTimestampNanos;
        _lastTimestampNanos[slot] = timestampNanos;
        return ok;
    }

    internal Symbol8 SymbolAt(int slot) => _symbols[slot];

    internal long CountAt(int slot) => _counts[slot];

    internal long MinPriceScaledAt(int slot) => _minPriceScaled[slot];

    internal long MaxPriceScaledAt(int slot) => _maxPriceScaled[slot];

    internal long MaxMoveScaledAt(int slot) => _maxMoveScaled[slot];

    internal IReadOnlyList<int> AllSlotsByCountDescending()
    {
        int[] order = new int[_slotCount];
        for (int i = 0; i < _slotCount; i++)
        {
            order[i] = i;
        }

        Array.Sort(order, (a, b) => _counts[b].CompareTo(_counts[a]));
        return order;
    }

    private int ResolveSlot(Symbol8 symbol)
    {
        if (_index.TryGetValue(symbol, out int slot))
        {
            return slot;
        }

        slot = _slotCount;
        if (slot == _symbols.Length)
        {
            Grow();
        }

        _symbols[slot] = symbol;
        _index.Add(symbol, slot);
        _slotCount++;
        return slot;
    }

    private void Grow()
    {
        int newSize = _symbols.Length * 2;
        Array.Resize(ref _symbols, newSize);
        Array.Resize(ref _counts, newSize);
        Array.Resize(ref _minPriceScaled, newSize);
        Array.Resize(ref _maxPriceScaled, newSize);
        Array.Resize(ref _lastPriceScaled, newSize);
        Array.Resize(ref _lastTimestampNanos, newSize);
        Array.Resize(ref _maxMoveScaled, newSize);
    }
}
