using System.Buffers;

namespace Tckr.FeedProbe.Tests.Support;

/// <summary>
/// Builds a two-segment <see cref="ReadOnlySequence{T}"/> split at an arbitrary byte offset, the
/// same shape a <c>System.IO.Pipelines</c> reader hands a consumer when a read boundary falls
/// mid-frame. Mirrors the private <c>Segment</c> helper in
/// <c>Tckr.MockExchange.Tests/Protocol/FeedFrameReaderTests.cs</c>.
/// </summary>
internal static class Segmented
{
    internal static ReadOnlySequence<byte> Split(byte[] data, int splitAt)
    {
        var first = new Segment(data.AsMemory(0, splitAt));
        Segment last = first.Append(data.AsMemory(splitAt));
        return new ReadOnlySequence<byte>(first, 0, last, last.Memory.Length);
    }

    private sealed class Segment : ReadOnlySequenceSegment<byte>
    {
        internal Segment(ReadOnlyMemory<byte> memory) => Memory = memory;

        internal Segment Append(ReadOnlyMemory<byte> memory)
        {
            var next = new Segment(memory) { RunningIndex = RunningIndex + Memory.Length };
            Next = next;
            return next;
        }
    }
}
