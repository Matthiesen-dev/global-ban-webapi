import { defineMiddleware } from 'astro:middleware';
import { auth } from './auth';

export const onRequest = defineMiddleware(async (context, next) => {
    const { pathname } = context.url;
    if (pathname.startsWith('/api/v1/')) return next();

    const result = await auth.api.getSession({ headers: context.request.headers });
    context.locals.user = result?.user ?? null;

    if (pathname.startsWith('/dashboard') && !context.locals.user) return context.redirect('/');
    return next();
});
