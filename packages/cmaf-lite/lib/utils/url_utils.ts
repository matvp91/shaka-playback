export function isAbsoluteUrl(url: string) {
  return url.startsWith("http://") || url.startsWith("https://");
}

export function resolveUrl(url: string, base?: string) {
  if (!base) {
    return url;
  }
  if (isAbsoluteUrl(url)) {
    return url;
  }
  if (isAbsoluteUrl(base)) {
    return new URL(url, base).href;
  }
  return base.endsWith("/") ? `${base}${url}` : `${base}/${url}`;
}

export function resolveUrls(urls: string[]) {
  return urls.reduce<string>(
    (acc, val) => (val !== undefined ? resolveUrl(val, acc) : acc),
    "",
  );
}
