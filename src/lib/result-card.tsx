import { ImageResponse } from "next/og";
export function resultCard(title: string, teams: string, result: string, detail: string, sponsors: string[], logos: string[] = [], award?: string) {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        background: "#064e3b",
        color: "white",
        padding: 64,
      }}
    >
      <div style={{ display: "flex", fontSize: 26, color: "#a7f3d0" }}>CricMitra · {title.slice(0, 100)}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", fontSize: 42, lineHeight: 1.2 }}>{teams.slice(0, 170)}</div>
        <div style={{ display: "flex", fontSize: 48, fontWeight: 700, lineHeight: 1.1 }}>{result.slice(0, 200)}</div>
        <div style={{ display: "flex", fontSize: 28, color: "#d1fae5" }}>{detail.slice(0, 160)}</div>
        {award && (
          <div style={{ display: "flex", alignSelf: "flex-start", fontSize: 28, fontWeight: 700, color: "#422006", background: "#fcd34d", padding: "10px 20px", borderRadius: 12 }}>
            {award.slice(0, 90)}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 20, color: "#a7f3d0" }}>
        {logos.length > 0 && (
          <div style={{ display: "flex", gap: 16 }}>
            {logos.slice(0, 3).map((logo, i) => (
              // ImageResponse renders these verified storage images directly.
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={logo} alt="Sponsor" width={48} height={48} style={{ objectFit: "contain", background: "white" }} />
            ))}
          </div>
        )}
        {sponsors.length ? `Supported by ${sponsors.slice(0, 4).join(" · ").slice(0, 180)}` : "Community cricket, together"}
      </div>
    </div>,
    {
      width: 1200,
      height: 800,
      headers: { "Content-Disposition": "attachment; filename=cricmitra-result.png", "Cache-Control": "no-store" },
    },
  );
}
