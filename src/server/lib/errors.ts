export type HttpErrorStatus = 400 | 401 | 403 | 404 | 409 | 410 | 422 | 429 | 500 | 501 | 503

export class AppError extends Error {
  constructor(
    public readonly status: HttpErrorStatus,
    message: string
  ) {
    super(message)
    this.name = 'AppError'
  }
}
