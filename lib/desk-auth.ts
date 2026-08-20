export function allowEdit(request: Request): boolean {
  const token = process.env.DESK_EDIT_TOKEN;
  if (!token) return false;
  return request.headers.get("x-desk-token") === token;
}
