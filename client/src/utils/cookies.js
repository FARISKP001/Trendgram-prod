// Simple cookie utilities used across the client
// Provides helpers to set and get cookies with optional expiry

// Retrieve a cookie value by name. Returns null if not found.
export const getCookie = (name) => {
  if (typeof document === 'undefined') return null;
  const match = document.cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match ? match.split('=')[1] : null;
};

// Set a cookie with optional expiration.
// options: { minutes: number, days: number }
export const setCookie = (name, value, options = {}) => {
  if (typeof document === 'undefined') return;
  let maxAge = '';
  if (typeof options.minutes === 'number') {
    maxAge = `; max-age=${options.minutes * 60}`;
  } else if (typeof options.days === 'number') {
    maxAge = `; max-age=${options.days * 24 * 60 * 60}`;
  }
  document.cookie = `${name}=${value || ''}${maxAge}; path=/; SameSite=Lax`;
};