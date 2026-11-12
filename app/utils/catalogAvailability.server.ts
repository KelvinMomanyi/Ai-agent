export class CatalogUnavailableError extends Error {
  constructor() {
    super("The recommendation catalog is temporarily unavailable");
    this.name = "CatalogUnavailableError";
  }
}
