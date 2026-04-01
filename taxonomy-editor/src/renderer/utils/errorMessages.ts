/**
 * Translate raw error messages into user-friendly, actionable guidance.
 */
export function mapErrorToUserMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);

  // API rate limiting — check BEFORE Python errors since chained errors can contain both
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('Rate limit')) {
    return 'API rate limited. Wait a minute and try again, or switch to a different model in Settings.';
  }

  // API overloaded
  if (msg.includes('503') || msg.includes('529') || msg.includes('overloaded')) {
    return 'AI service is temporarily overloaded. Try again in a few seconds.';
  }

  // Python/embedding issues
  if (msg.includes('Python') || msg.includes('python3') || msg.includes('python')) {
    if (msg.includes('not found') || msg.includes('ENOENT') || msg.includes('not installed')) {
      return 'Python is not installed or not on PATH. Install Python 3.9+ from python.org and run: pip3 install sentence-transformers';
    }
    if (msg.includes('sentence_transformers') || msg.includes('sentence-transformers')) {
      return 'The sentence-transformers package is missing. Run: pip3 install sentence-transformers';
    }
    return `Python error: ${msg.slice(0, 200)}`;
  }

  // File not found
  if (msg.includes('ENOENT') || msg.includes('no such file') || msg.includes('not found')) {
    if (msg.includes('embeddings.json')) {
      return 'Embeddings file not found. Run Update-TaxEmbeddings in PowerShell to generate it.';
    }
    if (msg.includes('taxonomy') || msg.includes('Origin')) {
      return 'Taxonomy data not found. Check that the data repository is available and .aitriad.json is configured.';
    }
    return `File not found: ${msg.slice(0, 150)}`;
  }

  // No API key
  if (msg.includes('No') && msg.includes('API key')) {
    return msg; // Already actionable — pass through
  }

  // JSON parse errors
  if (msg.includes('JSON') || msg.includes('Unexpected token') || msg.includes('parse')) {
    if (msg.includes('AI') || msg.includes('response') || msg.includes('generate')) {
      return 'The AI returned an invalid response. Try again — this sometimes happens with complex prompts.';
    }
    return `Data file is corrupted: ${msg.slice(0, 150)}`;
  }

  // Permission errors
  if (msg.includes('EACCES') || msg.includes('permission denied')) {
    return `Permission denied. Check file permissions: ${msg.slice(0, 150)}`;
  }

  // Disk space
  if (msg.includes('ENOSPC') || msg.includes('disk') || msg.includes('space')) {
    return 'Disk is full. Free up space and try again.';
  }

  // Timeout
  if (msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('timed out')) {
    return 'Operation timed out. The AI service may be slow — try again or switch to a faster model.';
  }

  // Default: truncate the raw message
  return msg.length > 200 ? msg.slice(0, 200) + '...' : msg;
}
