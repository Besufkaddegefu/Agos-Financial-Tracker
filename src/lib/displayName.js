export function displayName(value, fallback = 'Unknown user') {
  const name = String(value || '').trim();
  if (!name || name.includes('@') || /^user_[a-z0-9]+$/i.test(name)) return fallback;
  return name;
}
