type DiscordProfile = {
    id: string;
    email?: string | null;
};

export const discordProfileToUser = ({ id, email }: DiscordProfile) => ({
    email: email || `${id}@discord.invalid`,
});