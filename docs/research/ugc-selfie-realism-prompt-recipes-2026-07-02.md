# UGC Selfie Realism Prompt Recipes

Date: 2026-07-02

## Context

We tested fal.ai Nano Banana 2 for Mobile Ad Agent UGC selfie first frames after the
direct Google AI key was blocked as leaked. The goal was to make creator frames feel like
real iPhone/social video stills, not polished AI portraits.

Artifacts:

- `artifacts/fal-nano-banana-2-ugc-selfie-test-20260702-170023/`
- `artifacts/fal-nano-banana-2-realism-bakeoff-20260702-170915/`
- `artifacts/fal-nano-banana-2-realism-bakeoff-v2-20260702-171311/`
- `artifacts/fal-nano-banana-2-realism-bakeoff-v3-20260702-171723/`
- `artifacts/fal-nano-banana-2-realism-edit-pass-v4-20260702-172223/`

## Core Finding

The winning direction is not "more photorealistic" or more cinematic. It is less polished:

- first frame from a handheld iPhone front-camera video
- no Portrait Mode, no DSLR, no creamy bokeh
- small-sensor phone look with the scene mostly readable
- flat or ugly mixed lighting
- awkward but still ad-usable framing
- mild social compression, glare, lens smudge, auto-HDR, or sensor noise
- mid-sentence asymmetry and imperfect eyeline

The main remaining AI tell after v2 was the face being too calmly optimized. The prompt
needs to make the creator look caught mid-thought rather than posing.

## Recommended Pipeline

1. Generate 2-4 text-to-image candidates per scenario with the scenario recipe below.
2. Curate the most believable anchor by scenario.
3. Run Nano Banana 2 edit mode on the anchor with a realism-refinement prompt.
4. Reject images with generated UI/text/timestamps, bad hands, distorted teeth, extra
   people, or unusable face readability.
5. Animate only the realism-approved anchor with Seedance/Kling/Omni image-to-video.

Edit mode was useful in v4 because it preserved the chosen scene while adding a little
realism. It should not replace curation.

## Shared Base Prompt

```text
Vertical 9:16 paused first frame from a handheld iPhone front-camera video, before editing, before color grade, not a photo shoot. Small-sensor phone optics: no portrait mode, no creamy bokeh, background mostly readable, slight front-camera wide-angle distortion. Ad-usable readable face but imperfect social creator frame: flat light, ordinary environment, mild H.264/JPEG social compression, slight mouth/hand motion softness.
```

## Shared Negative Prompt

```text
professional portrait, studio portrait, DSLR, mirrorless, 85mm lens, shallow depth of field, portrait mode, creamy bokeh, cinematic, beauty light, ring light, softbox, glamour, editorial, stock photo, perfect centered headshot, perfect symmetry, flawless skin, retouched skin, airbrushed, perfect makeup, influencer photoshoot, ultra sharp, HDR glamour, polished YouTube thumbnail, fake app UI, captions, text overlay, visible recording phone, mirror selfie, duplicate person, extra fingers, warped teeth, unsafe driving, logos, watermark, unreadable face, extreme blur
```

Also add per-scenario negatives when needed:

```text
no timestamps, no apartment numbers, no legible generated labels, no subtitle bar, no camera UI
```

## Scenario Recipes

### Car Talk

Best tested direction: parked car, side-window/windshield glare, overcast light, voice-note
energy.

```text
Parked car passenger seat, not driving, camera held at chest height and angled slightly toward side window, seatbelt visible but twisted, dull overcast light through dirty side glass, raindrops and faint window reflection, dashboard and back seat readable, face 12% off-center, top of hair near frame edge, mouth caught between words.
```

Edit refinement:

```text
Preserve the same person, parked car, hoodie, pose, and framing. Make this look less AI-polished and more like an unedited iPhone front-camera video still from a TikTok draft: flatter overcast car-window light, more normal phone deep focus, slight social compression, tiny windshield glare, mild skin pores and under-eye texture, uneven mouth shape mid-sentence.
```

