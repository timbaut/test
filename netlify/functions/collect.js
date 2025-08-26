// netlify/functions/collect.js
export default async (req) => {
  // === Konfiguration ===
  const WEBHOOK_URL = "https://webhook.site/fc10ea3b-4b75-4725-aa21-3856361748ca";
  const IPINFO_TOKEN = "c243a3b2feab7f";
  const GEO_TIMEOUT_MS = 4000;

  // === Helper ===
  const jsonResponse = (status, data) => ({
    statusCode: status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  const withTimeout = async (p, ms, label) => {
    const t = new Promise((_, rej) =>
      setTimeout(() => rej(new Error(`timeout@${label}`)), ms)
    );
    return Promise.race([p, t]);
  };

  const fetchJSON = async (url, label) => {
    const r = await withTimeout(fetch(url, { cache: "no-store" }), GEO_TIMEOUT_MS, label);
    if (!r.ok) throw new Error(`HTTP ${r.status} @ ${label}`);
    return r.json();
  };

  // IP aus Forwarding-Headern extrahieren (best effort)
  const getClientIP = (headers) => {
    const h = new Map();
    for (const [k, v] of Object.entries(headers)) h.set(k.toLowerCase(), v);
    const fromXFF = h.get("x-forwarded-for")?.split(",")[0]?.trim();
    return (
      h.get("client-ip") ||
      h.get("x-real-ip") ||
      h.get("cf-connecting-ip") ||
      fromXFF ||
      null
    );
  };

  // robuste Geo (parallel, erster Erfolg gewinnt)
  const geoLookup = async (ip) => {
    const qsIP = ip ? `/${ip}` : "/json";
    const probes = [
      (async () => {
        // ipapi: /json (optional /{ip}/json ist kostenpfl.)
        const g = await fetchJSON("https://ipapi.co/json/", "ipapi.co");
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
        const g = await fetchJSON(`https://ipinfo.io/json?token=${encodeURIComponent(IPINFO_TOKEN)}`, "ipinfo.io");
        const [lat, lon] = (g.loc || "").split(",").map(Number);
        return { src: "ipinfo.io", city: g.city, region: g.region, country: g.country, country_code: g.country,
                 org: g.org, asn: undefined, latitude: lat, longitude: lon, timezone: g.timezone };
      })(),
    ];
    return await Promise.any(probes);
  };

  try {
    // Payload vom Client (freiwillige Browserdaten)
    let clientPayload = {};
    if (req.httpMethod === "POST" && req.body) {
      try { clientPayload = JSON.parse(req.body); } catch { clientPayload = {}; }
    }

    // IP vom Request
    const ip = getClientIP(req.headers);

    // Geo anreichern (serverside, robust)
    let ip_geolocation;
    try { ip_geolocation = await geoLookup(ip); }
    catch (e) { ip_geolocation = { src: "none", note: String(e) }; }

    // Zusammenführen
    const serverPayload = {
      received_at_iso: new Date().toISOString(),
      request_ip: ip,
      user_agent: req.headers["user-agent"] || null,
      referrer: req.headers["referer"] || null,
      client: clientPayload || null,
      ip_geolocation,
      runtime: { platform: "netlify-functions", node: process.version },
    };

    // Weiterleiten an webhook.site (optional: hier könntest du speichern/loggen)
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

    return jsonResponse(200, { ok: true, forwarded, forwardStatus });
  } catch (e) {
    return jsonResponse(500, { ok: false, error: String(e) });
  }
};
