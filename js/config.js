// BLACK DRAGON AI - configuration.
// Same Supabase project as the studio app (owner account is the same).
// The fal.ai key is NEVER here - it lives in the Edge Function secrets.
window.BD_CONFIG = {
  SUPABASE_URL: "https://mqucttxiwhdbsgzoitmd.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_8xSZSf0q9pYpgDUcPisDxA_lorBSEmS",
  OWNER_EMAIL: "littmobstudios@gmail.com",
  MODELS: [
    {
      id: "comfy",
      name: "Black Dragon FREE",
      zone: "BETA — FREE",
      blurb: "Our own free engine (Wan 2.2 cinematic). FREE 7 days at a time — reopens every 30 days. One free window per connection.",
      priceNote: "FREE in your 7-day window — reopens every 30 days",
      durations: [5, 10, 15],
      resolutions: ["720p"]
    },
    {
      id: "wan",
      name: "Wan 3.0",
      zone: "CHEAP ZONE",
      blurb: "Fast, low-cost clips. The workhorse - start here.",
      priceNote: "Low per-second rate - cheapest zone",
      durations: [5, 10, 15],
      resolutions: ["720p", "1080p"]
    },
    {
      id: "seedance",
      name: "Seedance 2.5",
      zone: "PREMIUM ZONE",
      blurb: "ByteDance's cinematic model. Up to 30 seconds, native audio, reference images/video/audio.",
      priceNote: "Premium rate - credits per second",
      durations: [5, 10, 15, 30],
      resolutions: ["480p", "720p"]
    },
    {
      id: "music",
      name: "Music (ElevenLabs)",
      zone: "COMING SOON",
      blurb: "Full songs with vocals - the Suno-style zone. Wiring in phase 2.",
      priceNote: "~$0.15 / minute",
      durations: [],
      resolutions: [],
      disabled: true
    }
  ]
};
