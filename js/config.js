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
      blurb: "Open-source Wan 2.2 text-to-video on our own engine. FREE 7 days at a time — reopens every 30 days. One free window per connection.",
      priceNote: "FREE in your 7-day window — reopens every 30 days",
      durations: [5, 10, 15],
      resolutions: ["720p"]
    },
    {
      id: "comfy-ltx",
      name: "LTX-2.5 FREE — ComfyUI",
      zone: "BETA — FREE",
      blurb: "Open-source LTX-2.5 text-to-video on our own engine. Video with the sound built in — and one prompt can carry a whole multi-shot story. FREE 7 days at a time — reopens every 30 days. One free window per connection.",
      priceNote: "FREE in your 7-day window — reopens every 30 days",
      durations: [5, 10, 15],
      resolutions: ["720p"]
    },
    {
      id: "comfy-i2v",
      hidden: false, // LIVE 2026-11-04 — backend deployed + engine photo test passed (bd-i2v-test-studio.mp4)
      name: "Black Dragon FREE — Image to Video",
      zone: "BETA — FREE",
      blurb: "Open-source Wan 2.2 image-to-video on our own engine. Sora-style: start from your photo and tell it how to move.",
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
      resolutions: ["720p", "1080p"],
      hidden: true
    },
    {
      id: "seedance",
      name: "Seedance 2.5",
      zone: "PREMIUM ZONE",
      blurb: "ByteDance's cinematic model. Up to 30 seconds, native audio, reference images/video/audio.",
      priceNote: "Premium rate - credits per second",
      durations: [5, 10, 15, 30],
      resolutions: ["480p", "720p"],
      hidden: true
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
