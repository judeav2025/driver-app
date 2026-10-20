import QRCode from 'qrcode';

// SVG QR code for ?u=<url>, or for the site root when u is missing.
export async function qrResponse(requestUrl) {
  const url = new URL(requestUrl);
  const target = url.searchParams.get('u') || `${url.origin}/`;
  if (!/^https?:\/\//.test(target) || target.length > 512) {
    return { status: 400, type: 'text/plain', body: 'u must be an http(s) URL' };
  }
  const svg = await QRCode.toString(target, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return { status: 200, type: 'image/svg+xml', body: svg };
}
