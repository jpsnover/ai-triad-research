interface Props {
  totalChunks: number;
  completedChunks: number;
  currentChunk: number;
}

export default function ChunkProgress({ totalChunks, completedChunks, currentChunk }: Props) {
  if (totalChunks <= 1) return null;

  const pct = Math.round((completedChunks / totalChunks) * 100);

  return (
    <div className="chunk-progress">
      <div className="chunk-progress-header">
        <span className="chunk-progress-label">
          Processing chunk {currentChunk + 1} of {totalChunks}
        </span>
        <span className="chunk-progress-pct">{pct}%</span>
      </div>
      <div className="chunk-progress-bar-track">
        <div
          className="chunk-progress-bar-fill"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="chunk-progress-segments">
        {Array.from({ length: totalChunks }).map((_, i) => (
          <div
            key={i}
            className={`chunk-segment ${
              i < completedChunks ? 'done' : i === currentChunk ? 'active' : ''
            }`}
          />
        ))}
      </div>
    </div>
  );
}
