/**
 * openapi-react-query client.
 * Wraps the fetch client with TanStack React Query hooks.
 */
import createClient from "openapi-react-query";
import { fetchClient } from "./client";

export const $api = createClient(fetchClient);
