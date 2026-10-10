import { isIP } from 'node:net';

export type ProxyMode = 'none' | 'traefik' | 'cloudflare';

export interface ProxyConfig {
    readonly mode: ProxyMode;
    /** Trusted proxies between the client and this app that append to X-Forwarded-For. */
    readonly hops: number;
}

export const proxyConfigFromEnv = (env: Record<string, string | undefined>): ProxyConfig => {
    const mode = (env.TRUSTED_PROXY ?? 'none').trim().toLowerCase();
    if (mode !== 'none' && mode !== 'traefik' && mode !== 'cloudflare') {
        throw new Error(`TRUSTED_PROXY must be one of none, traefik, cloudflare (got "${mode}")`);
    }
    const hops = Number(env.TRUSTED_PROXY_HOPS ?? 1);
    if (!Number.isInteger(hops) || hops < 1) throw new Error('TRUSTED_PROXY_HOPS must be a positive integer');
    return { mode, hops };
};

const clean = (value: string | null | undefined) => {
    const v = value?.trim();
    return v && isIP(v) ? v : undefined;
};

// Collapse IPv6 to its /64 so one subscriber cannot dodge limits by rotating addresses.
export const normalizeIp = (ip: string): string => {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapped?.[1]) return mapped[1];
    if (isIP(ip) !== 6) return ip;
    const [head = '', tail = ''] = ip.toLowerCase().split('::');
    const headGroups = head ? head.split(':') : [];
    const tailGroups = tail ? tail.split(':') : [];
    const missing = 8 - headGroups.length - tailGroups.length;
    const groups = ip.includes('::') ? [...headGroups, ...Array(missing).fill('0'), ...tailGroups] : headGroups;
    return `${groups
        .slice(0, 4)
        .map((g) => g.replace(/^0+(?=.)/, ''))
        .join(':')}::/64`;
};

/**
 * Headers are only trustworthy when the app is reachable solely through the configured proxy;
 * `fallback` (the socket address) is used whenever the expected header is missing or invalid.
 */
export const resolveClientIp = (config: ProxyConfig, headers: Headers, fallback: string): string => {
    let ip: string | undefined;
    if (config.mode === 'cloudflare') {
        // Cloudflare overwrites any client-supplied value, including through Tunnel and Access.
        ip = clean(headers.get('cf-connecting-ip'));
    } else if (config.mode === 'traefik') {
        // Count from the right: entries added by our own proxies are trusted, anything before is client-supplied.
        const parts = (headers.get('x-forwarded-for') ?? '').split(',');
        ip = clean(parts[parts.length - config.hops]);
    }
    return normalizeIp(ip ?? fallback);
};
