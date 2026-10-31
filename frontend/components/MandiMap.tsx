"use client";

// Plain Leaflet (no wrapper lib). Loaded with next/dynamic ssr:false because Leaflet needs window.
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import type { MandiRow, Place } from "@/lib/api";

// Mandi names come from an external API: escape before putting them in popup HTML.
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function pin(label: string, color: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<div style="background:${color};color:#fff;border:2px solid #fff;border-radius:999px;width:28px;height:28px;display:grid;place-items:center;font:700 13px/1 sans-serif;box-shadow:0 1px 4px #0006">${label}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

export default function MandiMap({ origin, mandis }: { origin: Place; mandis: MandiRow[] }) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!el.current) return;
    const map = L.map(el.current, { scrollWheelZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    const pts: L.LatLngExpression[] = [[origin.lat, origin.lon]];
    L.marker([origin.lat, origin.lon], { icon: pin("घर", "#1f2937") })
      .bindPopup(`आपका गाँव: ${esc(origin.name)}`)
      .addTo(map);
    mandis.forEach((m, i) => {
      if (m.lat == null || m.lon == null) return;
      pts.push([m.lat, m.lon]);
      L.marker([m.lat, m.lon], { icon: pin(String(i + 1), i === 0 ? "#15803d" : "#a16207") })
        .bindPopup(`<b>${i + 1}. ${esc(m.market)}</b><br>₹${m.net_per_quintal}/q net<br>${m.road_km} km`)
        .addTo(map);
    });
    map.fitBounds(L.latLngBounds(pts), { padding: [24, 24], maxZoom: 11 });
    return () => {
      map.remove();
    };
  }, [origin, mandis]);

  return <div ref={el} className="h-72 w-full rounded-xl" role="img" aria-label="मंडियों का नक्शा" />;
}
