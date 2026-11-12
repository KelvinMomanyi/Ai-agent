export class CatalogUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super("The recommendation catalog is temporarily unavailable", options);
    this.name = "CatalogUnavailableError";
  }
}
