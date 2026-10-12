import { Context, Layer } from 'effect';
import { makeDatabaseEffect, type Database } from '../db/client';

export class Db extends Context.Service<Db, Database>()('Db') { }

export const DbLive = Layer.effect(Db, makeDatabaseEffect);
