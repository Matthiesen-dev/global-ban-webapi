// Player IPs must never reach the dashboard HTML unmasked.
export const maskIp = (ip: string): string => {
    if (ip.includes(':')) {
        const groups = ip.split(':').filter(Boolean);
        return `${groups.slice(0, 2).join(':')}:x:x`;
    }
    const parts = ip.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.x.x`;
    return 'hidden';
};
