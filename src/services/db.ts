import { Context, Layer } from 'effect';
import { makeDatabase, type Database } from '../db/client';

export class Db extends Context.Service<Db, Database>()('Db') { }

export const DbLive = (url: string, authToken?: string) => Layer.sync(Db, () => makeDatabase(url, authToken));
