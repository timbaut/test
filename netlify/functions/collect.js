// netlify/functions/collect.js
export default async (req) => {
  // === Deine Konfiguration ===
  const WEBHOOK_URL = "https://webhook.site/fc10ea3b-4b75-4725-aa21-3856361748ca";
  const IPINFO_TOKEN = "c243a3b2feab7f";
  const GEO_TIMEOUT_MS = 4000;

  // === Helpers ===
  const jsonResponse = (status, data) => ({
    statusCode: status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  const withTimeout = async (p, ms, label) => {
    const t = new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout@${label}`)), ms));
    return Promise.race([p, t]);
  };

  const fetchJSON = async (url, label) => {
    const r = await withTimeout(fetch(url, { cache: "no-store" }), GEO_TIMEOUT_MS, label);
    if (!r.ok) throw new Error(`HTTP ${r.status} @ ${label}`);
    return r.json();
  };

  const hget = (headers, name) => {
    // case-insensitive Header-Lookup
    if (!headers) return undefined;
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === lower) return v;
    }
    return undefined;
  };

  const getClientIP = (headers) => {
    const nf = hget(headers, "x-nf-client-connection-ip");
    const xff = hget(headers, "x-forwarded-for");
    const real = hget(headers, "x-real-ip");
    const cip = hget(headers, "client-ip");
    const cfip = hget(headers, "cf-connecting-ip");

    if (nf) return nf;
    if (xff) return xff.split(",")[0].trim();
    if (real) return real;
    if (cip) return cip;
    if (cfip) return cfip;
    return null;
  };

  // Geo anhand der **Client-IP**, nicht der Server-IP
  const geoLookup = async (ip) => {
    const probes = [
      (async () => {
        const g = await fetchJSON(ip ? `https://ipapi.co/${ip}/json/` : "https://ipapi.co/json/", "ipapi.co");
        return { src: "ipapi.co", city: g.city, region: g.region, country: g.country_name, country_code: g.country,
                 org: g.org, asn: g.asn, latitude: g.latitude, longitude: g.longitude, timezone: g.timezone };
      })(),
      (async () => {
        const g = await fetchJSON(`https://ipwho.is/${ip ?? ""}`, "ipwho.is");
        if (g.success === false) throw new Error("ipwho.is failed");
        return { src: "ipwho.is", city: g.city, region: g.region, country: g.country, country_code: g.country_code,
                 org: g.connection?.org, asn: g.connection?.asn, latitude: g.latitude, longitude: g.longitude, timezone: g.timezone?.id };
      })(),
      (async () => {
        // geojs kann optional ?ip= unterstützen; Basis-Endpoint liefert anfragende IP,
        // aber wir nutzen hier den Standard und akzeptieren ggf. server-IP als Fallback.
        const g = await fetchJSON("https://get.geojs.io/v1/ip/geo.json", "geojs.io");
        return { src: "geojs.io", city: g.city, region: g.region, country: g.country, country_code: g.country_code,
                 org: g.organization, asn: g.asn, latitude: Number(g.latitude), longitude: Number(g.longitude), timezone: g.timezone };
      })(),
      (async () => {
        const g = await fetchJSON(`https://ip-api.com/json/${ip ?? ""}?fields=status,country,countryCode,regionName,city,lat,lon,isp,as,timezone`, "ip-api.com");
        if (g.status !== "success") throw new Error("ip-api failed");
        return { src: "ip-api.com", city: g.city, region: g.regionName, country: g.country, country_code: g.countryCode,
                 org: g.isp, asn: g.as, latitude: g.lat, longitude: g.lon, timezone: g.timezone };
      })(),
      (async () => {
        const g = await fetchJSON(
          ip ? `https://ipinfo.io/${encodeURIComponent(ip)}/json?token=${encodeURIComponent(IPINFO_TOKEN)}`
             : `https://ipinfo.io/json?token=${encodeURIComponent(IPINFO_TOKEN)}`,
          "ipinfo.io"
        );
        const [lat, lon] = (g.loc || "").split(",").map(Number);
        return { src: "ipinfo.io", city: g.city, region: g.region, country: g.country, country_code: g.country,
                 org: g.org, asn: undefined, latitude: lat, longitude: lon, timezone: g.timezone };
      })(),
    ];
    return await Promise.any(probes);
  };

  try {
    // Client-Payload (vom Browser)
    let clientPayload = {};
    if (req.httpMethod === "POST" && req.body) {
      try { clientPayload = JSON.parse(req.body); } catch { clientPayload = {}; }
    }

    // **WICHTIG**: echte Client-IP aus Headers holen
    const ip = getClientIP(req.headers);

    // Geo zur **Client-IP**
    let ip_geolocation;
    try { ip_geolocation = await geoLookup(ip); }
    catch (e) { ip_geolocation = { src: "none", note: String(e) }; }

    const userAgent = hget(req.headers, "user-agent") || null;
    const referer   = hget(req.headers, "referer") || hget(req.headers, "referrer") || null;

    const serverPayload = {
      received_at_iso: new Date().toISOString(),
      request_ip: ip,
      user_agent: userAgent,
      referrer: referer,
      client: clientPayload || null,
      ip_geolocation,
      runtime: { platform: "netlify-functions", node: process.version },
    };

    // an webhook.site weiterleiten
    let forwarded = false, forwardStatus = null;
    try {
      const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(serverPayload),
      });
      forwarded = res.ok;
      forwardStatus = res.status;
    } catch (e) {
      forwarded = false;
      forwardStatus = String(e);
    }

    return jsonResponse(200, { ok: true, forwarded, forwardStatus, ip_used: ip, geo_src: ip_geolocation?.src });
  } catch (e) {
    return jsonResponse(500, { ok: false, error: String(e) });
  }
};
