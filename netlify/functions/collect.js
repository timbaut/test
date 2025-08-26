// netlify/functions/collect.js  (Functions v2, ESM, Web-API Request/Response)
export default async (request, context) => {
  // === Deine Konfiguration ===
  const WEBHOOK_URL   = "https://webhook.site/fc10ea3b-4b75-4725-aa21-3856361748ca";
  const IPINFO_TOKEN  = "c243a3b2feab7f";
  const GEO_TIMEOUT_MS = 4000;

  // -- kleine Helfer --
  const json = (status, data) =>
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

  const withTimeout = (p, ms, label) =>
    Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout@${label}`)), ms))]);

  const fetchJSON = async (url, label) => {
    const r = await withTimeout(fetch(url, { cache: "no-store" }), GEO_TIMEOUT_MS, label);
    if (!r.ok) throw new Error(`HTTP ${r.status} @ ${label}`);
    return r.json();
  };

  // Header aus Request (case-insensitiv via .get)
  const H = request.headers;
  const getClientIP = () =>
    H.get("x-nf-client-connection-ip") ||
    (H.get("x-forwarded-for") ? H.get("x-forwarded-for").split(",")[0].trim() : null) ||
    H.get("x-real-ip") ||
    H.get("client-ip") ||
    H.get("cf-connecting-ip") ||
    null;

  // Geo anhand der **Client-IP**
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
    return Promise.any(probes);
  };

  try {
    // Client-Payload lesen (Web-API)
    let clientPayload = {};
    if (request.method === "POST") {
      try { clientPayload = await request.json(); } catch { clientPayload = {}; }
    }

    // **Korrekte Client-IP** und Headerinfos holen
    const ip       = getClientIP();
    const userAgent = H.get("user-agent") || null;
    const referer   = H.get("referer") || H.get("referrer") || null;

    // Geo anreichern
    let ip_geolocation;
    try { ip_geolocation = await geoLookup(ip); }
    catch (e) { ip_geolocation = { src: "none", note: String(e) }; }

    const out = {
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
      const r = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(out),
      });
      forwarded = r.ok;
      forwardStatus = r.status;
    } catch (e) {
      forwarded = false;
      forwardStatus = String(e);
    }

    // direkte API-Antwort
    return json(200, { ok: true, forwarded, forwardStatus, ip_used: ip, geo_src: ip_geolocation?.src });
  } catch (e) {
    return json(500, { ok: false, error: String(e) });
  }
};
