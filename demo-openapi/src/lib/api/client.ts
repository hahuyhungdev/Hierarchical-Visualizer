/**
 * openapi-fetch client instance.
 * Creates a typed HTTP client from the generated OpenAPI schema.
 */
import createFetchClient from "openapi-fetch";
import type { paths } from "./v1";

export const fetchClient = createFetchClient<paths>({
  baseUrl: "https://jsonplaceholder.typicode.com",
});
