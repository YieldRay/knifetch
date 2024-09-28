/**
 * Inverse of NonNullable<T>.
 */
export type Nullable<T> = T | null | undefined;
/**
 * An await-able value
 */
export type Awaitable<T> = T | PromiseLike<T>;