### Cozy Honest Bedroom

Best tested direction: unposted story draft, mixed warm/cool light, real clutter, no
aesthetic bedroom staging.

```text
Paused frame from an unposted Instagram Story draft in a normal bedroom, no UI visible, top of hair nearly clipped, one shoulder cut off, open wardrobe and bed mess readable, compressed shadows in hoodie, flyaway hair, mouth half-open while explaining something quietly.
```

Edit refinement:

```text
Preserve the same person, bedroom, hoodie, and selfie framing. Make it more like a paused unposted Instagram Story recorded on an iPhone front camera: mixed warm lamp and cool ceiling light, slightly wrong auto white balance, background clutter in normal phone focus, mild lens haze, visible pores/flyaway hair/hoodie lint, mouth caught mid-thought.
```

### Walking Outside

Best tested direction: wet/grey residential street, bins and parked cars, wind in hair,
deep phone focus.

```text
Walking on a grey residential pavement, boring brick houses, bins, wet concrete and parked cars behind her, background in phone focus, camera at upper-chest height with 4 degree tilt, hair moving across one cheek, slight squint from wind, face still clear and ad-usable, dark puffer over hoodie.
```

Edit refinement:

```text
Preserve the same person, street, outfit, and selfie framing. Make it feel like an actual iPhone front-camera walking video frame: grey overcast light, wet pavement and bins readable in deep phone focus, subtle wide-angle distortion, hair moved by wind, slight uneven motion softness around sleeve/hair only, mild TikTok compression.
```

### Mic / Desk Review

Best tested direction: cheap lav mic, laptop glare, mundane kitchen clutter, flat overhead
light. Watch for generated timestamps or fake UI.

```text
Kitchen table creator review, tiny wired lav mic held near hoodie, wire crooked, laptop open at lower edge casting faint bluish rectangle on cheek, cereal box, mug and papers behind her, window light mixed with fluorescent tube, hand slightly motion-soft but normal, nose subtly widened by front camera.
```

Edit refinement:

```text
Preserve the same creator, kitchen table, hoodie, laptop, and small lav mic setup. Make it more like an unedited iPhone front-camera UGC review still: flat mixed window and overhead light, laptop glare very subtle, kitchen clutter mundane and in phone focus, mild social compression, natural pores and under-eye texture, hand/mic slightly motion-soft but anatomically normal. Keep the mic and hands believable.
```

### Hallway Afterthought

Best tested direction: quick afterthought before leaving, flat overhead light, plain
apartment hall. Avoid legible apartment numbers.

```text
Very quick front-camera video still in apartment hallway, like she remembered one more thing before posting, arm extended, face too close and off-center, top edge nearly clips hair, background door and light fixture sharp, mild JPEG compression, plain unstyled moment.
```

Edit refinement:

```text
Preserve the same person, apartment hallway, hoodie, and quick selfie framing. Make it feel like a low-effort iPhone front-camera video still: flat overhead hallway light, slight lens smudge, one side of face a bit darker, background door and wall sharp in normal phone focus, mild JPEG/social compression, mouth mid-word, eyes slightly off lens.
```

## QA Rubric

Score 1-5:

- Selfie authenticity: iPhone/social video frame, not a portrait.
- Anti-polish: flat light, imperfect crop, ordinary environment.
- Human texture: natural skin/hair/fabric without becoming unflattering.
- Phone artifacts: mild compression/noise/glare/softness, controlled.
- Scene plausibility: real space and moment.
- Ad usability: readable face, brand-safe, usable as a first frame.
- Identity consistency: same person and no uncanny drift.

Greenlight: average 4+, with ad usability and identity consistency both 4+.

## Motion Test Note

Seedance image-to-video through fal produced a technically valid 720x1280 H.264 4.04s
clip from the mic still, but it inherited the polished input look and drifted toward an
AI spokesperson feel. Next motion tests should use v4-level realism anchors, not the
initial clean stills.
