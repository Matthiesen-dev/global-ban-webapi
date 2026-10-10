import { defineConfig } from 'drizzle-kit';
import { loadEnv } from "vite";

const { DATABASE_URL } = loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), "");

export default defineConfig({
    dialect: 'sqlite',
    schema: './src/db/schema.ts',
    out: './drizzle',
    dbCredentials: { url: DATABASE_URL ?? 'file:local.db' },
});
