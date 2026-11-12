export function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "org";
}

export function dbMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/illegal status transition/i.test(message)) return "That status change is not allowed.";
  if (/duplicate key/i.test(message) && /email/i.test(message)) return "That email is already registered.";
  if (/duplicate key/i.test(message) && /slug/i.test(message)) return "That organization address is already taken.";
  if (/last owner/i.test(message)) return "The last owner cannot leave or be removed.";
  if (/dlp/i.test(message)) return "Production agents cannot hold payment read and outbound HTTP together without an owner exception.";
  if (/four-eyes|cannot approve/i.test(message)) return "You cannot approve this request.";
  if (/permission/i.test(message)) return "You do not have permission to do that.";
  return "That could not be saved. Check the values and try again.";
}

export function titleCase(value: string) {
  return value.replaceAll("_", " ").replaceAll(".", " ");
}
