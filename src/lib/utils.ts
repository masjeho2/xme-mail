export function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export function badRequest(error: string, extra?: Record<string, unknown>) {
  return Response.json({ error, ...extra }, { status: 400 });
}

export function notFound(error = "Not found") {
  return Response.json({ error }, { status: 404 });
}

export function serverError(error: string) {
  return Response.json({ error }, { status: 500 });
}

export function formatAddress(localPart: string, domain: string) {
  return `${localPart}@${domain}`;
}
