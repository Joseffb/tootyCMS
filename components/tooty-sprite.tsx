import { CSSProperties } from "react";

type Pose =
  | "thumbsUp"
  | "notebook"
  | "laptop"
  | "surf"
  | "scooter"
  | "camera"
  | "nap"
  | "megaphone"
  | "ideas"
  | "heart"
  | "reading"
  | "beachball";

const SHEET = {
  width: 1536,
  height: 1024,
};

const FRAME_WIDTH = 384;
const ROW_HEIGHTS = [341, 341, 342] as const;

const POSES: Record<Pose, { col: number; row: 0 | 1 | 2; alt: string }> = {
  thumbsUp: { col: 0, row: 0, alt: "Tooty thumbs up" },
  notebook: { col: 1, row: 0, alt: "Tooty with notebook" },
  laptop: { col: 2, row: 0, alt: "Tooty with laptop" },
  surf: { col: 3, row: 0, alt: "Tooty surfing" },
  scooter: { col: 0, row: 1, alt: "Tooty riding scooter" },
  camera: { col: 1, row: 1, alt: "Tooty with camera" },
  nap: { col: 2, row: 1, alt: "Tooty napping" },
  megaphone: { col: 3, row: 1, alt: "Tooty with megaphone" },
  ideas: { col: 0, row: 2, alt: "Tooty ideas" },
  heart: { col: 1, row: 2, alt: "Tooty heart" },
  reading: { col: 2, row: 2, alt: "Tooty reading" },
  beachball: { col: 3, row: 2, alt: "Tooty with beachball" },
};

function rowTop(row: 0 | 1 | 2) {
  if (row === 0) return 0;
  if (row === 1) return ROW_HEIGHTS[0];
  return ROW_HEIGHTS[0] + ROW_HEIGHTS[1];
}

export default function TootySprite({
  pose,
  scale = 1,
  className = "",
}: {
  pose: Pose;
  scale?: number;
  className?: string;
}) {
  const cfg = POSES[pose];
  const frameHeight = ROW_HEIGHTS[cfg.row];
  const top = rowTop(cfg.row);

  const style: CSSProperties = {
    width: `${FRAME_WIDTH * scale}px`,
    height: `${frameHeight * scale}px`,
    backgroundImage: "url('/tooty/tooty-sprites.png')",
    backgroundRepeat: "no-repeat",
    backgroundSize: `${SHEET.width * scale}px ${SHEET.height * scale}px`,
    backgroundPosition: `-${cfg.col * FRAME_WIDTH * scale}px -${top * scale}px`,
  };

  return <div role="img" aria-label={cfg.alt} className={className} style={style} />;
}
