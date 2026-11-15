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
      blurb: "Open-source Wan 2.2 text-to-video on our own engine. FREE BETA until Feb 28, 2027 — unlimited generations, no paywalls.",
      priceNote: "FREE BETA — unlimited until Feb 28, 2027",
      durations: [5, 10, 15],
      resolutions: ["720p"]
    },
    {
      id: "comfy-ltx",
      name: "LTX-2.5 FREE — ComfyUI",
      zone: "BETA — FREE",
      blurb: "Open-source LTX-2.5 text-to-video on our own engine. Video with the sound built in — and one prompt can carry a whole multi-shot story. FREE BETA until Feb 28, 2027 — unlimited generations, no paywalls.",
      priceNote: "FREE BETA — unlimited until Feb 28, 2027",
      durations: [5, 10, 15],
      resolutions: ["720p"]
    },
    {
      id: "comfy-i2v",
      hidden: false, // LIVE 2026-11-04 — backend deployed + engine photo test passed (bd-i2v-test-studio.mp4)
      name: "Black Dragon FREE — Image to Video",
      zone: "BETA — FREE",
      blurb: "Open-source Wan 2.2 image-to-video on our own engine. Sora-style: start from your photo and tell it how to move.",
      priceNote: "FREE BETA — unlimited until Feb 28, 2027",
      durations: [5, 10, 15],
      resolutions: ["720p"]
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
