export const TOOTY_IMAGES = [
  "/tooty/sprites/tooty-camera.png",
  "/tooty/sprites/tooty-heart.png",
  "/tooty/sprites/tooty-ideas.png",
  "/tooty/sprites/tooty-laptop.png",
  "/tooty/sprites/tooty-megaphone.png",
  "/tooty/sprites/tooty-nap.png",
  "/tooty/sprites/tooty-notebook.png",
  "/tooty/sprites/tooty-reading.png",
  "/tooty/sprites/tooty-scooter.png",
  "/tooty/sprites/tooty-surf.png",
] as const;

export const DEFAULT_TOOTY_IMAGE = TOOTY_IMAGES[0];
export const NON_LIBRARY_TOOTY_MASCOTS = [
  "/tooty/sprites/tooty-thumbs-up.png",
  "/tooty/sprites/tooty-notebook.png",
  "/tooty/sprites/tooty-laptop.png",
  "/tooty/sprites/tooty-surf.png",
  "/tooty/sprites/tooty-scooter.png",
  "/tooty/sprites/tooty-camera.png",
  "/tooty/sprites/tooty-nap.png",
  "/tooty/sprites/tooty-megaphone.png",
  "/tooty/sprites/tooty-ideas.png",
  "/tooty/sprites/tooty-heart.png",
] as const;

export function pickRandomTootyImage() {
  const index = Math.floor(Math.random() * TOOTY_IMAGES.length);
  return TOOTY_IMAGES[index];
}

export function pickRandomNonLibraryMascot() {
  const index = Math.floor(Math.random() * NON_LIBRARY_TOOTY_MASCOTS.length);
  return NON_LIBRARY_TOOTY_MASCOTS[index];
}

export function pickDeterministicNonLibraryMascot(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const index = hash % NON_LIBRARY_TOOTY_MASCOTS.length;
  return NON_LIBRARY_TOOTY_MASCOTS[index];
}
