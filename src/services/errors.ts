import { Data } from 'effect';

export class InvalidPayload extends Data.TaggedError('InvalidPayload')<{ readonly message: string }> { }

export class ServerNotRegistered extends Data.TaggedError('ServerNotRegistered')<{}> { }

export class ServerNotInCommunity extends Data.TaggedError('ServerNotInCommunity')<{}> { }

export class DatabaseError extends Data.TaggedError('DatabaseError')<{ readonly cause: unknown }> { }

export class Forbidden extends Data.TaggedError('Forbidden')<{ readonly message: string }> { }
