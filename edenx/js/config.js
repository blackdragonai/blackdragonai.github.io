// EDENX AI — configuration.
// Same Supabase project as the studio app + Black Dragon (owner is the same).
// No keys live here beyond the public publishable key — engine secrets stay
// in the Edge Function secrets, exactly like Black Dragon.
window.EX_CONFIG = {
  SUPABASE_URL: "https://mqucttxiwhdbsgzoitmd.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_8xSZSf0q9pYpgDUcPisDxA_lorBSEmS",
  OWNER_EMAIL: "littmobstudios@gmail.com",
  VIRALX_URL: "https://viralx-app.github.io/",
  DURATIONS: [5, 10, 15],

  // Alter Ego styles — the engine restyles the uploaded photo; the face
  // stays the uploader's own (identity wording lives in the prompts).
  EGO_STYLES: [
    { id: "photoreal", name: "Photoreal Star", blurb: "You, as a movie lead. Real skin, real light, red-carpet grade." },
    { id: "claymation", name: "Claymation", blurb: "Hand-made clay look — fingerprints in the clay, stop-motion soul." },
    { id: "manga", name: "Comic / Manga", blurb: "Inked lines, halftone shadows, full shonen energy." },
    { id: "pixar", name: "Pixar-style 3D", blurb: "Big-heart 3D animation look, soft cinematic lighting." },
    { id: "cyberpunk", name: "Cyberpunk", blurb: "Neon rain, chrome, and a city that never sleeps." },
    { id: "goldenage", name: "Golden Age Hollywood", blurb: "1940s silver-screen glamour, black and white done right." },
  ],

  // The Rides — pre-scripted scenes. `prompt` is the motion/scene prompt
  // combined with the Alter Ego start frame by the backend.
  RIDES: [
    { id: "superhero", name: "Superhero Landing", tag: "Action", style: "photoreal",
      blurb: "Rooftop. Storm rolling in. You drop out of the sky and the concrete cracks.",
      prompt: "cinematic superhero landing on a rainy city rooftop at night, cape and dust bursting outward on impact, dramatic rim light, storm clouds, photorealistic, epic slow push-in" },
    { id: "western", name: "Western Showdown", tag: "Western", style: "photoreal",
      blurb: "High noon, empty street, one long stare before the draw.",
      prompt: "old west high-noon showdown on a dusty main street, long coat moving in the wind, hand hovering near the holster, tumbleweed rolls past, golden harsh sunlight, photorealistic cinematic" },
    { id: "chapel", name: "The Haunted Chapel", tag: "Horror", style: "photoreal",
      blurb: "From THE CURSED CHAPEL — a real church, a sound board, and something on Channel 12.",
      prompt: "photorealistic cinematic horror inside a real church sanctuary, thin haze, midnight-blue shadows, a stained-glass cross glowing faint crimson, the subject turns slowly toward a sound only they can hear, dread building, no jump scare" },
    { id: "stage", name: "Music Video Stage", tag: "Music", style: "photoreal",
      blurb: "Your stage. Full lights, full crowd, chorus about to hit.",
      prompt: "music video performance on a big stage, sweeping spotlights and haze, crowd silhouettes with hands up, the subject performs into the camera with star energy, photorealistic, dynamic camera orbit" },
    { id: "anime", name: "Anime Battle", tag: "Anime", style: "manga",
      blurb: "Power-up sequence. The ground cracks. You know the rest.",
      prompt: "shonen anime battle power-up, energy aura rising, debris floating upward, dramatic wind, bold inked lines and halftone shading, the subject charges a final attack" },
    { id: "clay", name: "Claymation Quest", tag: "Clay", style: "claymation",
      blurb: "A tiny hero, a big journey, everything made of clay.",
      prompt: "stop-motion claymation adventure, the clay hero walks a winding clay path through a handmade forest, slight frame-by-frame charm, warm workshop lighting" },
    { id: "heist", name: "Heist Getaway", tag: "Action", style: "photoreal",
      blurb: "Alarm's already ringing. You're the wheelman now.",
      prompt: "cinematic heist getaway, the subject slides into the driver seat of a classic muscle car, tires smoking as it peels into neon city streets at night, photorealistic, fast tracking camera" },
    { id: "space", name: "Space Odyssey", tag: "Sci-Fi", style: "photoreal",
      blurb: "First step onto a new world. Helmet cam optional.",
      prompt: "photorealistic sci-fi, an astronaut steps onto an alien world at dawn, twin suns rising, dust drifting in low gravity, visor reflection of a vast landscape, awe and scale" },
    { id: "boxing", name: "Boxing Champ", tag: "Sports", style: "photoreal",
      blurb: "Walkout. Belt on the line. Crowd on its feet.",
      prompt: "photorealistic boxing championship walkout, the subject in robe and gloves moving through a roaring arena crowd, camera flashes, spotlight tunnel, pure main-event energy" },
    { id: "toon", name: "Toon Adventure", tag: "3D Toon", style: "pixar",
      blurb: "A big-heart animated adventure, starring you.",
      prompt: "pixar-style 3d animated adventure, the hero crosses a glowing rope bridge over a candy-colored canyon at sunset, wonder and warmth, soft cinematic light" },
  ],
};
