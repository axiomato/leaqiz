// Einfache Ratenbegrenzung je Schlüssel (meist IP-Adresse) mit festem Zeitfenster.
// Schulen teilen sich oft eine IP für die ganze Klasse: Grenzen deshalb großzügig wählen.
export class RateLimiter {
  constructor({ limit, windowMs, now = Date.now }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.buckets = new Map();
    this.cleaner = setInterval(() => this.prune(), Math.max(windowMs, 10_000));
    this.cleaner.unref?.();
  }

  // true = erlaubt (und gezählt), false = Grenze erreicht
  take(key) {
    const now = this.now();
    let b = this.buckets.get(key);
    if (!b || now - b.start >= this.windowMs) {
      b = { start: now, count: 0 };
      this.buckets.set(key, b);
    }
    if (b.count >= this.limit) return false;
    b.count += 1;
    return true;
  }

  // Grenze erreicht, ohne zu zählen
  blocked(key) {
    const b = this.buckets.get(key);
    return Boolean(b && this.now() - b.start < this.windowMs && b.count >= this.limit);
  }

  prune() {
    const now = this.now();
    for (const [key, b] of this.buckets) if (now - b.start >= this.windowMs) this.buckets.delete(key);
  }

  stop() {
    clearInterval(this.cleaner);
  }
}

// Client-IP. Hinter genau einem Reverse-Proxy (Caddy) steht sie als letzter Eintrag in X-Forwarded-For.
export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff) {
      const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
      if (parts.length) return parts[parts.length - 1];
    }
  }
  return req.socket.remoteAddress || 'unbekannt';
}
