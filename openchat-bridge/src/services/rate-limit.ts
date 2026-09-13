type Bucket = { timestamps: number[] };

const buckets = new Map<string, Bucket>();

export function allowRequest(key: string, limitPerMinute: number, now = Date.now()): boolean {
  const windowStart = now - 60_000;
  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((ts) => ts > windowStart);
  if (bucket.timestamps.length >= limitPerMinute) {
    buckets.set(key, bucket);
    return false;
  }
  bucket.timestamps.push(now);
  buckets.set(key, bucket);
  return true;
}

export function resetRateLimits(): void {
  buckets.clear();
}
