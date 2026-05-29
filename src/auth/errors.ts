export type AuthErrorKind = 'kms' | 'rsa' | 'login' | 'refresh';

export class AuthError extends Error {
  readonly kind: AuthErrorKind;
  readonly status?: number;
  readonly cause?: unknown;

  constructor(kind: AuthErrorKind, message: string, opts?: { status?: number; cause?: unknown }) {
    super(message);
    this.name = 'AuthError';
    this.kind = kind;
    this.status = opts?.status;
    this.cause = opts?.cause;
    // ES2022 Error.cause polyfill (TS target 따라 자동)
    if (opts?.cause !== undefined && !('cause' in this)) {
      (this as { cause?: unknown }).cause = opts.cause;
    }
  }
}
